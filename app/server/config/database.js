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
const { generateSchema, generateCreateTableSQL, generateViewSQL } = require('../utils/SchemaGenerator');

let db = null;
let schema = null;

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

  // Generate schema from DataModel.md
  schema = generateSchema(dataModelPath, enabledEntities);

  logger.info('Schema generated', {
    enabledEntities: enabledEntities,
    totalEntities: Object.keys(schema.entities).length
  });

  // Create/migrate tables in dependency order
  for (const entity of schema.orderedEntities) {
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
  }

  // Create views for all entities (after all tables exist for FK joins)
  let viewCount = 0;
  for (const entity of schema.orderedEntities) {
    const viewName = createOrReplaceView(entity);
    viewCount++;
  }
  logger.info(`Created ${viewCount} views for FK label resolution`);

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
