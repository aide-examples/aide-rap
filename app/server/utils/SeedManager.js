/**
 * SeedManager - Manages seed data loading and clearing for entities
 *
 * Single data source: seed/ directory
 * Supports import from JSON and CSV (both saved as JSON)
 */

const fs = require('fs');
const path = require('path');
const eventBus = require('./EventBus');

// Module-level seed directory (configured via init())
let SEED_DIR = null;

// Module-level MediaService instance (for resolving media URLs during seeding)
let mediaService = null;

/**
 * Initialize SeedManager with a specific seed directory
 * @param {string} seedDir - Path to the seed directory
 * @param {Object} [options] - Optional configuration
 * @param {Object} [options.mediaService] - MediaService instance for URL-based media seeding
 */
function init(seedDir, options = {}) {
  SEED_DIR = seedDir;
  // Ensure seed directory exists
  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }

  // Store MediaService for media URL resolution during seeding
  if (options.mediaService) {
    mediaService = options.mediaService;
  }
}

/**
 * Set MediaService instance (can be called after init if MediaService is created later)
 * @param {Object} service - MediaService instance
 */
function setMediaService(service) {
  mediaService = service;
}

/**
 * Check if a string is a valid URL
 * @param {string} str - String to check
 * @returns {boolean}
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract URL from a markdown link [text](url) or return the string if it's a plain URL
 * @param {string} str - String to check (may be markdown link or plain URL)
 * @returns {string|null} - The URL or null if not a valid URL
 */
function extractUrl(str) {
  if (!str || typeof str !== 'string') return null;

  // Check for markdown link [text](url)
  const mdMatch = str.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
  if (mdMatch) {
    const url = mdMatch[2];
    return isValidUrl(url) ? url : null;
  }

  // Plain URL
  return isValidUrl(str) ? str : null;
}

/**
 * Resolve media URLs in a record.
 * For each media-type field, if the value is a URL, fetch it via MediaService
 * and replace with the resulting media UUID.
 * @param {string} entityName - Entity name
 * @param {Object} record - Record to process
 * @returns {Promise<{record: Object, mediaErrors: Array}>} - Record with resolved media UUIDs and any errors
 */
async function resolveMediaUrls(entityName, record) {
  const mediaErrors = [];

  if (!mediaService) {
    console.warn(`[SeedManager] MediaService not set - cannot resolve media URLs`);
    return { record, mediaErrors };
  }

  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) return { record, mediaErrors };

  const resolved = { ...record };

  // Find media-type columns
  const mediaColumns = entity.columns.filter(c => c.customType === 'media');

  // Debug: log what we found
  if (mediaColumns.length > 0) {
    console.log(`[SeedManager] ${entityName} has ${mediaColumns.length} media column(s): ${mediaColumns.map(c => c.name).join(', ')}`);
  }

  for (const col of mediaColumns) {
    const value = record[col.name];

    // Extract URL (handles both plain URLs and markdown links [text](url))
    const url = extractUrl(value);

    // Debug: log the value we're checking
    if (value) {
      console.log(`[SeedManager] Checking ${col.name}: "${value}" - extractedUrl: ${url || 'none'}`);
    }

    // Check if value is a URL (not already a UUID)
    if (url) {
      try {
        console.log(`  Fetching media URL for ${col.name}: ${url.substring(0, 50)}...`);
        // Pass media constraints from schema (e.g., maxWidth, maxHeight from [DIMENSION=800x600])
        const constraints = col.media || null;
        const result = await mediaService.uploadFromUrl(url, 'seed', constraints);
        resolved[col.name] = result.id;
        console.log(`  -> Stored as ${result.id}`);
      } catch (err) {
        console.warn(`  Warning: Could not fetch media URL for ${col.name}: ${err.message}`);
        // Track the error for client feedback
        mediaErrors.push({
          field: col.name,
          url: url.length > 80 ? url.substring(0, 80) + '...' : url,
          error: err.message
        });
        // Set field to null (validation will fail later, or it might be optional)
        resolved[col.name] = null;
      }
    }
  }

  return { record: resolved, mediaErrors };
}

/**
 * Flatten nested aggregate type values in a record.
 * Converts { position: { latitude: 48.1, longitude: 11.5 } }
 * to { position_latitude: 48.1, position_longitude: 11.5 }
 *
 * @param {string} entityName - Entity name
 * @param {Object} record - Record to process
 * @returns {Object} - Record with flattened aggregate values
 */
function flattenAggregates(entityName, record) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) return record;

  const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
  const typeRegistry = getTypeRegistry();

  const flattened = { ...record };

  // Find aggregate columns by looking for aggregateSource metadata
  const aggregateSources = new Set();
  for (const col of entity.columns) {
    if (col.aggregateSource) {
      aggregateSources.add(col.aggregateSource);
    }
  }

  // For each aggregate source, check if record has nested value
  for (const sourceName of aggregateSources) {
    const nestedValue = record[sourceName];

    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      // Find the aggregate type from schema columns
      const aggregateCol = entity.columns.find(c => c.aggregateSource === sourceName);
      if (aggregateCol && aggregateCol.aggregateType) {
        const fields = typeRegistry.getAggregateFields(aggregateCol.aggregateType);

        if (fields) {
          // Flatten nested object to prefixed fields
          for (const field of fields) {
            const flatKey = `${sourceName}_${field.name}`;
            if (nestedValue[field.name] !== undefined) {
              flattened[flatKey] = nestedValue[field.name];
            }
          }
          // Remove the nested key
          delete flattened[sourceName];
        }
      }
    }
  }

  return flattened;
}

/**
 * Get the current seed directory
 * @returns {string} - The seed directory path
 */
function getSeedDir() {
  if (!SEED_DIR) {
    throw new Error('SeedManager not initialized. Call init(seedDir) first.');
  }
  return SEED_DIR;
}

/**
 * Get the backup directory (sibling of seed directory)
 * @returns {string} - The backup directory path
 */
function getBackupDir() {
  return path.join(path.dirname(getSeedDir()), 'backup');
}

/**
 * Get the import directory (sibling of seed directory)
 * @returns {string} - The import directory path
 */
function getImportDir() {
  return path.join(path.dirname(getSeedDir()), 'import');
}

/**
 * Get database and schema from the database module
 */
function getDbAndSchema() {
  const { getDatabase, getSchema } = require('../config/database');
  return { db: getDatabase(), schema: getSchema() };
}

/**
 * Build a lookup map from rows: LABEL value -> id
 * Supports primary LABEL, secondary LABEL2, combined, and index notation.
 */
function buildLookupFromRows(rows, labelCol, label2Col) {
  const lookup = {};
  let rowIndex = 1;

  for (const row of rows) {
    const primaryVal = labelCol ? row[labelCol.name] : null;
    const secondaryVal = label2Col ? row[label2Col.name] : null;

    if (primaryVal) lookup[primaryVal] = row.id;
    if (secondaryVal) lookup[secondaryVal] = row.id;
    if (primaryVal && secondaryVal) {
      lookup[`${primaryVal} (${secondaryVal})`] = row.id;
    }
    lookup[`#${rowIndex}`] = row.id;
    rowIndex++;
  }

  return lookup;
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
 * - Index notation: "#1", "#2", etc. - maps to records by row order (id ascending)
 *   This supports AI-generated seed data that uses "#n" for FK references.
 */
function buildLabelLookup(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return {};

  const labelCol = entity.columns.find(c => c.ui?.label);
  const label2Col = entity.columns.find(c => c.ui?.label2);

  const selectCols = ['id'];
  if (labelCol) selectCols.push(labelCol.name);
  if (label2Col && label2Col.name !== labelCol?.name) selectCols.push(label2Col.name);

  const sql = `SELECT ${selectCols.join(', ')} FROM ${entity.tableName} ORDER BY id`;
  const rows = db.prepare(sql).all();

  return buildLookupFromRows(rows, labelCol, label2Col);
}

/**
 * Build a lookup map from a seed JSON file (fallback when DB table is empty).
 * Returns { lookup, found } where found indicates if a seed file was used.
 */
function buildLabelLookupFromSeed(entityName) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return { lookup: {}, found: false };

  const labelCol = entity.columns.find(c => c.ui?.label);
  const label2Col = entity.columns.find(c => c.ui?.label2);

  try {
    const seedFile = path.join(getSeedDir(), `${entityName}.json`);
    if (!fs.existsSync(seedFile)) return { lookup: {}, found: false };

    const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
    if (!Array.isArray(seedData) || seedData.length === 0) return { lookup: {}, found: false };

    // Seed files use attribute names (not DB column names with _id suffix).
    // LABEL/LABEL2 columns are always non-FK attributes, so names match.
    const rows = seedData.map((r, idx) => ({
      id: idx + 1,
      ...(labelCol ? { [labelCol.name]: r[labelCol.name] ?? null } : {}),
      ...(label2Col ? { [label2Col.name]: r[label2Col.name] ?? null } : {})
    }));

    return { lookup: buildLookupFromRows(rows, labelCol, label2Col), found: true };
  } catch (e) {
    return { lookup: {}, found: false };
  }
}

/**
 * Resolve conceptual FK references in a record.
 * Converts { "manufacturer": "Airbus" } to { "manufacturer_id": 1 }
 *
 * @param {string} entityName - The entity being seeded
 * @param {object} record - The seed record (may have conceptual or technical FK names)
 * @param {object} lookups - Pre-built lookup maps for all entities
 * @returns {object} - { resolved: record with resolved FK IDs, fkWarnings: array of unresolved FKs }
 */
function resolveConceptualFKs(entityName, record, lookups) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return { resolved: record, fkWarnings: [] };

  const resolved = { ...record };
  const fkWarnings = [];

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
        eventBus.emit('seed:resolve:warning', { entityName, field: conceptualName, value: labelValue, targetEntity });
        fkWarnings.push({ field: conceptualName, value: labelValue, targetEntity });
        // Remove the unresolvable field to prevent SQL type errors
        delete resolved[conceptualName];
      }
    }
    // Fallback: technical name with label string (e.g., "engine_id": "GE-900101")
    // AI sometimes uses _id suffix despite prompt instructions
    else if (technicalName in record && typeof record[technicalName] === 'string' && isNaN(Number(record[technicalName]))) {
      const labelValue = record[technicalName];
      const lookup = lookups[targetEntity] || {};
      const resolvedId = lookup[labelValue];

      if (resolvedId !== undefined) {
        resolved[technicalName] = resolvedId;
      } else {
        console.warn(`  Warning: Could not resolve ${technicalName}="${labelValue}" for ${entityName}`);
        eventBus.emit('seed:resolve:warning', { entityName, field: technicalName, value: labelValue, targetEntity });
        fkWarnings.push({ field: conceptualName || technicalName, value: labelValue, targetEntity });
        // Set to NULL to prevent SQL type errors (string in INTEGER column)
        resolved[technicalName] = null;
      }
    }
  }

  return { resolved, fkWarnings };
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

  const backupDir = getBackupDir();
  const importDir = getImportDir();

  for (const entity of schema.orderedEntities) {
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get().count;
    const seedFile = `${entity.className}.json`;
    const seedPath = path.join(getSeedDir(), seedFile);
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
        const validation = validateImport(entity.className, records);
        importValid = validation.validCount;
      } catch {
        importValid = 0;
      }
    }

    entities.push({
      name: entity.className,
      tableName: entity.tableName,
      rowCount,
      seedTotal,      // Total records in seed file
      seedValid,      // Valid records (can be loaded)
      backupTotal,    // Total records in backup file
      importTotal,    // Total records in import file
      importValid     // Valid records in import file
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
      const target = fk.references.entity;
      if (target === entity.className) continue; // Skip self-references
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
  const seedFallbacks = []; // FK entities resolved from seed files (not loaded in DB)

  // Build lookups for FK validation (with seed file fallback)
  const lookups = {};
  for (const fk of entity.foreignKeys) {
    if (!lookups[fk.references.entity]) {
      const dbLookup = buildLabelLookup(fk.references.entity);
      if (Object.keys(dbLookup).length > 0) {
        lookups[fk.references.entity] = dbLookup;
      } else {
        // DB table empty — fall back to seed file
        const { lookup: seedLookup, found } = buildLabelLookupFromSeed(fk.references.entity);
        lookups[fk.references.entity] = seedLookup;
        if (found) {
          seedFallbacks.push(fk.references.entity);
        }
      }
    }
  }

  // Build unique lookup for conflict detection
  const uniqueLookup = buildUniqueLookup(entityName);
  const uniqueCols = entity.columns.filter(c => c.unique).map(c => c.name);
  const compositeKeys = Object.entries(entity.uniqueKeys || {});

  // Track seen values for intra-batch duplicate detection
  const batchSeen = {};
  for (const col of uniqueCols) {
    batchSeen[col] = new Map(); // value -> first row number (1-based)
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
      // Fallback: technical name with label string (e.g., "engine_id": "GE-900101")
      else if (technicalName in record && typeof record[technicalName] === 'string' && isNaN(Number(record[technicalName]))) {
        const labelValue = record[technicalName];
        const lookup = lookups[targetEntity] || {};

        if (!lookup[labelValue]) {
          warnings.push({
            row: i + 1,
            field: technicalName,
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

    // Check intra-batch duplicates (same unique value in multiple rows of this batch)
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
    seedFallbacks // FK entities resolved from seed files instead of DB
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
 * @param {string} entityName
 * @param {string} sourceDir - Source directory ('seed', 'import', or 'backup')
 * @returns {{ dbRowCount: number, conflictCount: number }}
 */
function countSeedConflicts(entityName, sourceDir = 'seed') {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];

  if (!entity) return { dbRowCount: 0, conflictCount: 0 };

  const dbRowCount = db.prepare(`SELECT COUNT(*) as cnt FROM ${entity.tableName}`).get().cnt;
  if (dbRowCount === 0) return { dbRowCount: 0, conflictCount: 0 };

  // Determine source directory
  let sourceDirectory;
  if (sourceDir === 'import') {
    sourceDirectory = getImportDir();
  } else if (sourceDir === 'backup') {
    sourceDirectory = getBackupDir();
  } else {
    sourceDirectory = getSeedDir();
  }

  // Read seed/import file
  const seedFile = path.join(sourceDirectory, `${entityName}.json`);
  if (!fs.existsSync(seedFile)) return { dbRowCount, conflictCount: 0 };

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) return { dbRowCount, conflictCount: 0 };

  // Build FK lookups for resolving conceptual names
  const lookups = {};
  for (const fk of entity.foreignKeys) {
    if (!lookups[fk.references.entity]) {
      lookups[fk.references.entity] = buildLabelLookup(fk.references.entity);
    }
  }

  // Resolve FKs and check each record for conflicts
  let conflictCount = 0;
  for (const record of records) {
    const { resolved } = resolveConceptualFKs(entityName, record, lookups);
    if (findExistingByUnique(entityName, resolved)) {
      conflictCount++;
    }
  }

  return { dbRowCount, conflictCount };
}

/**
 * Load seed data for a specific entity
 * Supports both technical FK notation (type_id: 3) and conceptual notation (type: "A320neo")
 *
 * @param {string} entityName - Entity name
 * @param {object} lookups - Pre-built label lookups for FK resolution (optional)
 * @param {object} options - { skipInvalid, mode: 'replace'|'merge'|'skip_conflicts', sourceDir: 'seed'|'import'|'backup' }
 *   - replace: INSERT OR REPLACE (default, may break FK refs)
 *   - merge: UPDATE existing records (preserve id), INSERT new ones
 *   - skip_conflicts: Skip records that would conflict with existing ones
 *   - sourceDir: Directory to load from ('seed' (default), 'import', or 'backup')
 * @returns {Promise<object>} - { loaded, updated, skipped }
 */
async function loadEntity(entityName, lookups = null, options = {}) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  const { skipInvalid = false, mode = 'replace', preserveSystemColumns = false, sourceDir = 'seed' } = options;

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  // Determine source directory
  let sourceDirectory;
  if (sourceDir === 'import') {
    sourceDirectory = getImportDir();
  } else if (sourceDir === 'backup') {
    sourceDirectory = getBackupDir();
  } else {
    sourceDirectory = getSeedDir();
  }

  const seedFile = path.join(sourceDirectory, `${entityName}.json`);
  if (!fs.existsSync(seedFile)) {
    throw new Error(`No ${sourceDir} file found for ${entityName}`);
  }

  const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (!Array.isArray(records) || records.length === 0) {
    return { loaded: 0, updated: 0, skipped: 0 };
  }

  // Emit before event
  eventBus.emit('seed:load:before', entityName, records.length);

  // Build lookups for FK resolution if not provided (with seed file fallback)
  if (!lookups) {
    lookups = {};
    for (const fk of entity.foreignKeys) {
      if (!lookups[fk.references.entity]) {
        const dbLookup = buildLabelLookup(fk.references.entity);
        if (Object.keys(dbLookup).length > 0) {
          lookups[fk.references.entity] = dbLookup;
        } else {
          const { lookup: seedLookup } = buildLabelLookupFromSeed(fk.references.entity);
          lookups[fk.references.entity] = seedLookup;
        }
      }
    }
  }

  // If skipInvalid is true, validate first and get invalid row indices
  let invalidRows = new Set();
  let validationWarnings = [];
  if (skipInvalid) {
    const validation = validateImport(entityName, records);
    invalidRows = new Set(validation.invalidRows.map(r => r - 1)); // Convert to 0-based
    validationWarnings = validation.warnings || [];
  }

  // Filter out computed columns (DAILY, IMMEDIATE, etc.) - they are auto-calculated
  // Exception: computed FK columns are kept — seed data can provide initial relationship values
  const isComputedColumn = (col) => {
    if (col.foreignKey) return false;
    if (col.computed) return true;  // Schema already parsed
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
  const fkErrors = [];

  // Track row count before loading to detect silent replacements (INSERT OR REPLACE)
  const beforeCount = db.prepare(`SELECT COUNT(*) as c FROM ${entity.tableName}`).get().c;

  for (let i = 0; i < records.length; i++) {
    // Skip invalid records if requested
    if (skipInvalid && invalidRows.has(i)) {
      skipped++;
      continue;
    }

    let record = records[i];

    // Resolve media URLs (fetch URLs and replace with UUIDs)
    const mediaResult = await resolveMediaUrls(entityName, record);
    record = mediaResult.record;

    // Collect media errors with row context
    for (const mediaErr of mediaResult.mediaErrors) {
      mediaErrors.push({
        row: i + 1,
        ...mediaErr
      });
    }

    // Flatten nested aggregate values (e.g., { position: { latitude, longitude } } -> { position_latitude, position_longitude })
    record = flattenAggregates(entityName, record);

    // Resolve conceptual FK references (e.g., "type": "A320neo" -> "type_id": 3)
    const { resolved, fkWarnings } = resolveConceptualFKs(entityName, record, lookups);

    // Collect FK resolution errors with row context
    for (const fkWarn of fkWarnings) {
      if (fkErrors.length < 10) { // Limit to first 10 FK errors
        fkErrors.push({
          row: i + 1,
          field: fkWarn.field,
          value: fkWarn.value,
          targetEntity: fkWarn.targetEntity,
          message: `Row ${i + 1}: "${fkWarn.value}" not found in ${fkWarn.targetEntity} (field: ${fkWarn.field})`
        });
      }
    }

    // SQLite3 cannot bind JS booleans — convert to 0/1
    const toSqlValue = (v) => v === true ? 1 : v === false ? 0 : v ?? null;

    try {
      if (mode === 'replace') {
        // Original behavior: INSERT OR REPLACE (may change id)
        const values = columns.map(col => toSqlValue(resolved[col]));
        insertReplace.run(...values);
        loaded++;
      } else if (mode === 'merge') {
        // MERGE: Update existing (preserve id), insert new
        const existingId = findExistingByUnique(entityName, resolved);
        if (existingId) {
          const values = columnsWithoutId.map(col => toSqlValue(resolved[col]));
          values.push(existingId); // WHERE id = ?
          update.run(...values);
          updated++;
        } else {
          const values = columnsWithoutId.map(col => toSqlValue(resolved[col]));
          insert.run(...values);
          loaded++;
        }
      } else if (mode === 'skip_conflicts') {
        // Skip records that conflict with existing ones
        const existingId = findExistingByUnique(entityName, resolved);
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

  // Detect silent replacements: INSERT OR REPLACE overwrites rows with same unique key
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

  // Add validation warnings (FK lookup failures from validateImport)
  if (validationWarnings.length > 0) {
    result.fkErrors = validationWarnings.slice(0, 10).map(w => ({
      row: w.row,
      field: w.field,
      value: w.value,
      targetEntity: w.targetEntity,
      message: `Row ${w.row}: "${w.value}" not found in ${w.targetEntity} (field: ${w.field})`
    }));
    if (validationWarnings.length > 10) {
      result.fkErrorsTotal = validationWarnings.length;
    }
  }

  // Add FK resolution errors if any occurred (from resolveConceptualFKs during load)
  if (fkErrors.length > 0 && !result.fkErrors) {
    result.fkErrors = fkErrors;
  }

  // Add media errors if any occurred
  if (mediaErrors.length > 0) {
    result.mediaErrors = mediaErrors;
  }

  // Emit after event (MediaService listens to update media refs)
  eventBus.emit('seed:load:after', entityName, result);

  return result;
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
  // Skip self-references (they will be deleted along with the entity's data)
  const backRefs = schema.inverseRelationships[entityName] || [];
  for (const ref of backRefs) {
    // Self-references don't block clearing - deleting all records handles them
    if (ref.entity === entityName) continue;

    const refEntity = schema.entities[ref.entity];
    if (refEntity) {
      try {
        const refCount = db.prepare(`SELECT COUNT(*) as count FROM ${refEntity.tableName} WHERE ${ref.column} IS NOT NULL`).get().count;
        if (refCount > 0) {
          throw new Error(`Cannot clear ${entityName}: ${refCount} records in ${ref.entity} reference it`);
        }
      } catch (e) {
        // Column might not exist if schema changed (e.g., enum→entity conversion)
        // Skip the check - the FK constraint doesn't exist in the actual DB yet
        if (e.message?.includes('no such column')) {
          console.warn(`[SeedManager] Skipping FK check for ${ref.entity}.${ref.column} - column not in DB (schema may need rebuild)`);
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
 * Load all available seed files
 * Builds label lookups incrementally for FK resolution
 */
async function loadAll() {
  const { schema } = getDbAndSchema();
  const results = {};

  // Build lookups incrementally as entities are loaded (for FK resolution)
  const lookups = {};

  // Collect entities with seed files
  const entitiesToLoad = schema.orderedEntities
    .filter(e => fs.existsSync(path.join(getSeedDir(), `${e.className}.json`)))
    .map(e => e.className);

  // Emit before event
  eventBus.emit('seed:loadAll:before', entitiesToLoad);

  // Load in dependency order
  for (const entity of schema.orderedEntities) {
    const seedFile = path.join(getSeedDir(), `${entity.className}.json`);
    if (fs.existsSync(seedFile)) {
      try {
        const result = await loadEntity(entity.className, lookups, { mode: 'merge' });
        results[entity.className] = result;

        // Update lookup for this entity (so subsequent entities can reference it)
        lookups[entity.className] = buildLabelLookup(entity.className);
      } catch (err) {
        results[entity.className] = { error: err.message };
      }
    }
  }

  // Emit after event
  eventBus.emit('seed:loadAll:after', results);

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

  // Emit event so MediaService can clear media files
  eventBus.emit('seed:clearAll:after', results);

  return results;
}

/**
 * Reset all: clear then load
 */
async function resetAll() {
  const clearResults = clearAll();
  const loadResults = await loadAll();

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

  const filePath = path.join(getSeedDir(), `${entityName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));

  return { uploaded: records.length, file: `${entityName}.json` };
}

/**
 * Backup all entity data to JSON files in the backup directory.
 * Exports current DB content (using conceptual FK names for portability).
 * @returns {object} - { entities: { name: count }, backupDir }
 */
function backupAll() {
  const { db, schema } = getDbAndSchema();
  const backupDir = getBackupDir();

  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const results = {};

  for (const entity of schema.orderedEntities) {
    const rows = db.prepare(`SELECT * FROM ${entity.tableName}`).all();

    if (rows.length === 0) {
      // Remove existing backup file if entity is empty
      const backupPath = path.join(backupDir, `${entity.className}.json`);
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      results[entity.className] = 0;
      continue;
    }

    // Convert FK IDs to label values for portability
    const exportRows = rows.map(row => {
      const exported = { ...row };
      delete exported.id; // Don't export auto-increment IDs

      for (const fk of entity.foreignKeys) {
        const idValue = row[fk.column];
        if (idValue === null || idValue === undefined) continue;

        // Look up label for this FK value
        const refEntity = schema.entities[fk.references.entity];
        if (!refEntity) continue;

        const labelCol = refEntity.columns.find(c => c.ui?.label);
        if (!labelCol) continue;

        try {
          const refRow = db.prepare(
            `SELECT ${labelCol.name} FROM ${refEntity.tableName} WHERE id = ?`
          ).get(idValue);

          if (refRow && refRow[labelCol.name]) {
            // Use conceptual name with label value
            exported[fk.displayName] = refRow[labelCol.name];
            delete exported[fk.column];
          }
        } catch {
          // Keep numeric ID if lookup fails
        }
      }

      // Remove computed columns (they are auto-calculated)
      for (const col of entity.columns) {
        if (col.computed && !col.foreignKey) {
          delete exported[col.name];
        }
      }

      // Nest aggregate fields (e.g., position_latitude + position_longitude -> position: { latitude, longitude })
      const aggregateSources = new Map();  // sourceName -> { fieldName: value }
      for (const col of entity.columns) {
        if (col.aggregateSource && col.aggregateField) {
          const source = col.aggregateSource;
          if (!aggregateSources.has(source)) {
            aggregateSources.set(source, {});
          }
          if (exported[col.name] !== undefined) {
            aggregateSources.get(source)[col.aggregateField] = exported[col.name];
            delete exported[col.name];
          }
        }
      }
      for (const [source, nested] of aggregateSources) {
        if (Object.keys(nested).length > 0) {
          exported[source] = nested;
        }
      }

      return exported;
    });

    const backupPath = path.join(backupDir, `${entity.className}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(exportRows, null, 2));
    results[entity.className] = exportRows.length;
  }

  // Emit event so MediaService can backup media files
  eventBus.emit('seed:backup:after', { backupDir, results });

  return { entities: results, backupDir };
}

/**
 * Restore a single entity from backup JSON file.
 * @param {string} entityName - The entity to restore
 * @returns {Promise<object>} - Load result
 */
async function restoreEntity(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  const backupDir = getBackupDir();

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const backupFile = path.join(backupDir, `${entityName}.json`);
  if (!fs.existsSync(backupFile)) {
    throw new Error(`No backup file found for ${entityName}`);
  }

  // Emit event for single-entity restore (media handling)
  eventBus.emit('seed:restore:entity:before', { entityName, backupDir });

  // Clear entity data first
  try {
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM ${entity.tableName}`).run();
    db.pragma('foreign_keys = ON');
  } catch (err) {
    // Ignore errors during clear
  }

  // Temporarily point seed dir to backup dir for loadEntity
  const originalSeedDir = SEED_DIR;
  SEED_DIR = backupDir;

  try {
    const result = await loadEntity(entityName, null, { mode: 'replace', preserveSystemColumns: true });
    return result;
  } finally {
    // Restore original seed dir
    SEED_DIR = originalSeedDir;
  }
}

/**
 * Restore all entity data from backup JSON files.
 * Similar to loadAll but reads from backup/ instead of seed/.
 * @returns {Promise<object>} - Results per entity
 */
async function restoreBackup() {
  const { schema } = getDbAndSchema();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    throw new Error('No backup directory found');
  }

  // Emit event so MediaService can restore media files BEFORE clearing
  // (clearAll would delete media files, but we want to restore from backup)
  eventBus.emit('seed:restore:before', { backupDir });

  // Clear all entity data (media already handled by restore:before)
  const { db } = getDbAndSchema();
  db.pragma('foreign_keys = OFF');
  for (const entity of [...schema.orderedEntities].reverse()) {
    try {
      db.prepare(`DELETE FROM ${entity.tableName}`).run();
    } catch (err) {
      // Ignore errors
    }
  }
  db.pragma('foreign_keys = ON');

  const results = {};
  const lookups = {};

  // Temporarily point seed dir to backup dir for loadEntity
  const originalSeedDir = SEED_DIR;
  SEED_DIR = backupDir;

  try {
    for (const entity of schema.orderedEntities) {
      const backupFile = path.join(backupDir, `${entity.className}.json`);
      if (fs.existsSync(backupFile)) {
        try {
          const result = await loadEntity(entity.className, lookups, { mode: 'replace', preserveSystemColumns: true });
          results[entity.className] = result;
          lookups[entity.className] = buildLabelLookup(entity.className);
        } catch (err) {
          results[entity.className] = { error: err.message };
        }
      }
    }
  } finally {
    // Restore original seed dir
    SEED_DIR = originalSeedDir;
  }

  return results;
}

module.exports = {
  init,
  setMediaService,
  getSeedDir,
  getBackupDir,
  getImportDir,
  getStatus,
  validateImport,
  loadEntity,
  clearEntity,
  loadAll,
  clearAll,
  resetAll,
  uploadEntity,
  buildLabelLookup,
  countSeedConflicts,
  backupAll,
  restoreEntity,
  restoreBackup,
  // Export getter for path (for testing and external access)
  get SEED_DIR() { return getSeedDir(); }
};
