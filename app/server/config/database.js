/**
 * Database Configuration and Initialization
 *
 * Simplified approach for development:
 * - Compare overall schema hash
 * - If changed: drop all tables and recreate
 * - No complex migration logic
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { generateSchema, generateCreateTableSQL, generateViewSQL } = require('../utils/SchemaGenerator');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const { parseAllUserViews, generateUserViewSQL } = require('../utils/UserViewGenerator');

let db = null;
let schema = null;
let storedViewsConfig = null;
let storedDbPath = null;
let storedDataModelPath = null;
let storedEnabledEntities = null;

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
 */
function createOrReplaceView(entity) {
  const viewName = entity.tableName + '_view';
  const viewSQL = generateViewSQL(entity);

  if (viewExists(viewName)) {
    db.exec(`DROP VIEW IF EXISTS ${viewName}`);
  }

  db.exec(viewSQL);
  return viewName;
}

/**
 * Compute a hash for the entire schema (all entities + types)
 */
function computeSchemaHash(schema) {
  const data = {
    entities: {},
    types: {}
  };

  // Hash entity structures (columns + constraints)
  for (const entity of schema.orderedEntities) {
    data.entities[entity.className] = {
      columns: entity.columns.map(c => ({
        name: c.name,
        type: c.type,
        sqlType: c.sqlType,
        required: c.required,
        unique: c.unique || false,
        foreignKey: c.foreignKey?.references || null,
        defaultValue: c.defaultValue
      })),
      uniqueKeys: entity.uniqueKeys || {},
      indexes: entity.indexes || {}
    };
  }

  // Hash types
  const allTypes = getTypeRegistry().getAllTypes();
  for (const [name, def] of Object.entries(allTypes)) {
    if (def.scope === 'global') {
      if (def.kind === 'pattern') {
        data.types[name] = { kind: 'pattern', pattern: def.pattern };
      } else if (def.kind === 'enum') {
        data.types[name] = { kind: 'enum', values: def.values };
      }
    }
  }

  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

/**
 * Get stored schema hash from _schema_hash table
 */
function getStoredSchemaHash() {
  try {
    const result = db.prepare(
      "SELECT hash FROM _schema_hash WHERE id = 1"
    ).get();
    return result?.hash || null;
  } catch {
    return null; // Table doesn't exist yet
  }
}

/**
 * Save schema hash
 */
function saveSchemaHash(hash) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_hash (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare(`
    INSERT INTO _schema_hash (id, hash, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, updated_at = CURRENT_TIMESTAMP
  `).run(hash);
}

/**
 * Auto-backup all entity data before dropping tables on schema change.
 * Converts FK IDs to label values for portability across schema rebuilds.
 * Only runs when there is existing data and schema has changed.
 */
function autoBackupBeforeDrop(orderedEntities) {
  const backupDir = path.join(path.dirname(storedDbPath), 'backup');

  let totalRecords = 0;
  const entityData = {};

  // Collect data from existing tables (with FK label resolution)
  for (const entity of orderedEntities) {
    if (!tableExists(entity.tableName)) continue;

    try {
      const rows = db.prepare(`SELECT * FROM ${entity.tableName}`).all();
      if (rows.length === 0) continue;

      const exportRows = rows.map(row => {
        const exported = { ...row };
        delete exported.id;

        // Convert FK IDs to label values
        for (const fk of entity.foreignKeys) {
          const idValue = row[fk.column];
          if (idValue === null || idValue === undefined) continue;

          const refEntity = schema.entities[fk.references.entity];
          if (!refEntity || !tableExists(refEntity.tableName)) continue;

          const labelCol = refEntity.columns.find(c => c.ui?.label);
          if (!labelCol) continue;

          try {
            const refRow = db.prepare(
              `SELECT ${labelCol.name} FROM ${refEntity.tableName} WHERE id = ?`
            ).get(idValue);

            if (refRow && refRow[labelCol.name]) {
              exported[fk.displayName] = refRow[labelCol.name];
              delete exported[fk.column];
            }
          } catch {
            // Keep numeric ID if lookup fails
          }
        }

        // Remove computed columns
        for (const col of entity.columns) {
          if (col.computed && !col.foreignKey) {
            delete exported[col.name];
          }
        }

        return exported;
      });

      entityData[entity.className] = exportRows;
      totalRecords += exportRows.length;
    } catch (err) {
      logger.warn(`Auto-backup: could not read ${entity.tableName}`, { error: err.message });
    }
  }

  if (totalRecords === 0) {
    logger.info('Auto-backup: no data to backup');
    return;
  }

  // Write backup files
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const [className, records] of Object.entries(entityData)) {
    const filePath = path.join(backupDir, `${className}.json`);
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  }

  // Clean up backup files for entities with no data
  for (const entity of orderedEntities) {
    if (!entityData[entity.className]) {
      const filePath = path.join(backupDir, `${entity.className}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  logger.info(`Auto-backup: saved ${totalRecords} records from ${Object.keys(entityData).length} entities before schema drop`);
}

/**
 * Drop all entity tables and views (in reverse dependency order)
 */
function dropAllTables(orderedEntities) {
  // Drop user views (uv_*) first
  const uvViews = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'uv_%'"
  ).all();
  for (const { name } of uvViews) {
    db.exec(`DROP VIEW IF EXISTS ${name}`);
  }

  // Drop entity views
  for (const entity of orderedEntities) {
    const viewName = entity.tableName + '_view';
    if (viewExists(viewName)) {
      db.exec(`DROP VIEW IF EXISTS ${viewName}`);
    }
  }

  // Drop tables in reverse order (to respect FK constraints)
  const reversed = [...orderedEntities].reverse();
  for (const entity of reversed) {
    if (tableExists(entity.tableName)) {
      db.exec(`DROP TABLE IF EXISTS ${entity.tableName}`);
      logger.debug(`Dropped table ${entity.tableName}`);
    }
  }

  // Also drop old metadata table if exists
  db.exec('DROP TABLE IF EXISTS _schema_metadata');
}

/**
 * Create all tables
 */
function createAllTables(orderedEntities) {
  for (const entity of orderedEntities) {
    const { createTable, createIndexes } = generateCreateTableSQL(entity);

    db.exec(createTable);
    logger.debug(`Created table ${entity.tableName}`);

    for (const indexSql of createIndexes) {
      db.exec(indexSql);
    }
  }
}

/**
 * Create all views
 */
function createAllViews(orderedEntities) {
  for (const entity of orderedEntities) {
    createOrReplaceView(entity);
  }
  logger.debug(`Created ${orderedEntities.length} views`);
}

/**
 * Create user-defined views (uv_*) from config
 */
function createUserViews(viewsConfig) {
  if (!viewsConfig || viewsConfig.length === 0) return;

  // Drop existing user views first
  const uvViews = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'uv_%'"
  ).all();
  for (const { name } of uvViews) {
    db.exec(`DROP VIEW IF EXISTS ${name}`);
  }

  const { views, groups } = parseAllUserViews(viewsConfig, schema);

  for (const view of views) {
    try {
      const sql = generateUserViewSQL(view);
      db.exec(sql);
      logger.debug(`Created user view ${view.sqlName}`);
    } catch (err) {
      logger.error(`Failed to create user view "${view.name}"`, { error: err.message });
    }
  }

  // Store on schema for API access
  schema.userViews = views;
  schema.userViewGroups = groups;

  if (views.length > 0) {
    logger.info(`Created ${views.length} user view(s)`);
  }
}

/**
 * Initialize database
 * @param {string} dbPath - Path to SQLite database file
 * @param {string} dataModelPath - Path to DataModel.md
 * @param {string[]} enabledEntities - List of entity names to enable
 * @param {Array} [viewsConfig] - Optional user view definitions
 */
function initDatabase(dbPath, dataModelPath, enabledEntities, viewsConfig) {
  // Store params for reinitialize()
  storedDbPath = dbPath;
  storedDataModelPath = dataModelPath;
  storedEnabledEntities = enabledEntities;
  storedViewsConfig = viewsConfig || [];

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open database
  db = new Database(dbPath);
  db.pragma('foreign_keys = OFF'); // Disable during setup

  logger.info('Database opened', { path: dbPath });

  // Generate schema from DataModel.md
  schema = generateSchema(dataModelPath, enabledEntities);

  logger.info('Schema generated', {
    enabledEntities: enabledEntities,
    totalEntities: Object.keys(schema.entities).length
  });

  // Compute current schema hash
  const currentHash = computeSchemaHash(schema);
  const storedHash = getStoredSchemaHash();

  if (storedHash !== currentHash) {
    if (storedHash) {
      logger.info('Schema changed - recreating all tables');
      // Auto-backup existing data before dropping tables
      autoBackupBeforeDrop(schema.orderedEntities);
    } else {
      logger.info('Initial schema setup');
    }

    // Drop and recreate everything
    dropAllTables(schema.orderedEntities);
    createAllTables(schema.orderedEntities);
    createAllViews(schema.orderedEntities);
    createUserViews(viewsConfig);
    saveSchemaHash(currentHash);

    logger.info('Schema initialized', {
      tables: schema.orderedEntities.length,
      hash: currentHash.substring(0, 8) + '...'
    });
  } else {
    logger.info('Schema unchanged', { hash: currentHash.substring(0, 8) + '...' });

    // Still recreate views (they might reference label columns that changed)
    createAllViews(schema.orderedEntities);
    createUserViews(viewsConfig);
  }

  // Enable foreign keys for runtime
  db.pragma('foreign_keys = ON');

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
 * Force schema rebuild (for CLI --reset)
 */
function forceRebuild() {
  if (!db || !schema) {
    throw new Error('Database not initialized');
  }

  db.pragma('foreign_keys = OFF');

  dropAllTables(schema.orderedEntities);
  createAllTables(schema.orderedEntities);
  createAllViews(schema.orderedEntities);
  createUserViews(storedViewsConfig);

  const hash = computeSchemaHash(schema);
  saveSchemaHash(hash);

  db.pragma('foreign_keys = ON');

  logger.info('Schema rebuilt', { tables: schema.orderedEntities.length });
}

/**
 * Reinitialize database and schema from scratch.
 * Re-reads DataModel.md, rebuilds types, tables, and views.
 * Safe to call at runtime (closes existing connection first).
 */
function reinitialize() {
  if (!storedDbPath || !storedDataModelPath) {
    throw new Error('Cannot reinitialize: database was never initialized');
  }

  const { resetTypeRegistry } = require('../../shared/types/TypeRegistry');

  // Close existing connection
  if (db) {
    db.close();
    db = null;
    schema = null;
  }

  // Reset TypeRegistry singleton to avoid accumulated types
  resetTypeRegistry();

  // Re-read views from Views.md (so view changes take effect without restart)
  const requirementsDir = path.dirname(storedDataModelPath);
  const UISpecLoader = require('../utils/UISpecLoader');
  const mdViews = UISpecLoader.loadViewsConfig(requirementsDir);
  if (mdViews) {
    storedViewsConfig = mdViews;
    logger.info('Views reloaded from markdown');
  }

  // Re-run full initialization
  initDatabase(storedDbPath, storedDataModelPath, storedEnabledEntities, storedViewsConfig);

  logger.info('Database reinitialized', { entities: schema.orderedEntities.length });
  return { success: true, entities: schema.orderedEntities.length };
}

module.exports = {
  initDatabase,
  getDatabase,
  getSchema,
  closeDatabase,
  forceRebuild,
  reinitialize,
  tableExists,
  viewExists
};
