/**
 * SeedManager - Manages seed data loading and clearing for entities
 *
 * Single data source: seed/ directory
 * Supports import from JSON and CSV (both saved as JSON)
 */

const fs = require('fs');
const path = require('path');

// Paths are relative to app directory
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SEED_DIR = path.join(DATA_DIR, 'seed');

// Ensure seed directory exists
if (!fs.existsSync(SEED_DIR)) {
  fs.mkdirSync(SEED_DIR, { recursive: true });
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
 * - Combined format: "LABEL (LABEL2)" (e.g., "Airbus (France)")
 *   This matches the display format used in Views and exports.
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
    const primaryVal = labelCol ? row[labelCol.name] : null;
    const secondaryVal = label2Col ? row[label2Col.name] : null;

    // Add primary label to lookup
    if (primaryVal) {
      lookup[primaryVal] = row.id;
    }
    // Add secondary label to lookup (allows matching by full name)
    if (secondaryVal) {
      lookup[secondaryVal] = row.id;
    }
    // Add combined format: "primary (secondary)" - matches View display format
    if (primaryVal && secondaryVal) {
      lookup[`${primaryVal} (${secondaryVal})`] = row.id;
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
 * Returns row counts, seed file availability, and valid record counts
 */
function getStatus() {
  const { db, schema } = getDbAndSchema();
  const entities = [];

  for (const entity of schema.orderedEntities) {
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get().count;
    const seedFile = `${entity.className}.json`;
    const seedPath = path.join(SEED_DIR, seedFile);
    const seedTotal = countSeedFile(seedPath);

    // Calculate valid count if seed file exists
    let seedValid = null;
    if (seedTotal !== null && seedTotal > 0) {
      try {
        const records = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const validation = validateImport(entity.className, records);
        seedValid = validation.validCount;
      } catch {
        seedValid = 0;
      }
    }

    entities.push({
      name: entity.className,
      tableName: entity.tableName,
      rowCount,
      seedTotal,      // Total records in seed file
      seedValid       // Valid records (can be loaded)
    });
  }

  return { entities };
}

/**
 * Build lookup for unique columns: value -> existing record id
 * Used to detect import conflicts
 */
function buildUniqueLookup(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return {};

  // Find unique columns (single-column constraints)
  const uniqueCols = entity.columns.filter(c => c.unique).map(c => c.name);

  // Find composite unique keys
  const compositeKeys = Object.values(entity.uniqueKeys || {});

  if (uniqueCols.length === 0 && compositeKeys.length === 0) return {};

  const lookup = {};
  const rows = db.prepare(`SELECT * FROM ${entity.tableName}`).all();

  for (const row of rows) {
    // Single-column unique constraints
    for (const col of uniqueCols) {
      if (row[col] !== null && row[col] !== undefined) {
        const key = `${col}:${row[col]}`;
        lookup[key] = row.id;
      }
    }

    // Composite unique keys
    for (const keyCols of compositeKeys) {
      const values = keyCols.map(c => row[c]);
      if (values.every(v => v !== null && v !== undefined)) {
        const key = keyCols.map((c, i) => `${c}:${values[i]}`).join('|');
        lookup[key] = row.id;
      }
    }
  }

  return lookup;
}

/**
 * Check if an existing record has back-references from other entities
 * Returns count of referencing records
 */
function countBackReferences(entityName, recordId) {
  const { db, schema } = getDbAndSchema();
  const inverseRels = schema.inverseRelationships[entityName] || [];

  let totalRefs = 0;
  const referencingEntities = [];

  for (const rel of inverseRels) {
    const refEntity = schema.entities[rel.entity];
    if (!refEntity) continue;

    const countSql = `SELECT COUNT(*) as count FROM ${refEntity.tableName} WHERE ${rel.column} = ?`;
    const { count } = db.prepare(countSql).get(recordId);

    if (count > 0) {
      totalRefs += count;
      referencingEntities.push({ entity: rel.entity, count });
    }
  }

  return { totalRefs, referencingEntities };
}

/**
 * Validate import data and check FK references
 * Returns warnings for unresolved FKs, identifies valid/invalid records,
 * and detects conflicts with existing records that have back-references
 *
 * @param {string} entityName - Entity name
 * @param {array} records - Array of records to validate
 * @returns {object} - { valid, warnings, recordCount, validCount, invalidRows, conflicts }
 */
function validateImport(entityName, records) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    return { valid: false, warnings: [{ message: `Entity ${entityName} not found` }], recordCount: 0, validCount: 0, invalidRows: [], conflicts: [] };
  }

  if (!Array.isArray(records)) {
    return { valid: false, warnings: [{ message: 'Data must be an array of records' }], recordCount: 0, validCount: 0, invalidRows: [], conflicts: [] };
  }

  const warnings = [];
  const invalidRows = new Set();
  const conflicts = [];

  // Build lookups for FK validation
  const lookups = {};
  for (const fk of entity.foreignKeys) {
    if (!lookups[fk.references.entity]) {
      lookups[fk.references.entity] = buildLabelLookup(fk.references.entity);
    }
  }

  // Build unique lookup for conflict detection
  const uniqueLookup = buildUniqueLookup(entityName);
  const uniqueCols = entity.columns.filter(c => c.unique).map(c => c.name);
  const compositeKeys = Object.entries(entity.uniqueKeys || {});

  // Validate each record
  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Check FK references
    for (const fk of entity.foreignKeys) {
      const conceptualName = fk.displayName;
      const targetEntity = fk.references.entity;

      // Check conceptual name (e.g., "manufacturer": "Airbus")
      if (conceptualName && record[conceptualName]) {
        const labelValue = record[conceptualName];
        const lookup = lookups[targetEntity] || {};

        if (!lookup[labelValue]) {
          warnings.push({
            row: i + 1,
            field: conceptualName,
            value: labelValue,
            targetEntity,
            message: `"${labelValue}" not found in ${targetEntity}`
          });
          invalidRows.add(i + 1);
        }
      }
    }

    // Check for unique constraint conflicts
    for (const col of uniqueCols) {
      if (record[col] !== null && record[col] !== undefined) {
        const key = `${col}:${record[col]}`;
        const existingId = uniqueLookup[key];

        if (existingId) {
          const { totalRefs, referencingEntities } = countBackReferences(entityName, existingId);
          if (totalRefs > 0) {
            conflicts.push({
              row: i + 1,
              field: col,
              value: record[col],
              existingId,
              backRefs: totalRefs,
              referencingEntities,
              message: `"${record[col]}" exists (id=${existingId}) with ${totalRefs} back-references`
            });
          }
        }
      }
    }

    // Check composite unique key conflicts
    for (const [keyName, keyCols] of compositeKeys) {
      const values = keyCols.map(c => record[c]);
      if (values.every(v => v !== null && v !== undefined)) {
        const key = keyCols.map((c, i) => `${c}:${values[i]}`).join('|');
        const existingId = uniqueLookup[key];

        if (existingId) {
          const { totalRefs, referencingEntities } = countBackReferences(entityName, existingId);
          if (totalRefs > 0) {
            conflicts.push({
              row: i + 1,
              field: keyName,
              value: keyCols.map((c, i) => `${c}=${values[i]}`).join(', '),
              existingId,
              backRefs: totalRefs,
              referencingEntities,
              message: `Composite key ${keyName} exists (id=${existingId}) with ${totalRefs} back-references`
            });
          }
        }
      }
    }
  }

  const invalidRowsArray = Array.from(invalidRows).sort((a, b) => a - b);

  return {
    valid: warnings.length === 0,
    warnings,
    recordCount: records.length,
    validCount: records.length - invalidRows.size,
    invalidRows: invalidRowsArray,
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}

/**
 * Find existing record by unique constraint
 * Returns the id if a matching record exists, null otherwise
 */
function findExistingByUnique(entityName, record) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  // Check single-column unique constraints
  const uniqueCols = entity.columns.filter(c => c.unique);
  for (const col of uniqueCols) {
    const value = record[col.name];
    if (value !== null && value !== undefined) {
      const sql = `SELECT id FROM ${entity.tableName} WHERE ${col.name} = ?`;
      const existing = db.prepare(sql).get(value);
      if (existing) return existing.id;
    }
  }

  // Check composite unique keys
  for (const [, keyCols] of Object.entries(entity.uniqueKeys || {})) {
    const values = keyCols.map(c => record[c]);
    if (values.every(v => v !== null && v !== undefined)) {
      const conditions = keyCols.map(c => `${c} = ?`).join(' AND ');
      const sql = `SELECT id FROM ${entity.tableName} WHERE ${conditions}`;
      const existing = db.prepare(sql).get(...values);
      if (existing) return existing.id;
    }
  }

  return null;
}

/**
 * Load seed data for a specific entity
 * Supports both technical FK notation (type_id: 3) and conceptual notation (type: "A320neo")
 *
 * @param {string} entityName - Entity name
 * @param {object} lookups - Pre-built label lookups for FK resolution (optional)
 * @param {object} options - { skipInvalid, mode: 'replace'|'merge'|'skip_conflicts' }
 *   - replace: INSERT OR REPLACE (default, may break FK refs)
 *   - merge: UPDATE existing records (preserve id), INSERT new ones
 *   - skip_conflicts: Skip records that would conflict with existing ones
 * @returns {object} - { loaded, updated, skipped }
 */
function loadEntity(entityName, lookups = null, options = {}) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  const { skipInvalid = false, mode = 'replace' } = options;

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const seedFile = path.join(SEED_DIR, `${entityName}.json`);
  if (!fs.existsSync(seedFile)) {
    throw new Error(`No seed file found for ${entityName}`);
  }

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) {
    return { loaded: 0, updated: 0, skipped: 0 };
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

  // If skipInvalid is true, validate first and get invalid row indices
  let invalidRows = new Set();
  if (skipInvalid) {
    const validation = validateImport(entityName, records);
    invalidRows = new Set(validation.invalidRows.map(r => r - 1)); // Convert to 0-based
  }

  // Filter out computed columns (DAILY, IMMEDIATE, etc.) - they are auto-calculated
  const isComputedColumn = (col) => {
    if (col.computed) return true;  // Schema already parsed
    const desc = col.description || '';
    return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
  };

  const columns = entity.columns.filter(c => !isComputedColumn(c)).map(c => c.name);
  const columnsWithoutId = columns.filter(c => c !== 'id');
  const placeholders = columns.map(() => '?').join(', ');

  // Prepare statements based on mode
  const insertReplaceSql = `INSERT OR REPLACE INTO ${entity.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
  const insertSql = `INSERT INTO ${entity.tableName} (${columnsWithoutId.join(', ')}) VALUES (${columnsWithoutId.map(() => '?').join(', ')})`;
  const updateSetClause = columnsWithoutId.map(c => `${c} = ?`).join(', ');
  const updateSql = `UPDATE ${entity.tableName} SET ${updateSetClause} WHERE id = ?`;

  const insertReplace = db.prepare(insertReplaceSql);
  const insert = db.prepare(insertSql);
  const update = db.prepare(updateSql);

  let loaded = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < records.length; i++) {
    // Skip invalid records if requested
    if (skipInvalid && invalidRows.has(i)) {
      skipped++;
      continue;
    }

    const record = records[i];
    // Resolve conceptual FK references (e.g., "type": "A320neo" -> "type_id": 3)
    const resolved = resolveConceptualFKs(entityName, record, lookups);

    try {
      if (mode === 'replace') {
        // Original behavior: INSERT OR REPLACE (may change id)
        const values = columns.map(col => resolved[col] ?? null);
        insertReplace.run(...values);
        loaded++;
      } else if (mode === 'merge') {
        // MERGE: Update existing (preserve id), insert new
        const existingId = findExistingByUnique(entityName, resolved);
        if (existingId) {
          const values = columnsWithoutId.map(col => resolved[col] ?? null);
          values.push(existingId); // WHERE id = ?
          update.run(...values);
          updated++;
        } else {
          const values = columnsWithoutId.map(col => resolved[col] ?? null);
          insert.run(...values);
          loaded++;
        }
      } else if (mode === 'skip_conflicts') {
        // Skip records that conflict with existing ones
        const existingId = findExistingByUnique(entityName, resolved);
        if (existingId) {
          skipped++;
        } else {
          const values = columnsWithoutId.map(col => resolved[col] ?? null);
          insert.run(...values);
          loaded++;
        }
      }
    } catch (err) {
      console.error(`Error loading ${entityName}:`, err.message);
      skipped++;
    }
  }

  return { loaded, updated, skipped };
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
 * Builds label lookups incrementally for FK resolution
 */
function loadAll() {
  const { schema } = getDbAndSchema();
  const results = {};

  // Build lookups incrementally as entities are loaded (for FK resolution)
  const lookups = {};

  // Load in dependency order
  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(SEED_DIR, `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = loadEntity(entity.className, lookups);
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

/**
 * Upload/save data for an entity (saves to seed/)
 * Data is always saved as JSON, regardless of original format
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
    throw new Error('Data must be an array of records');
  }

  const filePath = path.join(SEED_DIR, `${entityName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));

  return { uploaded: records.length, file: `${entityName}.json` };
}

module.exports = {
  getStatus,
  validateImport,
  loadEntity,
  clearEntity,
  loadAll,
  clearAll,
  resetAll,
  uploadEntity,
  buildLabelLookup,
  // Export path for testing
  SEED_DIR
};
