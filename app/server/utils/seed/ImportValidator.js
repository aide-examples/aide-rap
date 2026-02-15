/**
 * ImportValidator - Import validation, conflict detection, status reporting
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

const fs = require('fs');
const path = require('path');
const {
  buildLabelLookup,
  buildLabelLookupFromSeed,
  buildLookupFromImportRecords,
  getLabelSeparator,
  fuzzyLabelMatch
} = require('./LabelResolver');
const { findByUniqueField, resolveConceptualFKs } = require('./FKResolver');

/**
 * Count records in a seed file
 * @param {string} filePath - Path to the seed file
 * @returns {number|null} - Record count or null if file doesn't exist
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
 * Get status of all enabled entities.
 * Returns row counts, seed file availability, and valid record counts.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} seedDir - Path to seed directory
 * @param {string} backupDir - Path to backup directory
 * @param {string} importDir - Path to import directory
 * @returns {object} - { entities: Array }
 */
function getStatus(db, schema, seedDir, backupDir, importDir) {
  const entities = [];

  for (const entity of schema.orderedEntities) {
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get().count;
    const seedFile = `${entity.className}.json`;
    const seedPath = path.join(seedDir, seedFile);
    const seedTotal = countSeedFile(seedPath);

    // Calculate valid count if seed file exists
    let seedValid = null;
    if (seedTotal !== null && seedTotal > 0) {
      try {
        const records = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const validation = validateImport(db, entity, schema, records, seedDir);
        seedValid = validation.validCount;
      } catch {
        seedValid = 0;
      }
    }

    // Count backup records
    const backupPath = path.join(backupDir, seedFile);
    const backupTotal = countSeedFile(backupPath);

    // Count import records
    const importPath = path.join(importDir, seedFile);
    const importTotal = countSeedFile(importPath);

    // Calculate valid count if import file exists
    let importValid = null;
    if (importTotal !== null && importTotal > 0) {
      try {
        const records = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
        const validation = validateImport(db, entity, schema, records, seedDir);
        importValid = validation.validCount;
      } catch {
        importValid = 0;
      }
    }

    entities.push({
      name: entity.className,
      tableName: entity.tableName,
      rowCount,
      seedTotal,
      seedValid,
      backupTotal,
      importTotal,
      importValid
    });
  }

  // Pass 2: Compute FK readiness
  const statusMap = {};
  for (const e of entities) {
    statusMap[e.name] = e;
  }

  for (const entity of schema.orderedEntities) {
    const status = statusMap[entity.className];
    const deps = [];
    const missing = [];

    for (const fk of entity.foreignKeys) {
      const target = fk.references?.entity;
      if (!target || target === entity.className) continue;
      if (!deps.includes(target)) deps.push(target);

      const targetStatus = statusMap[target];
      if (targetStatus) {
        const hasData = targetStatus.rowCount > 0;
        const hasSeed = targetStatus.seedTotal !== null && targetStatus.seedTotal > 0;
        if (!hasData && !hasSeed && !missing.includes(target)) {
          missing.push(target);
        }
      }
    }

    status.dependencies = deps;
    status.missingDeps = missing;
    status.ready = missing.length === 0;
  }

  return { entities };
}

/**
 * Build lookup for unique columns: value -> existing record id
 * Used to detect import conflicts.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @returns {object} - Lookup map
 */
function buildUniqueLookup(db, entity) {
  if (!entity) return {};

  const uniqueCols = entity.columns.filter(c => c.unique).map(c => c.name);
  const compositeKeys = Object.values(entity.uniqueKeys || {});

  if (uniqueCols.length === 0 && compositeKeys.length === 0) return {};

  const lookup = {};
  const rows = db.prepare(`SELECT * FROM ${entity.tableName}`).all();

  for (const row of rows) {
    for (const col of uniqueCols) {
      if (row[col] !== null && row[col] !== undefined) {
        const key = `${col}:${row[col]}`;
        lookup[key] = row.id;
      }
    }

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
 * Check if an existing record has back-references from other entities.
 * Returns count of referencing records.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} entityName - Entity name
 * @param {number} recordId - Record ID
 * @returns {object} - { totalRefs, referencingEntities }
 */
function countBackReferences(db, schema, entityName, recordId) {
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
 * Validate import data and check FK references.
 * Returns warnings for unresolved FKs, identifies valid/invalid records,
 * and detects conflicts with existing records that have back-references.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema
 * @param {array} records - Array of records to validate
 * @param {string} seedDir - Path to seed directory (for seed-file fallback lookups)
 * @returns {object} - { valid, warnings, recordCount, validCount, invalidRows, conflicts }
 */
function validateImport(db, entity, schema, records, seedDir) {
  if (!entity) {
    return { valid: false, warnings: [{ message: 'Entity not found' }], recordCount: 0, validCount: 0, invalidRows: [], conflicts: [] };
  }

  if (!Array.isArray(records)) {
    return { valid: false, warnings: [{ message: 'Data must be an array of records' }], recordCount: 0, validCount: 0, invalidRows: [], conflicts: [] };
  }

  const warnings = [];
  const invalidRows = new Set();
  const conflicts = [];
  const seedFallbacks = [];

  // Build lookups for FK validation (with seed file fallback)
  const lookups = {};
  for (const fk of entity.foreignKeys) {
    const targetEntityName = fk.references?.entity || entity.className;
    if (!lookups[targetEntityName]) {
      if (targetEntityName === entity.className) {
        lookups[entity.className] = buildLookupFromImportRecords(entity, records);
      } else {
        const targetEntity = schema.entities[targetEntityName];
        const dbLookup = buildLabelLookup(db, targetEntity);
        if (Object.keys(dbLookup).length > 0) {
          lookups[targetEntityName] = dbLookup;
        } else {
          const { lookup: seedLookup, found } = buildLabelLookupFromSeed(targetEntity, seedDir);
          lookups[targetEntityName] = seedLookup;
          if (found) {
            seedFallbacks.push(targetEntityName);
          }
        }
      }
    }
  }

  // Build unique lookup for conflict detection
  const uniqueLookup = buildUniqueLookup(db, entity);
  const uniqueCols = entity.columns.filter(c => c.unique).map(c => c.name);
  const compositeKeys = Object.entries(entity.uniqueKeys || {});

  // Track seen values for intra-batch duplicate detection
  const batchSeen = {};
  for (const col of uniqueCols) {
    batchSeen[col] = new Map();
  }
  for (const [keyName] of compositeKeys) {
    batchSeen[keyName] = new Map();
  }

  // Validate each record
  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Check FK references
    for (const fk of entity.foreignKeys) {
      const conceptualName = fk.displayName;
      const technicalName = fk.column;
      const targetEntityName = fk.references?.entity || entity.className;
      const fkColumn = entity.columns.find(c => c.name === technicalName);
      const isOptionalFK = fkColumn?.optional === true;

      let fieldName, labelValue;
      if (conceptualName && record[conceptualName]) {
        fieldName = conceptualName;
        labelValue = record[conceptualName];
      } else if (technicalName in record && typeof record[technicalName] === 'string' && isNaN(Number(record[technicalName]))) {
        fieldName = technicalName;
        labelValue = record[technicalName];
      }

      if (!labelValue) continue;

      const lookup = lookups[targetEntityName] || {};

      if (!lookup[labelValue]) {
        // Fallback 1: fuzzy matching for concat-based labels
        const targetEntitySchema = schema.entities[targetEntityName];
        const separator = targetEntitySchema ? getLabelSeparator(targetEntitySchema.labelExpression) : null;
        const fuzzyResult = separator ? fuzzyLabelMatch(labelValue, lookup, separator) : null;

        if (fuzzyResult) {
          lookup[labelValue] = fuzzyResult.id;
        } else {
          // Fallback 2: UNIQUE field match
          const targetEntity = schema.entities[targetEntityName];
          const uniqueId = targetEntity ? findByUniqueField(db, targetEntity, labelValue) : null;
          if (uniqueId !== null) {
            lookup[labelValue] = uniqueId;
          } else {
            warnings.push({
              row: i + 1,
              field: fieldName,
              value: labelValue,
              targetEntity: targetEntityName,
              message: `"${labelValue}" not found in ${targetEntityName}`
            });
            if (!isOptionalFK) {
              invalidRows.add(i + 1);
            }
          }
        }
      }
    }

    // Check for unique constraint conflicts
    for (const col of uniqueCols) {
      if (record[col] !== null && record[col] !== undefined) {
        const key = `${col}:${record[col]}`;
        const existingId = uniqueLookup[key];

        if (existingId) {
          const { totalRefs, referencingEntities } = countBackReferences(db, schema, entity.className, existingId);
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
          const { totalRefs, referencingEntities } = countBackReferences(db, schema, entity.className, existingId);
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

    // Check intra-batch duplicates
    for (const col of uniqueCols) {
      const val = record[col];
      if (val !== null && val !== undefined) {
        const key = String(val);
        if (batchSeen[col].has(key)) {
          warnings.push({
            row: i + 1,
            field: col,
            value: val,
            message: `Duplicate "${val}" in batch — same value in row ${batchSeen[col].get(key)}`
          });
          invalidRows.add(i + 1);
        } else {
          batchSeen[col].set(key, i + 1);
        }
      }
    }

    for (const [keyName, keyCols] of compositeKeys) {
      const values = keyCols.map(c => record[c]);
      if (values.every(v => v !== null && v !== undefined)) {
        const key = keyCols.map((c, j) => `${c}:${values[j]}`).join('|');
        if (batchSeen[keyName].has(key)) {
          warnings.push({
            row: i + 1,
            field: keyName,
            value: keyCols.map((c, j) => `${c}=${values[j]}`).join(', '),
            message: `Duplicate composite key ${keyName} in batch — same values in row ${batchSeen[keyName].get(key)}`
          });
          invalidRows.add(i + 1);
        } else {
          batchSeen[keyName].set(key, i + 1);
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
    hasConflicts: conflicts.length > 0,
    seedFallbacks
  };
}

/**
 * Get the first unique column value from a record (for logging/tracking)
 * @param {object} entity - Entity schema
 * @param {object} record - Record data
 * @returns {any} - First unique column value or null
 */
function getFirstUniqueValue(entity, record) {
  const uniqueCols = entity.columns.filter(c => c.unique);
  for (const col of uniqueCols) {
    const value = record[col.name];
    if (value != null) return value;
  }

  if (entity.uniqueKeys?.length > 0) {
    const firstUk = entity.uniqueKeys[0];
    const parts = firstUk.columns.map(colName => record[colName] ?? '').join('-');
    if (parts && parts !== '-') return parts;
  }

  return null;
}

/**
 * Find existing record by unique constraint.
 * Returns the id if a matching record exists, null otherwise.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} record - Record to check
 * @returns {number|null} - Existing record ID or null
 */
function findExistingByUnique(db, entity, record) {
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

  // Fallback: check LABEL column (business key) if no explicit unique constraints matched
  if (uniqueCols.length === 0 && Object.keys(entity.uniqueKeys || {}).length === 0) {
    const labelCol = entity.columns.find(c => c.ui?.label);
    if (labelCol) {
      const value = record[labelCol.name];
      if (value !== null && value !== undefined) {
        const sql = `SELECT id FROM ${entity.tableName} WHERE ${labelCol.name} = ?`;
        const existing = db.prepare(sql).get(value);
        if (existing) return existing.id;
      }
    }
  }

  return null;
}

/**
 * Count how many seed records conflict with existing DB records (by unique constraint).
 * Used by the preview dialog to warn about duplicates before loading.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema
 * @param {string} resolvedDir - Resolved directory path to read records from
 * @param {string} seedDir - Seed directory (for FK fallback lookups)
 * @returns {object} - { dbRowCount, conflictCount }
 */
function countSeedConflicts(db, entity, schema, resolvedDir, seedDir) {
  if (!entity) return { dbRowCount: 0, conflictCount: 0 };

  const dbRowCount = db.prepare(`SELECT COUNT(*) as cnt FROM ${entity.tableName}`).get().cnt;
  if (dbRowCount === 0) return { dbRowCount: 0, conflictCount: 0 };

  // Read seed/import file
  const seedFile = path.join(resolvedDir, `${entity.className}.json`);
  if (!fs.existsSync(seedFile)) return { dbRowCount, conflictCount: 0 };

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) return { dbRowCount, conflictCount: 0 };

  // Build FK lookups for resolving conceptual names
  const lookups = {};
  for (const fk of entity.foreignKeys) {
    const targetEntityName = fk.references?.entity || entity.className;
    if (!lookups[targetEntityName]) {
      const targetEntity = schema.entities[targetEntityName];
      lookups[targetEntityName] = buildLabelLookup(db, targetEntity);
    }
  }

  // Create a findByUniqueFn for FK resolution
  const findByUniqueFn = (targetEntityName, value) => {
    const targetEntity = schema.entities[targetEntityName];
    return targetEntity ? findByUniqueField(db, targetEntity, value) : null;
  };

  // Resolve FKs and check each record for conflicts
  let conflictCount = 0;
  for (const record of records) {
    const { resolved } = resolveConceptualFKs(entity, record, lookups, schema, findByUniqueFn);
    if (findExistingByUnique(db, entity, resolved)) {
      conflictCount++;
    }
  }

  return { dbRowCount, conflictCount };
}

module.exports = {
  countSeedFile,
  getStatus,
  buildUniqueLookup,
  countBackReferences,
  validateImport,
  getFirstUniqueValue,
  findExistingByUnique,
  countSeedConflicts
};
