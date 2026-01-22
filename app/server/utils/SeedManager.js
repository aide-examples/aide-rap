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
 * Build a lookup map for an entity: LABEL value -> id
 * Used to resolve conceptual FK references (e.g., "manufacturer": "Airbus" -> manufacturer_id: 1)
 *
 * Supports multiple lookup keys:
 * - Primary LABEL field (e.g., "designation" -> "A320neo")
 * - Secondary LABEL2 field (e.g., "name" -> "Airbus A320neo")
 * This allows AI-generated data to use either the short or full name.
 */
function buildLabelLookup(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return {};

  // Find the LABEL and LABEL2 columns
  const labelCol = entity.columns.find(c => c.ui?.label);
  const label2Col = entity.columns.find(c => c.ui?.label2);

  if (!labelCol && !label2Col) return {};

  // Build column list for SELECT
  const selectCols = ['id'];
  if (labelCol) selectCols.push(labelCol.name);
  if (label2Col && label2Col.name !== labelCol?.name) selectCols.push(label2Col.name);

  const sql = `SELECT ${selectCols.join(', ')} FROM ${entity.tableName}`;
  const rows = db.prepare(sql).all();

  const lookup = {};
  for (const row of rows) {
    // Add primary label to lookup
    if (labelCol && row[labelCol.name]) {
      lookup[row[labelCol.name]] = row.id;
    }
    // Add secondary label to lookup (allows matching by full name)
    if (label2Col && row[label2Col.name]) {
      lookup[row[label2Col.name]] = row.id;
    }
  }

  return lookup;
}

/**
 * Resolve conceptual FK references in a record.
 * Converts { "manufacturer": "Airbus" } to { "manufacturer_id": 1 }
 *
 * @param {string} entityName - The entity being seeded
 * @param {object} record - The seed record (may have conceptual or technical FK names)
 * @param {object} lookups - Pre-built lookup maps for all entities
 * @returns {object} - Record with resolved FK IDs
 */
function resolveConceptualFKs(entityName, record, lookups) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return record;

  const resolved = { ...record };

  for (const fk of entity.foreignKeys) {
    const conceptualName = fk.displayName;  // e.g., "manufacturer"
    const technicalName = fk.column;        // e.g., "manufacturer_id"
    const targetEntity = fk.references.entity; // e.g., "AircraftManufacturer"

    // Check if record uses conceptual name (e.g., "manufacturer": "Airbus")
    if (conceptualName && conceptualName in record && typeof record[conceptualName] === 'string') {
      const labelValue = record[conceptualName];
      const lookup = lookups[targetEntity] || {};
      const resolvedId = lookup[labelValue];

      if (resolvedId !== undefined) {
        // Replace conceptual name with technical name and resolved ID
        resolved[technicalName] = resolvedId;
        delete resolved[conceptualName];
      } else {
        console.warn(`  Warning: Could not resolve ${conceptualName}="${labelValue}" for ${entityName}`);
      }
    }
  }

  return resolved;
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
 * Supports both technical FK notation (type_id: 3) and conceptual notation (type: "A320neo")
 *
 * @param {string} entityName - Entity name
 * @param {string} source - Source directory ('imported' or 'generated')
 * @param {object} lookups - Pre-built label lookups for FK resolution (optional)
 * @returns {object} - { loaded: count, source }
 */
function loadEntity(entityName, source = activeSource, lookups = null) {
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

  // Build lookups for FK resolution if not provided
  if (!lookups) {
    lookups = {};
    // Build lookups for all referenced entities
    for (const fk of entity.foreignKeys) {
      if (!lookups[fk.references.entity]) {
        lookups[fk.references.entity] = buildLabelLookup(fk.references.entity);
      }
    }
  }

  // Filter out computed columns (DAILY, IMMEDIATE, etc.) - they are auto-calculated
  const isComputedColumn = (col) => {
    if (col.computed) return true;  // Schema already parsed
    const desc = col.description || '';
    return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
  };

  const columns = entity.columns.filter(c => !isComputedColumn(c)).map(c => c.name);
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT OR REPLACE INTO ${entity.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
  const insert = db.prepare(insertSql);

  let count = 0;
  for (const record of records) {
    // Resolve conceptual FK references (e.g., "type": "A320neo" -> "type_id": 3)
    const resolved = resolveConceptualFKs(entityName, record, lookups);
    const values = columns.map(col => resolved[col] ?? null);
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
 * Builds label lookups incrementally for FK resolution
 */
function loadAll(source = activeSource) {
  const { schema } = getDbAndSchema();
  const results = {};
  const seedDir = getSeedDir(source);

  // Build lookups incrementally as entities are loaded (for FK resolution)
  const lookups = {};

  // Load in dependency order
  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(seedDir, `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = loadEntity(entity.className, source, lookups);
        results[entity.className] = result;

        // Update lookup for this entity (so subsequent entities can reference it)
        lookups[entity.className] = buildLabelLookup(entity.className);
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
