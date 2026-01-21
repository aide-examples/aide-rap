/**
 * SeedManager - Manages seed data loading and clearing for entities
 *
 * Provides functions for:
 * - Getting status of all entities (row counts, seed file availability)
 * - Loading seed data from JSON files
 * - Clearing entity data
 */

const fs = require('fs');
const path = require('path');

// Paths are relative to app directory
const SEED_DIR = path.join(__dirname, '..', '..', 'data', 'seed');

/**
 * Get database and schema from the database module
 */
function getDbAndSchema() {
  const { getDatabase, getSchema } = require('../config/database');
  return { db: getDatabase(), schema: getSchema() };
}

/**
 * Get status of all enabled entities
 * Returns row counts and seed file information
 */
function getStatus() {
  const { db, schema } = getDbAndSchema();
  const entities = [];

  for (const entity of schema.orderedEntities) {
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get().count;

    // Check for seed file
    const seedFile = `${entity.className}.json`;
    const seedPath = path.join(SEED_DIR, seedFile);
    let seedCount = 0;
    let hasSeedFile = false;

    if (fs.existsSync(seedPath)) {
      hasSeedFile = true;
      try {
        const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        seedCount = Array.isArray(seedData) ? seedData.length : 0;
      } catch {
        seedCount = 0;
      }
    }

    entities.push({
      name: entity.className,
      tableName: entity.tableName,
      rowCount,
      seedFile: hasSeedFile ? seedFile : null,
      seedCount
    });
  }

  return { entities };
}

/**
 * Load seed data for a specific entity
 */
function loadEntity(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const seedFile = path.join(SEED_DIR, `${entityName}.json`);
  if (!fs.existsSync(seedFile)) {
    throw new Error(`No seed file found for ${entityName}`);
  }

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) {
    return { loaded: 0 };
  }

  const columns = entity.columns.map(c => c.name);
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT OR REPLACE INTO ${entity.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
  const insert = db.prepare(insertSql);

  let count = 0;
  for (const record of records) {
    const values = columns.map(col => record[col] ?? null);
    try {
      insert.run(...values);
      count++;
    } catch (err) {
      console.error(`Error inserting into ${entityName}:`, err.message);
    }
  }

  return { loaded: count };
}

/**
 * Clear all data from a specific entity
 */
function clearEntity(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  // Check for FK constraints - are there entities that reference this one?
  const backRefs = schema.inverseRelationships[entityName] || [];
  for (const ref of backRefs) {
    const refEntity = schema.entities[ref.entity];
    if (refEntity) {
      const refCount = db.prepare(`SELECT COUNT(*) as count FROM ${refEntity.tableName} WHERE ${ref.column} IS NOT NULL`).get().count;
      if (refCount > 0) {
        throw new Error(`Cannot clear ${entityName}: ${refCount} records in ${ref.entity} reference it`);
      }
    }
  }

  const result = db.prepare(`DELETE FROM ${entity.tableName}`).run();
  return { deleted: result.changes };
}

/**
 * Load all available seed files
 */
function loadAll() {
  const { schema } = getDbAndSchema();
  const results = {};

  // Load in dependency order
  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(SEED_DIR, `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = loadEntity(entity.className);
        results[entity.className] = result;
      } catch (err) {
        results[entity.className] = { error: err.message };
      }
    }
  }

  return results;
}

/**
 * Clear all entity data
 */
function clearAll() {
  const { db, schema } = getDbAndSchema();
  const results = {};

  // Disable FK temporarily for bulk clear
  db.pragma('foreign_keys = OFF');

  // Clear in reverse dependency order
  const reversed = [...schema.orderedEntities].reverse();
  for (const entity of reversed) {
    try {
      const result = db.prepare(`DELETE FROM ${entity.tableName}`).run();
      results[entity.className] = { deleted: result.changes };
    } catch (err) {
      results[entity.className] = { error: err.message };
    }
  }

  db.pragma('foreign_keys = ON');
  return results;
}

/**
 * Reset all: clear then load
 */
function resetAll() {
  const clearResults = clearAll();
  const loadResults = loadAll();

  return {
    cleared: clearResults,
    loaded: loadResults
  };
}

module.exports = {
  getStatus,
  loadEntity,
  clearEntity,
  loadAll,
  clearAll,
  resetAll
};
