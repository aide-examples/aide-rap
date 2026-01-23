/**
 * Database Configuration and Initialization
 *
 * - Connects to SQLite using better-sqlite3
 * - Creates tables for enabled entities from config
 * - Handles schema migration (ADD COLUMN for new attributes)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { generateSchema, generateCreateTableSQL, generateViewSQL, toSnakeCase } = require('../utils/SchemaGenerator');
const SchemaMetadata = require('../utils/SchemaMetadata');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');

let db = null;
let schema = null;
let schemaMetadata = null;

/**
 * Get existing columns for a table
 */
function getExistingColumns(tableName) {
  const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return result.map(row => row.name);
}

/**
 * Check if table exists
 */
function tableExists(tableName) {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  return !!result;
}

/**
 * Check if view exists
 */
function viewExists(viewName) {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name=?"
  ).get(viewName);
  return !!result;
}

/**
 * Create or recreate a view for an entity
 * Views provide FK label columns for read operations
 */
function createOrReplaceView(entity) {
  const viewName = entity.tableName + '_view';
  const viewSQL = generateViewSQL(entity);

  // Drop existing view (if schema changed)
  if (viewExists(viewName)) {
    db.exec(`DROP VIEW IF EXISTS ${viewName}`);
  }

  db.exec(viewSQL);
  return viewName;
}

/**
 * Format a default value for SQL
 * @param {*} value - The default value
 * @returns {string} - SQL-formatted default clause or empty string
 */
function formatDefaultClause(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // SQLite function (e.g., CURRENT_DATE)
  if (value === 'CURRENT_DATE' || value === 'CURRENT_TIMESTAMP') {
    return ` DEFAULT ${value}`;
  }

  // String values need quotes
  if (typeof value === 'string') {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''");
    return ` DEFAULT '${escaped}'`;
  }

  // Numbers and booleans
  return ` DEFAULT ${value}`;
}

/**
 * Migrate schema - add new columns if needed
 * Now includes default values for new columns
 */
function migrateSchema(entity) {
  const tableName = entity.tableName;

  if (!tableExists(tableName)) {
    return false; // Table doesn't exist, will be created fresh
  }

  const existingColumns = getExistingColumns(tableName);
  const schemaColumns = entity.columns.map(c => c.name);

  let migrated = false;

  // Add missing columns
  for (const col of entity.columns) {
    if (!existingColumns.includes(col.name)) {
      // Determine SQL type without NOT NULL for ALTER TABLE
      let sqlType = col.sqlType.replace(' NOT NULL', '').replace(' PRIMARY KEY', '');
      if (col.name === 'id') continue; // Can't add id column

      // Build default clause from column's defaultValue
      const defaultClause = formatDefaultClause(col.defaultValue);

      try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${sqlType}${defaultClause}`).run();
        logger.info(`Added column ${col.name} to ${tableName}${defaultClause ? ` with default` : ''}`);

        // SQLite's ALTER TABLE ADD COLUMN with DEFAULT only affects NEW rows.
        // We need to UPDATE existing rows to have the default value.
        if (col.defaultValue !== null && col.defaultValue !== undefined && col.defaultValue !== 'CURRENT_DATE') {
          const updateValue = typeof col.defaultValue === 'string'
            ? `'${col.defaultValue.replace(/'/g, "''")}'`
            : col.defaultValue;
          db.prepare(`UPDATE ${tableName} SET ${col.name} = ${updateValue} WHERE ${col.name} IS NULL`).run();
          logger.debug(`Set default value for existing rows in ${tableName}.${col.name}`);
        }

        migrated = true;
      } catch (err) {
        logger.error(`Failed to add column ${col.name} to ${tableName}`, { error: err.message });
      }
    }
  }

  // Warn about columns in DB but not in schema (skip 'id' which is implicit)
  for (const dbCol of existingColumns) {
    if (dbCol !== 'id' && !schemaColumns.includes(dbCol)) {
      logger.warn(`Column ${dbCol} in ${tableName} is no longer in schema`);
    }
  }

  return migrated;
}

/**
 * Initialize database
 * @param {string} dbPath - Path to SQLite database file
 * @param {string} dataModelPath - Path to DataModel.md
 * @param {string[]} enabledEntities - List of entity names to enable
 */
function initDatabase(dbPath, dataModelPath, enabledEntities) {
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open database
  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  logger.info('Database opened', { path: dbPath });

  // Initialize schema metadata tracking
  schemaMetadata = new SchemaMetadata(db);

  // Generate schema from DataModel.md
  schema = generateSchema(dataModelPath, enabledEntities);

  logger.info('Schema generated', {
    enabledEntities: enabledEntities,
    totalEntities: Object.keys(schema.entities).length
  });

  // Create/migrate tables in dependency order
  for (const entity of schema.orderedEntities) {
    // Compare with stored schema metadata
    const comparison = schemaMetadata.compareSchemas(entity.className, entity);

    if (comparison.isNew) {
      logger.info(`Schema: New entity ${entity.className}`);
    } else if (comparison.changes.length > 0) {
      // Process column renames first (before removes, so we don't delete renamed columns)
      const renames = comparison.changes.filter(c => c.type === 'POSSIBLE_RENAME');
      const removes = comparison.changes.filter(c => c.type === 'REMOVE_COLUMN');
      const handledRemoves = new Set();

      for (const rename of renames) {
        // Check if it's a simple attribute (not FK)
        const newCol = entity.columns.find(c => c.name === rename.newName);
        const isFK = newCol && newCol.foreignKey;

        // Only auto-rename on high confidence (description match)
        if (rename.confidence === 'high' && !isFK && tableExists(entity.tableName)) {
          try {
            db.exec(`ALTER TABLE ${entity.tableName} RENAME COLUMN ${rename.oldName} TO ${rename.newName}`);
            logger.info(`Schema: RENAME ${entity.className}.${rename.oldName} -> ${rename.newName} (${rename.reason})`);
            handledRemoves.add(rename.oldName);
          } catch (err) {
            logger.error(`Failed to rename column ${rename.oldName}`, { error: err.message });
          }
        } else if (rename.confidence === 'high' && isFK) {
          logger.warn(`Schema: POSSIBLE RENAME ${entity.className}.${rename.oldName} -> ${rename.newName} (FK - manual action needed)`);
        } else {
          // Low confidence - just warn
          logger.warn(`Schema: POSSIBLE RENAME ${entity.className}.${rename.oldName} -> ${rename.newName} (${rename.reason} - manual verification needed)`);
        }
      }

      for (const change of comparison.changes) {
        switch (change.type) {
          case 'ADD_COLUMN':
            logger.info(`Schema: ADD ${entity.className}.${change.column.name}`);
            break;
          case 'REMOVE_COLUMN':
            if (handledRemoves.has(change.column.name)) break; // Was renamed
            // Actually drop the column
            if (tableExists(entity.tableName)) {
              try {
                db.exec(`ALTER TABLE ${entity.tableName} DROP COLUMN ${change.column.name}`);
                logger.info(`Schema: DROP ${entity.className}.${change.column.name}`);
              } catch (err) {
                logger.warn(`Schema: REMOVE ${entity.className}.${change.column.name} (drop failed: ${err.message})`);
              }
            }
            break;
          case 'TYPE_CHANGE':
            logger.warn(`Schema: TYPE ${entity.className}.${change.column.name} ${change.oldType} -> ${change.column.type} (manual migration needed)`);
            break;
          case 'DEFAULT_CHANGE':
            logger.info(`Schema: DEFAULT ${entity.className}.${change.column.name} changed`);
            break;
          case 'REQUIRED_CHANGE':
            if (change.isRequired) {
              logger.warn(`Schema: REQUIRED ${entity.className}.${change.column.name} now required (SQLite cannot add NOT NULL - check for NULL values)`);
            } else {
              logger.info(`Schema: OPTIONAL ${entity.className}.${change.column.name} now optional`);
            }
            break;
          case 'FK_CHANGE':
            if (!change.oldFK && change.newFK) {
              logger.warn(`Schema: FK_ADD ${entity.className}.${change.column.name} -> ${change.newFK} (manual migration needed)`);
            } else if (change.oldFK && !change.newFK) {
              logger.warn(`Schema: FK_REMOVE ${entity.className}.${change.column.name} was -> ${change.oldFK} (manual migration needed)`);
            } else {
              logger.warn(`Schema: FK_CHANGE ${entity.className}.${change.column.name} ${change.oldFK} -> ${change.newFK} (manual migration needed)`);
            }
            break;
          case 'POSSIBLE_RENAME':
            // Already handled above
            break;
        }
      }
    }

    // Try migration first
    const wasMigrated = migrateSchema(entity);

    if (!tableExists(entity.tableName)) {
      // Create table
      const { createTable, createIndexes } = generateCreateTableSQL(entity);

      db.exec(createTable);
      logger.info(`Created table ${entity.tableName}`);

      // Create indexes
      for (const indexSql of createIndexes) {
        db.exec(indexSql);
      }
      if (createIndexes.length > 0) {
        logger.debug(`Created ${createIndexes.length} indexes for ${entity.tableName}`);
      }
    }

    // Save current schema to metadata
    schemaMetadata.save(entity.className, entity);
  }

  // Check for removed/renamed entities
  const currentEntityNames = new Set(schema.orderedEntities.map(e => e.className));
  const storedEntityNames = schemaMetadata.getAllStoredEntities();
  const seedDir = path.join(dataDir, 'seed');

  // Find removed and new entities
  const removedEntities = storedEntityNames.filter(name => !currentEntityNames.has(name));
  const newEntities = schema.orderedEntities.filter(e => !storedEntityNames.includes(e.className));

  // Try to detect renames: removed + new with same schema hash
  const renamedEntities = new Map(); // oldName -> newEntity

  for (const oldName of removedEntities) {
    const oldStored = schemaMetadata.getStored(oldName);
    if (!oldStored) continue;

    for (const newEntity of newEntities) {
      const newHash = schemaMetadata.computeHash(newEntity);
      if (oldStored.schema_hash === newHash) {
        renamedEntities.set(oldName, newEntity);
        break;
      }
    }
  }

  // Process renames
  for (const [oldName, newEntity] of renamedEntities) {
    const oldTableName = toSnakeCase(oldName);
    const newTableName = newEntity.tableName;
    const oldViewName = oldTableName + '_view';

    logger.info(`Schema: Entity renamed ${oldName} -> ${newEntity.className}`);

    // Drop old view (will be recreated with new name)
    if (viewExists(oldViewName)) {
      db.exec(`DROP VIEW IF EXISTS ${oldViewName}`);
    }

    // Rename table
    if (tableExists(oldTableName)) {
      db.exec(`ALTER TABLE ${oldTableName} RENAME TO ${newTableName}`);
      logger.info(`Renamed table ${oldTableName} -> ${newTableName}`);
    }

    // Rename seed file
    const oldSeedFile = path.join(seedDir, `${oldName}.json`);
    const newSeedFile = path.join(seedDir, `${newEntity.className}.json`);
    if (fs.existsSync(oldSeedFile) && !fs.existsSync(newSeedFile)) {
      fs.renameSync(oldSeedFile, newSeedFile);
      logger.info(`Renamed seed file ${oldName}.json -> ${newEntity.className}.json`);
    }

    // Update metadata (delete old, save new)
    schemaMetadata.delete(oldName);
    schemaMetadata.save(newEntity.className, newEntity);
  }

  // Process actual removals (not renames)
  for (const storedName of removedEntities) {
    if (renamedEntities.has(storedName)) continue; // Skip, was renamed

    const tableName = toSnakeCase(storedName);
    const viewName = tableName + '_view';

    logger.warn(`Schema: Entity ${storedName} removed - cleaning up`);

    // Drop view first
    if (viewExists(viewName)) {
      db.exec(`DROP VIEW IF EXISTS ${viewName}`);
      logger.info(`Dropped view ${viewName}`);
    }

    // Drop table
    if (tableExists(tableName)) {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
      logger.info(`Dropped table ${tableName}`);
    }

    // Delete seed file
    const seedFile = path.join(seedDir, `${storedName}.json`);
    if (fs.existsSync(seedFile)) {
      fs.unlinkSync(seedFile);
      logger.info(`Deleted seed file ${storedName}.json`);
    }

    // Remove from metadata
    schemaMetadata.delete(storedName);
  }

  // Create views for all entities (after all tables exist for FK joins)
  let viewCount = 0;
  for (const entity of schema.orderedEntities) {
    const viewName = createOrReplaceView(entity);
    viewCount++;
  }
  logger.info(`Created ${viewCount} views for FK label resolution`);

  // Track global types from Types.md
  const allTypes = getTypeRegistry().getAllTypes();
  const typesComparison = schemaMetadata.compareTypes(allTypes);

  if (typesComparison.isNew) {
    logger.info('Types: Initial registration from Types.md');
  } else if (typesComparison.changes.length > 0) {
    for (const change of typesComparison.changes) {
      switch (change.type) {
        case 'ADD_PATTERN':
          logger.info(`Types: ADD ${change.name} (pattern)`);
          break;
        case 'CHANGE_PATTERN':
          logger.warn(`Types: PATTERN ${change.name} changed`);
          break;
        case 'REMOVE_PATTERN':
          logger.warn(`Types: REMOVE ${change.name} (pattern)`);
          break;
        case 'ADD_ENUM':
          logger.info(`Types: ADD ${change.name} (enum)`);
          break;
        case 'CHANGE_ENUM':
          logger.warn(`Types: ENUM ${change.name} values changed`);
          break;
        case 'REMOVE_ENUM':
          logger.warn(`Types: REMOVE ${change.name} (enum)`);
          break;
      }
    }
  }

  schemaMetadata.saveTypes(allTypes);

  return { db, schema };
}

/**
 * Get database instance
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

/**
 * Get schema
 */
function getSchema() {
  if (!schema) {
    throw new Error('Schema not loaded. Call initDatabase first.');
  }
  return schema;
}

/**
 * Close database connection
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    schema = null;
    logger.info('Database closed');
  }
}

/**
 * Drop and recreate a table (for --reset)
 */
function resetTable(entityName) {
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const tableName = entity.tableName;
  const viewName = tableName + '_view';

  // Drop view first (depends on table)
  if (viewExists(viewName)) {
    db.exec(`DROP VIEW IF EXISTS ${viewName}`);
    logger.debug(`Dropped view ${viewName}`);
  }

  // Drop table (CASCADE will handle FK references)
  if (tableExists(tableName)) {
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    logger.info(`Dropped table ${tableName}`);
  }

  // Recreate table
  const { createTable, createIndexes } = generateCreateTableSQL(entity);
  db.exec(createTable);
  logger.info(`Recreated table ${tableName}`);

  for (const indexSql of createIndexes) {
    db.exec(indexSql);
  }

  // Recreate view
  createOrReplaceView(entity);
  logger.debug(`Recreated view ${viewName}`);

  return true;
}

module.exports = {
  initDatabase,
  getDatabase,
  getSchema,
  closeDatabase,
  resetTable,
  tableExists,
  getExistingColumns
};
