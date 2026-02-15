/**
 * RefreshManager - API refresh: update entity records from external API data
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

const { buildLabelLookup } = require('./LabelResolver');
const { findByUniqueField } = require('./FKResolver');

/**
 * Refresh entity records from external API data.
 * Matches API records to existing DB records via a match field, then UPDATEs.
 * Supports FK resolution: if a mapped target field is a foreign key and the value
 * is a string, it will be resolved via LABEL lookup or UNIQUE field matching.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema
 * @param {Array} apiRecords - Mapped API records (from ImportManager.runRefresh)
 * @param {Object} matchConfig - { entityField, apiField }
 * @param {Object} [options] - { singleId: number }
 * @returns {Object} - { matched, updated, skipped, notFound, fkErrors }
 */
function refreshEntity(db, entity, schema, apiRecords, matchConfig, options = {}) {
  if (!entity) {
    throw new Error('Entity not found in schema');
  }

  const { entityField, apiField } = matchConfig;

  // Build FK map: conceptual name (displayName) -> FK definition
  const fkMap = new Map();
  for (const fk of entity.foreignKeys) {
    if (fk.displayName) {
      fkMap.set(fk.displayName, fk);
    }
  }

  // Build label lookups for FK target entities (lazy, only when needed)
  const fkLookups = {};
  function getFkLookup(targetEntityName) {
    if (!fkLookups[targetEntityName]) {
      const targetEntity = schema.entities[targetEntityName];
      fkLookups[targetEntityName] = buildLabelLookup(db, targetEntity);
    }
    return fkLookups[targetEntityName];
  }

  // Get existing records from DB
  let existingRows;
  if (options.singleId) {
    existingRows = db.prepare(
      `SELECT id, ${entityField} FROM ${entity.tableName} WHERE id = ?`
    ).all(options.singleId);
  } else {
    existingRows = db.prepare(
      `SELECT id, ${entityField} FROM ${entity.tableName} WHERE ${entityField} IS NOT NULL`
    ).all();
  }

  // Build match index: entityFieldValue -> dbId
  const matchIndex = new Map();
  for (const row of existingRows) {
    const key = String(row[entityField]);
    matchIndex.set(key, row.id);
  }

  const fkErrors = [];

  // Resolve FK fields in all records before determining update columns
  const resolvedRecords = apiRecords.map(record => {
    const resolved = { ...record };
    for (const [conceptualName, fk] of fkMap) {
      if (conceptualName in resolved && resolved[conceptualName] !== null && resolved[conceptualName] !== undefined) {
        const value = resolved[conceptualName];
        if (typeof value === 'string') {
          const targetEntityName = fk.references?.entity;
          if (!targetEntityName) continue;

          const lookup = getFkLookup(targetEntityName);
          let resolvedId = lookup[value];

          // Fallback 1: whitespace-normalized match
          if (resolvedId === undefined && lookup._normalized) {
            const norm = value.replace(/\s+/g, '').toLowerCase();
            resolvedId = lookup._normalized[norm];
            if (resolvedId !== undefined) lookup[value] = resolvedId;
          }

          // Fallback 2: UNIQUE field matching
          if (resolvedId === undefined) {
            const targetEntity = schema.entities[targetEntityName];
            resolvedId = targetEntity ? findByUniqueField(db, targetEntity, value) : null;
          }

          if (resolvedId !== undefined && resolvedId !== null) {
            resolved[fk.column] = resolvedId;
          } else {
            fkErrors.push({ field: conceptualName, value, targetEntity: targetEntityName });
          }
          delete resolved[conceptualName];
        }
      }
    }
    return resolved;
  });

  // Determine which columns to update
  const updateFields = [];
  for (const record of resolvedRecords) {
    for (const key of Object.keys(record)) {
      if (key !== apiField && !updateFields.includes(key)) {
        updateFields.push(key);
      }
    }
    break;
  }

  if (updateFields.length === 0) {
    return { matched: 0, updated: 0, skipped: 0, notFound: apiRecords.length, fkErrors };
  }

  // Prepare UPDATE statement
  const setClause = updateFields.map(f => `${f} = ?`).join(', ');
  const updateStmt = db.prepare(
    `UPDATE ${entity.tableName} SET ${setClause}, _updated_at = datetime('now') WHERE id = ?`
  );

  let matched = 0;
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  const updateMany = db.transaction((records) => {
    for (const record of records) {
      const apiKey = String(record[apiField]);
      const dbId = matchIndex.get(apiKey);

      if (dbId === undefined) {
        notFound++;
        continue;
      }

      matched++;

      const values = updateFields.map(f => {
        const v = record[f];
        return v === undefined ? null : v;
      });

      try {
        const result = updateStmt.run(...values, dbId);
        if (result.changes > 0) {
          updated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(`[RefreshManager] Error updating ${entity.className} id=${dbId}:`, err.message);
        skipped++;
      }
    }
  });

  updateMany(resolvedRecords);

  return { matched, updated, skipped, notFound, fkErrors };
}

module.exports = {
  refreshEntity
};
