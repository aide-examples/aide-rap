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
const { generateSchema, generateCreateTableSQL } = require('../utils/SchemaGenerator');

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
 * Migrate schema - add new columns if needed
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

      try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${sqlType}`).run();
        logger.info(`Added column ${col.name} to ${tableName}`);
        migrated = true;
      } catch (err) {
        logger.error(`Failed to add column ${col.name} to ${tableName}`, { error: err.message });
      }
    }
  }

  // Warn about columns in DB but not in schema
  for (const dbCol of existingColumns) {
    if (!schemaColumns.includes(dbCol)) {
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

  // Drop table (CASCADE will handle FK references)
  if (tableExists(tableName)) {
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    logger.info(`Dropped table ${tableName}`);
  }

  // Recreate
  const { createTable, createIndexes } = generateCreateTableSQL(entity);
  db.exec(createTable);
  logger.info(`Recreated table ${tableName}`);

  for (const indexSql of createIndexes) {
    db.exec(indexSql);
  }

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
