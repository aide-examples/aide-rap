/**
 * DataLoader - Entity data loading, clearing, and bulk operations
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
  computeLabelFromExpression
} = require('./LabelResolver');
const { resolveConceptualFKs, findByUniqueField } = require('./FKResolver');
const { resolveMediaUrls, flattenAggregates } = require('./MediaResolver');
const { validateImport, findExistingByUnique, getFirstUniqueValue } = require('./ImportValidator');

/**
 * Load seed data for a specific entity.
 * Supports both technical FK notation (type_id: 3) and conceptual notation (type: "A320neo").
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema
 * @param {string} sourceDir - Resolved directory to read entity JSON from
 * @param {string} seedDir - Seed directory (for FK fallback lookups)
 * @param {object} lookups - Pre-built label lookups for FK resolution (optional)
 * @param {object} options - { skipInvalid, mode, preserveSystemColumns, validateFields, validateConstraints, mediaService, typeRegistry }
 * @returns {Promise<object>} - { loaded, updated, skipped, replaced, errors, ... }
 */
async function loadEntity(db, entity, schema, sourceDir, seedDir, lookups = null, options = {}) {
  const {
    skipInvalid = false, mode = 'replace', preserveSystemColumns = false,
    validateFields = false,
    validateConstraints = true,
    mediaService = null,
    typeRegistry = null
  } = options;

  if (!entity) {
    throw new Error('Entity not found in schema');
  }

  const entityName = entity.className;
  const seedFile = path.join(sourceDir, `${entityName}.json`);
  if (!fs.existsSync(seedFile)) {
    throw new Error(`No data file found for ${entityName} in ${sourceDir}`);
  }

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) {
    return { loaded: 0, updated: 0, skipped: 0 };
  }

  // Build lookups for FK resolution if not provided (with seed file fallback)
  if (!lookups) {
    lookups = {};
    for (const fk of entity.foreignKeys) {
      const targetEntityName = fk.references?.entity || entityName;
      if (!lookups[targetEntityName]) {
        if (targetEntityName === entityName) {
          lookups[entityName] = buildLookupFromImportRecords(entity, records);
        } else {
          const targetEntity = schema.entities[targetEntityName];
          const dbLookup = buildLabelLookup(db, targetEntity);
          if (Object.keys(dbLookup).length > 0) {
            lookups[targetEntityName] = dbLookup;
          } else {
            const { lookup: seedLookup } = buildLabelLookupFromSeed(targetEntity, seedDir);
            lookups[targetEntityName] = seedLookup;
          }
        }
      }
    }
  }

  // Create findByUniqueFn for FK resolution fallback
  const findByUniqueFn = (targetEntityName, value) => {
    const targetEntity = schema.entities[targetEntityName];
    return targetEntity ? findByUniqueField(db, targetEntity, value) : null;
  };

  // If skipInvalid is true, validate first and get invalid row indices
  let invalidRows = new Set();
  let validationWarnings = [];
  if (skipInvalid) {
    const validation = validateImport(db, entity, schema, records, seedDir);
    invalidRows = new Set(validation.invalidRows.map(r => r - 1)); // Convert to 0-based
    validationWarnings = validation.warnings || [];
  }

  // Initialize ObjectValidator for import validation (if any validation is enabled)
  const needsValidation = validateFields || validateConstraints;
  let validator = null;
  if (needsValidation && entity.validationRules) {
    const ObjectValidator = require('../../../shared/validation/ObjectValidator');
    validator = new ObjectValidator();
    validator.defineRules(entityName, entity.validationRules, false, entity.objectRules || null);
    // Cross-entity lookup for custom constraints (batch cache lives for entire import)
    const lookupCache = new Map();
    validator.lookupFn = (lookupEntity, id) => {
      if (!id) return null;
      const key = `${lookupEntity}:${id}`;
      if (lookupCache.has(key)) return lookupCache.get(key);
      const targetEntity = schema.entities[lookupEntity];
      if (!targetEntity) return null;
      const record = db.prepare(`SELECT * FROM ${targetEntity.tableName} WHERE id = ?`).get(id);
      lookupCache.set(key, record || null);
      return record || null;
    };
    const existsCache = new Map();
    validator.existsFn = (existsEntity, conditions) => {
      if (!conditions || typeof conditions !== 'object') return false;
      const targetEntity = schema.entities[existsEntity];
      if (!targetEntity) return false;
      const keys = Object.keys(conditions).sort();
      const cacheKey = `${existsEntity}:${keys.map(k => `${k}=${conditions[k]}`).join(',')}`;
      if (existsCache.has(cacheKey)) return existsCache.get(cacheKey);
      const where = keys.map(k => `${k} = ?`).join(' AND ');
      const values = keys.map(k => conditions[k]);
      const result = !!db.prepare(`SELECT 1 FROM ${targetEntity.tableName} WHERE ${where} LIMIT 1`).get(...values);
      existsCache.set(cacheKey, result);
      return result;
    };
  }

  // Check for self-referential FKs - if present, disable FK constraints during import
  const hasSelfRef = entity.foreignKeys.some(fk => (fk.references?.entity || entityName) === entityName);
  if (hasSelfRef) {
    db.pragma('foreign_keys = OFF');
  }

  // Filter out computed columns (DAILY, IMMEDIATE, etc.) - they are auto-calculated
  // Exception: computed FK columns are kept — seed data can provide initial relationship values
  const isComputedColumn = (col) => {
    if (col.foreignKey) return false;
    if (col.computed) return true;
    const desc = col.description || '';
    return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
  };

  // Exclude system columns unless preserveSystemColumns is true (for restore)
  const columns = entity.columns
    .filter(c => !isComputedColumn(c) && (preserveSystemColumns || !c.system))
    .map(c => c.name);
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
  const errors = [];
  const mediaErrors = [];
  const fkErrorMap = new Map();
  const fuzzyMatchMap = new Map();

  // Track duplicates within the import batch
  const labelCol = entity.columns.find(c => c.ui?.label);
  const seenLabels = new Map();
  const duplicates = [];

  // Track which keys were updated (for reporting)
  const updatedKeys = new Map();

  // Track row count before loading to detect silent replacements
  const beforeCount = db.prepare(`SELECT COUNT(*) as c FROM ${entity.tableName}`).get().c;

  for (let i = 0; i < records.length; i++) {
    if (skipInvalid && invalidRows.has(i)) {
      skipped++;
      continue;
    }

    let record = records[i];

    // Resolve media URLs (fetch URLs and replace with UUIDs)
    const mediaResult = await resolveMediaUrls(entity, record, mediaService);
    record = mediaResult.record;

    for (const mediaErr of mediaResult.mediaErrors) {
      mediaErrors.push({ row: i + 1, ...mediaErr });
    }

    // Flatten nested aggregate values
    if (typeRegistry) {
      record = flattenAggregates(entity, record, typeRegistry);
    }

    // Resolve conceptual FK references
    const { resolved, fkWarnings, fuzzyMatches } = resolveConceptualFKs(entity, record, lookups, schema, findByUniqueFn);

    // Collect FK resolution errors - aggregate by unique (field, value, targetEntity)
    for (const fkWarn of fkWarnings) {
      const key = `${fkWarn.field}|${fkWarn.value}|${fkWarn.targetEntity}`;
      if (fkErrorMap.has(key)) {
        fkErrorMap.get(key).count++;
      } else {
        fkErrorMap.set(key, { field: fkWarn.field, value: fkWarn.value, targetEntity: fkWarn.targetEntity, count: 1 });
      }
    }

    // Collect fuzzy matches
    for (const fm of fuzzyMatches) {
      const key = `${fm.field}|${fm.value}|${fm.matchedLabel}|${fm.targetEntity}`;
      if (fuzzyMatchMap.has(key)) {
        fuzzyMatchMap.get(key).count++;
      } else {
        fuzzyMatchMap.set(key, { ...fm, count: 1 });
      }
    }

    // Validate record against field-level and/or cross-field rules
    if (validator) {
      const validationErrors = [];
      if (validateFields) {
        validationErrors.push(...validator.validateFieldRulesOnly(entityName, resolved));
      }
      if (validateConstraints) {
        validationErrors.push(...validator.validateObjectRulesOnly(entityName, resolved));
      }
      if (validationErrors.length > 0) {
        for (const err of validationErrors) {
          if (errors.length < 10) {
            errors.push(`Row ${i + 1}: ${err.message}`);
          }
        }
        skipped++;
        continue;
      }
    }

    // Track duplicates within import batch
    if (labelCol) {
      const labelValue = resolved[labelCol.name];
      if (labelValue != null) {
        if (seenLabels.has(labelValue)) {
          duplicates.push({ value: labelValue, firstRow: seenLabels.get(labelValue), duplicateRow: i + 1 });
        } else {
          seenLabels.set(labelValue, i + 1);
        }
      }
    }

    // SQLite3 cannot bind JS booleans — convert to 0/1
    const toSqlValue = (v) => v === true ? 1 : v === false ? 0 : v ?? null;

    try {
      if (mode === 'replace') {
        const values = columns.map(col => toSqlValue(resolved[col]));
        insertReplace.run(...values);
        loaded++;
      } else if (mode === 'merge') {
        const existingId = findExistingByUnique(db, entity, resolved);
        if (existingId) {
          const values = columnsWithoutId.map(col => toSqlValue(resolved[col]));
          values.push(existingId);
          update.run(...values);
          updated++;

          let keyValue = null;
          if (labelCol) {
            keyValue = resolved[labelCol.name];
          } else if (entity.labelExpression) {
            keyValue = computeLabelFromExpression(entity.labelExpression, record);
          } else {
            keyValue = getFirstUniqueValue(entity, resolved);
          }
          if (keyValue != null) {
            updatedKeys.set(keyValue, (updatedKeys.get(keyValue) || 0) + 1);
          }
        } else {
          const values = columnsWithoutId.map(col => toSqlValue(resolved[col]));
          insert.run(...values);
          loaded++;
        }
      } else if (mode === 'skip_conflicts') {
        const existingId = findExistingByUnique(db, entity, resolved);
        if (existingId) {
          skipped++;
        } else {
          const values = columnsWithoutId.map(col => toSqlValue(resolved[col]));
          insert.run(...values);
          loaded++;
        }
      }
    } catch (err) {
      console.error(`Error loading ${entityName} row ${i + 1}:`, err.message);
      if (errors.length < 5) {
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
      skipped++;
    }
  }

  // Detect silent replacements
  const afterCount = db.prepare(`SELECT COUNT(*) as c FROM ${entity.tableName}`).get().c;
  const netNew = afterCount - beforeCount;
  const replaced = loaded > netNew ? loaded - netNew : 0;
  if (replaced > 0) {
    loaded = netNew;
    if (errors.length < 5) {
      errors.push(`${replaced} rows replaced existing rows (unique key collision)`);
    }
  }

  const result = { loaded, updated, skipped, replaced, errors };

  // Add validation warnings (FK lookup failures from validateImport) - aggregated
  if (validationWarnings.length > 0) {
    const warningMap = new Map();
    for (const w of validationWarnings) {
      const key = `${w.field}|${w.value}|${w.targetEntity}`;
      if (warningMap.has(key)) {
        warningMap.get(key).count++;
      } else {
        warningMap.set(key, { field: w.field, value: w.value, targetEntity: w.targetEntity, count: 1 });
      }
    }
    result.fkErrors = Array.from(warningMap.values())
      .sort((a, b) => b.count - a.count)
      .map(e => ({ field: e.field, value: e.value, targetEntity: e.targetEntity, count: e.count,
        message: `"${e.value}" not found in ${e.targetEntity} (${e.count} records)` }));
    result.fkErrorsTotal = validationWarnings.length;
  }

  // Add FK resolution errors from resolveConceptualFKs during load
  if (fkErrorMap.size > 0 && !result.fkErrors) {
    const fkErrors = Array.from(fkErrorMap.values())
      .sort((a, b) => b.count - a.count)
      .map(e => ({ field: e.field, value: e.value, targetEntity: e.targetEntity, count: e.count,
        message: `"${e.value}" not found in ${e.targetEntity} (${e.count} records)` }));
    result.fkErrors = fkErrors;
    result.fkErrorsTotal = fkErrors.reduce((sum, e) => sum + e.count, 0);
  }

  // Add fuzzy match info
  if (fuzzyMatchMap.size > 0) {
    result.fuzzyMatches = Array.from(fuzzyMatchMap.values())
      .sort((a, b) => b.count - a.count)
      .map(e => ({ field: e.field, value: e.value, matchedLabel: e.matchedLabel, targetEntity: e.targetEntity, count: e.count,
        message: `"${e.value}" → "${e.matchedLabel}" in ${e.targetEntity} (${e.count} records)` }));
    result.fuzzyMatchTotal = Array.from(fuzzyMatchMap.values()).reduce((sum, e) => sum + e.count, 0);
  }

  // Add duplicate warnings
  if (duplicates.length > 0) {
    result.duplicates = duplicates.map(d => ({ value: d.value, firstRow: d.firstRow, duplicateRow: d.duplicateRow,
      message: `"${d.value}" appears in row ${d.firstRow} and ${d.duplicateRow} (row ${d.duplicateRow} overwrites)` }));
  }

  // Add updated keys info
  if (updatedKeys.size > 0) {
    result.updatedKeys = Array.from(updatedKeys.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));
  }

  // Add media errors
  if (mediaErrors.length > 0) {
    result.mediaErrors = mediaErrors;
  }

  // Re-enable FK constraints if we disabled them for self-refs
  if (hasSelfRef) {
    db.pragma('foreign_keys = ON');
  }

  return result;
}

/**
 * Clear all data from a specific entity.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema (for checking back-references)
 * @returns {object} - { deleted }
 */
function clearEntity(db, entity, schema) {
  if (!entity) {
    throw new Error('Entity not found in schema');
  }

  const entityName = entity.className;

  // Check for FK constraints - are there entities that reference this one?
  const backRefs = schema.inverseRelationships[entityName] || [];
  for (const ref of backRefs) {
    if (ref.entity === entityName) continue;

    const refEntity = schema.entities[ref.entity];
    if (refEntity) {
      try {
        const refCount = db.prepare(`SELECT COUNT(*) as count FROM ${refEntity.tableName} WHERE ${ref.column} IS NOT NULL`).get().count;
        if (refCount > 0) {
          throw new Error(`Cannot clear ${entityName}: ${refCount} records in ${ref.entity} reference it`);
        }
      } catch (e) {
        if (e.message?.includes('no such column')) {
          console.warn(`[DataLoader] Skipping FK check for ${ref.entity}.${ref.column} - column not in DB (schema may need rebuild)`);
          continue;
        }
        throw e;
      }
    }
  }

  const result = db.prepare(`DELETE FROM ${entity.tableName}`).run();
  return { deleted: result.changes };
}

/**
 * Load all available seed files.
 * Builds label lookups incrementally for FK resolution.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} seedDir - Path to seed directory
 * @param {object} options - { mediaService, typeRegistry }
 * @returns {Promise<object>} - Results per entity
 */
async function loadAll(db, schema, seedDir, options = {}) {
  const results = {};
  const lookups = {};

  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(seedDir, `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = await loadEntity(db, entity, schema, seedDir, seedDir, lookups, { ...options, mode: 'merge' });
        results[entity.className] = result;

        // Update lookup for this entity (so subsequent entities can reference it)
        lookups[entity.className] = buildLabelLookup(db, entity);
      } catch (err) {
        results[entity.className] = { error: err.message };
      }
    }
  }

  return results;
}

/**
 * Import all available data files (prefers import/ over seed/).
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} importDir - Path to import directory
 * @param {string} seedDir - Path to seed directory (fallback)
 * @param {object} options - { mediaService, typeRegistry }
 * @returns {Promise<object>} - Results per entity
 */
async function importAll(db, schema, importDir, seedDir, options = {}) {
  const results = {};
  const lookups = {};

  for (const entity of schema.orderedEntities) {
    const importFile = path.join(importDir, `${entity.className}.json`);
    const seedFile = path.join(seedDir, `${entity.className}.json`);

    const sourceFile = fs.existsSync(importFile) ? importFile :
                       fs.existsSync(seedFile) ? seedFile : null;

    if (sourceFile) {
      try {
        const source = sourceFile === importFile ? 'import' : 'seed';
        const resolvedSourceDir = source === 'import' ? importDir : seedDir;

        const result = await loadEntity(db, entity, schema, resolvedSourceDir, seedDir, lookups, {
          ...options, mode: 'merge'
        });

        results[entity.className] = { ...result, source };
        lookups[entity.className] = buildLabelLookup(db, entity);
      } catch (err) {
        results[entity.className] = { error: err.message };
      }
    }
  }

  return results;
}

/**
 * Clear all entity data.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @returns {object} - Results per entity
 */
function clearAll(db, schema) {
  const results = {};

  db.pragma('foreign_keys = OFF');

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
 * Reset all: clear then load.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} seedDir - Path to seed directory
 * @param {object} options - { mediaService, typeRegistry }
 * @returns {Promise<object>} - { cleared, loaded }
 */
async function resetAll(db, schema, seedDir, options = {}) {
  const clearResults = clearAll(db, schema);
  const loadResults = await loadAll(db, schema, seedDir, options);

  return {
    cleared: clearResults,
    loaded: loadResults
  };
}

module.exports = {
  loadEntity,
  clearEntity,
  loadAll,
  importAll,
  clearAll,
  resetAll
};
