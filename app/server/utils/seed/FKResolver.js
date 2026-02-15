/**
 * FKResolver - Foreign key resolution for seed/import records
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

const { getLabelSeparator, fuzzyLabelMatch } = require('./LabelResolver');

/**
 * Resolve conceptual FK references in a record to numeric IDs.
 * E.g., { manufacturer: "Airbus" } -> { manufacturer_id: 1 }
 *
 * @param {object} entity - Entity schema object
 * @param {object} record - Record with conceptual FK values
 * @param {object} lookups - Map: entityName -> { label -> id }
 * @param {object} schema - Full schema (needed to look up target entities for fuzzy matching)
 * @param {function} findByUniqueFn - Function (targetEntityName) => (value) => id|null for UNIQUE fallback
 * @returns {object} - { resolved, fkWarnings, fuzzyMatches }
 */
function resolveConceptualFKs(entity, record, lookups, schema, findByUniqueFn) {
  if (!entity) return { resolved: record, fkWarnings: [], fuzzyMatches: [] };

  const resolved = { ...record };
  const fkWarnings = [];
  const fuzzyMatches = [];

  for (const fk of entity.foreignKeys) {
    const conceptualName = fk.displayName;  // e.g., "manufacturer"
    const technicalName = fk.column;        // e.g., "manufacturer_id"
    const targetEntity = fk.references?.entity || entity.className; // Fall back to self for self-refs

    // Determine which key the record uses and extract the label value
    let recordKey, labelValue;
    if (conceptualName && conceptualName in record && typeof record[conceptualName] === 'string') {
      recordKey = conceptualName;
      labelValue = record[conceptualName];
    } else if (technicalName in record && typeof record[technicalName] === 'string' && isNaN(Number(record[technicalName]))) {
      // AI sometimes uses _id suffix despite prompt instructions
      recordKey = technicalName;
      labelValue = record[technicalName];
    }

    if (!labelValue) continue;

    const lookup = lookups[targetEntity] || {};
    const fieldLabel = conceptualName || technicalName;
    let resolvedId = lookup[labelValue];

    // Fallback 1: whitespace-normalized match (e.g., "PW1100G-JM" matches "PW 1100G-JM")
    if (resolvedId === undefined && lookup._normalized) {
      const norm = labelValue.replace(/\s+/g, '').toLowerCase();
      resolvedId = lookup._normalized[norm];
      if (resolvedId !== undefined) lookup[labelValue] = resolvedId; // cache
    }

    // Fallback 2: fuzzy match for concat-based labels (subsequence matching)
    if (resolvedId === undefined) {
      const targetEntitySchema = schema.entities[targetEntity];
      const separator = targetEntitySchema ? getLabelSeparator(targetEntitySchema.labelExpression) : null;
      const fuzzyResult = separator ? fuzzyLabelMatch(labelValue, lookup, separator) : null;
      if (fuzzyResult) {
        resolvedId = fuzzyResult.id;
        lookup[labelValue] = resolvedId; // cache
        fuzzyMatches.push({ field: fieldLabel, value: labelValue, matchedLabel: fuzzyResult.matchedLabel, targetEntity });
      }
    }

    // Fallback 3: UNIQUE field match (e.g., Engine serial_number "771706")
    if (resolvedId === undefined && findByUniqueFn) {
      const uniqueId = findByUniqueFn(targetEntity, labelValue);
      if (uniqueId !== null) {
        resolvedId = uniqueId;
        lookup[labelValue] = resolvedId; // cache
      }
    }

    if (resolvedId !== undefined) {
      resolved[technicalName] = resolvedId;
      if (recordKey !== technicalName) delete resolved[recordKey];
    } else {
      // Warning — caller (facade) handles event emission
      fkWarnings.push({ field: fieldLabel, value: labelValue, targetEntity });
      if (recordKey === technicalName) {
        resolved[technicalName] = null;
      } else {
        delete resolved[recordKey];
      }
    }
  }

  return { resolved, fkWarnings, fuzzyMatches };
}

/**
 * Find a record by UNIQUE field value.
 * Used as fallback when LABEL matching fails during FK resolution.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {string} value - The value to search for
 * @returns {number|null} - The record ID or null
 */
function findByUniqueField(db, entity, value) {
  if (!entity) return null;

  const uniqueCols = entity.columns.filter(c => c.unique);
  for (const col of uniqueCols) {
    const row = db.prepare(`SELECT id FROM ${entity.tableName} WHERE ${col.name} = ?`).get(value);
    if (row) return row.id;
  }
  return null;
}

module.exports = {
  resolveConceptualFKs,
  findByUniqueField
};
