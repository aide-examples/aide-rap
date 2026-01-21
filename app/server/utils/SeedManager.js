/**
 * SeedManager - Manages seed data loading and clearing for entities
 *
 * Supports two data sources:
 * - seed_imported/  - Manually uploaded JSON files
 * - seed_generated/ - Synthetically generated data
 */

const fs = require('fs');
const path = require('path');

// Paths are relative to app directory
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SEED_IMPORTED_DIR = path.join(DATA_DIR, 'seed_imported');
const SEED_GENERATED_DIR = path.join(DATA_DIR, 'seed_generated');

// Current active source (default: generated)
let activeSource = 'generated';

/**
 * Get the seed directory for the active source
 */
function getSeedDir(source = activeSource) {
  return source === 'imported' ? SEED_IMPORTED_DIR : SEED_GENERATED_DIR;
}

/**
 * Get database and schema from the database module
 */
function getDbAndSchema() {
  const { getDatabase, getSchema } = require('../config/database');
  return { db: getDatabase(), schema: getSchema() };
}

/**
 * Count records in a seed file
 */
function countSeedFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get status of all enabled entities
 * Returns row counts and seed file information for both sources
 */
function getStatus() {
  const { db, schema } = getDbAndSchema();
  const entities = [];

  for (const entity of schema.orderedEntities) {
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get().count;
    const seedFile = `${entity.className}.json`;

    // Check both sources
    const importedPath = path.join(SEED_IMPORTED_DIR, seedFile);
    const generatedPath = path.join(SEED_GENERATED_DIR, seedFile);

    const importedCount = countSeedFile(importedPath);
    const generatedCount = countSeedFile(generatedPath);

    entities.push({
      name: entity.className,
      tableName: entity.tableName,
      rowCount,
      importedCount,
      generatedCount,
      // Legacy compatibility
      seedFile: generatedCount !== null ? seedFile : (importedCount !== null ? seedFile : null),
      seedCount: activeSource === 'imported' ? importedCount : generatedCount
    });
  }

  return {
    entities,
    activeSource,
    sources: ['imported', 'generated']
  };
}

/**
 * Set the active seed source
 */
function setSource(source) {
  if (source !== 'imported' && source !== 'generated') {
    throw new Error(`Invalid source: ${source}. Must be 'imported' or 'generated'`);
  }
  activeSource = source;
  return { activeSource };
}

/**
 * Get the current active source
 */
function getSource() {
  return activeSource;
}

/**
 * Load seed data for a specific entity from active source
 */
function loadEntity(entityName, source = activeSource) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const seedFile = path.join(getSeedDir(source), `${entityName}.json`);
  if (!fs.existsSync(seedFile)) {
    throw new Error(`No seed file found for ${entityName} in ${source}`);
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

  return { loaded: count, source };
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
 * Load all available seed files from active source
 */
function loadAll(source = activeSource) {
  const { schema } = getDbAndSchema();
  const results = {};
  const seedDir = getSeedDir(source);

  // Load in dependency order
  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(seedDir, `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = loadEntity(entity.className, source);
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
 * Reset all: clear then load from active source
 */
function resetAll(source = activeSource) {
  const clearResults = clearAll();
  const loadResults = loadAll(source);

  return {
    cleared: clearResults,
    loaded: loadResults,
    source
  };
}

/**
 * Upload JSON data for an entity (saves to seed_imported/)
 */
function uploadEntity(entityName, jsonData) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  // Validate JSON data
  let records;
  if (typeof jsonData === 'string') {
    records = JSON.parse(jsonData);
  } else {
    records = jsonData;
  }

  if (!Array.isArray(records)) {
    throw new Error('JSON data must be an array of records');
  }

  // Ensure directory exists
  if (!fs.existsSync(SEED_IMPORTED_DIR)) {
    fs.mkdirSync(SEED_IMPORTED_DIR, { recursive: true });
  }

  const filePath = path.join(SEED_IMPORTED_DIR, `${entityName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));

  return { uploaded: records.length, file: `${entityName}.json` };
}

/**
 * Copy a seed file from imported to generated
 */
function copyToGenerated(entityName) {
  const sourcePath = path.join(SEED_IMPORTED_DIR, `${entityName}.json`);
  const destPath = path.join(SEED_GENERATED_DIR, `${entityName}.json`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No imported file found for ${entityName}`);
  }

  // Ensure directory exists
  if (!fs.existsSync(SEED_GENERATED_DIR)) {
    fs.mkdirSync(SEED_GENERATED_DIR, { recursive: true });
  }

  fs.copyFileSync(sourcePath, destPath);

  const count = countSeedFile(destPath);
  return { copied: count, from: 'imported', to: 'generated' };
}

/**
 * Copy all imported files to generated
 */
function copyAllToGenerated() {
  const results = {};

  if (!fs.existsSync(SEED_IMPORTED_DIR)) {
    return results;
  }

  const files = fs.readdirSync(SEED_IMPORTED_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const entityName = file.replace('.json', '');
    try {
      results[entityName] = copyToGenerated(entityName);
    } catch (err) {
      results[entityName] = { error: err.message };
    }
  }

  return results;
}

module.exports = {
  getStatus,
  getSource,
  setSource,
  loadEntity,
  clearEntity,
  loadAll,
  clearAll,
  resetAll,
  uploadEntity,
  copyToGenerated,
  copyAllToGenerated,
  // Export paths for testing
  SEED_IMPORTED_DIR,
  SEED_GENERATED_DIR
};
