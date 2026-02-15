/**
 * LabelResolver - Label lookup and fuzzy matching for FK resolution
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

const fs = require('fs');
const path = require('path');

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
 * Add normalized keys to a lookup for whitespace-insensitive fallback matching.
 * Strips all whitespace and lowercases to build a parallel _normalized map.
 * Used when exact label match fails — e.g., "PW1100G-JM" matches "PW 1100G-JM".
 */
function addNormalizedKeys(lookup) {
  const normalized = {};
  for (const [key, id] of Object.entries(lookup)) {
    if (key.startsWith('#')) continue;
    const norm = key.replace(/\s+/g, '').toLowerCase();
    if (!(norm in normalized)) normalized[norm] = id;
  }
  lookup._normalized = normalized;
}

/**
 * Build a lookup map for an entity: LABEL value -> id
 * Used to resolve conceptual FK references (e.g., "manufacturer": "Airbus" -> manufacturer_id: 1)
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object (with tableName, columns, labelExpression)
 * @returns {object} - Lookup map: label -> id
 */
function buildLabelLookup(db, entity) {
  if (!entity) return {};

  let lookup;

  // Check if entity has computed labelExpression (from entity-level [LABEL=expr])
  if (entity.labelExpression) {
    // Query from view which has the computed _label column
    const sql = `SELECT id, _label FROM ${entity.tableName}_view WHERE _ql = 0 ORDER BY id`;
    try {
      const rows = db.prepare(sql).all();
      lookup = buildLookupFromComputedLabel(rows);
    } catch (e) {
      // Fallback to column-based lookup if view doesn't exist yet
      console.warn(`Warning: Could not use _label from view for ${entity.tableName}, falling back to column lookup`);
    }
  }

  if (!lookup) {
    // Standard column-based lookup
    const labelCol = entity.columns.find(c => c.ui?.label);
    const label2Col = entity.columns.find(c => c.ui?.label2);

    const selectCols = ['id'];
    if (labelCol) selectCols.push(labelCol.name);
    if (label2Col && label2Col.name !== labelCol?.name) selectCols.push(label2Col.name);

    const sql = `SELECT ${selectCols.join(', ')} FROM ${entity.tableName} WHERE _ql = 0 ORDER BY id`;
    const rows = db.prepare(sql).all();

    lookup = buildLookupFromRows(rows, labelCol, label2Col);
  }

  // Build normalized lookup for whitespace-insensitive fallback matching
  addNormalizedKeys(lookup);

  return lookup;
}

/**
 * Build lookup map from rows with computed _label column
 */
function buildLookupFromComputedLabel(rows) {
  const lookup = {};
  let rowIndex = 1;

  for (const row of rows) {
    const labelVal = row._label;
    if (labelVal) lookup[labelVal] = row.id;
    lookup[`#${rowIndex}`] = row.id;
    rowIndex++;
  }

  return lookup;
}

/**
 * Check if needle segments appear as a subsequence in haystack segments.
 * Each needle segment must match a haystack segment, in order, but gaps are allowed.
 */
function isSubsequence(needle, haystack) {
  let hi = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    while (hi < haystack.length && haystack[hi] !== needle[ni]) hi++;
    if (hi >= haystack.length) return false;
    hi++;
  }
  return true;
}

/**
 * Extract the separator from a concat-type labelExpression.
 * Returns the separator string if all literal parts are identical, null otherwise.
 */
function getLabelSeparator(labelExpr) {
  if (!labelExpr || labelExpr.type !== 'concat') return null;
  const literals = labelExpr.parts
    .filter(p => typeof p === 'object' && p.type === 'literal')
    .map(p => p.value);
  if (literals.length === 0) return null;
  const unique = new Set(literals);
  return unique.size === 1 ? literals[0] : null;
}

/**
 * Fuzzy label matching: find a unique label in lookup where the import value's
 * segments (split by separator) are a subsequence of the label's segments.
 * Returns { id, matchedLabel } if exactly one match, null otherwise.
 */
function fuzzyLabelMatch(importValue, lookup, separator) {
  if (!importValue || !separator) return null;
  const importSegments = importValue.split(separator);
  if (importSegments.length < 2) return null;

  const candidates = [];
  for (const [label, id] of Object.entries(lookup)) {
    if (label.startsWith('#')) continue;
    const labelSegments = label.split(separator);
    if (importSegments.length >= labelSegments.length) continue;
    if (isSubsequence(importSegments, labelSegments)) {
      candidates.push({ id, matchedLabel: label });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Compute a label value from an expression and a record (in-memory)
 * Used for seed/import records before they're in the database
 * @param {object} expr - { type: 'field'|'concat', field?: string, parts?: string[] }
 * @param {object} record - The record to compute label from
 * @returns {string|null} - Computed label value
 */
function computeLabelFromExpression(expr, record) {
  if (!expr) return null;

  // Legacy format: { type: 'field', field: 'name' }
  if (expr.type === 'field') {
    return record[expr.field] ?? null;
  }

  // New format: { type: 'ref', name: 'name' }
  if (expr.type === 'ref') {
    return record[expr.name] ?? null;
  }

  if (expr.type === 'concat') {
    const parts = expr.parts.map(p => {
      // New structured format (objects with type property)
      if (typeof p === 'object' && p !== null) {
        if (p.type === 'literal') {
          return p.value;
        }
        if (p.type === 'ref') {
          return record[p.name] ?? '';
        }
        if (p.type === 'fkChain') {
          // For FK chains, just use the first segment (the FK field name)
          // The record has the conceptual value before FK resolution
          const firstSegment = p.path.split('.')[0];
          return record[firstSegment] ?? '';
        }
        return '';
      }
      // Legacy format: plain strings
      if (typeof p === 'string') {
        // Check if it's a quoted literal
        if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
          return p.slice(1, -1); // Remove quotes
        }
        // Field reference
        return record[p] ?? '';
      }
      return '';
    });
    return parts.join('');
  }

  return null;
}

/**
 * Build lookup map from in-memory records using labelExpression
 * @param {array} records - Records to build lookup from
 * @param {object} labelExpr - Label expression { type, field/parts }
 * @returns {object} - Lookup map: label -> id (row index)
 */
function buildLookupFromExpressionRecords(records, labelExpr) {
  const lookup = {};
  let rowIndex = 1;

  for (const record of records) {
    const labelVal = computeLabelFromExpression(labelExpr, record);
    if (labelVal) lookup[labelVal] = rowIndex;
    lookup[`#${rowIndex}`] = rowIndex;
    rowIndex++;
  }

  return lookup;
}

/**
 * Build a lookup map from a seed JSON file (fallback when DB table is empty).
 * Returns { lookup, found } where found indicates if a seed file was used.
 *
 * @param {object} entity - Entity schema object
 * @param {string} seedDir - Path to the seed directory
 * @returns {{ lookup: object, found: boolean }}
 */
function buildLabelLookupFromSeed(entity, seedDir) {
  if (!entity) return { lookup: {}, found: false };

  try {
    const seedFile = path.join(seedDir, `${entity.className}.json`);
    if (!fs.existsSync(seedFile)) return { lookup: {}, found: false };

    const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
    if (!Array.isArray(seedData) || seedData.length === 0) return { lookup: {}, found: false };

    let lookup;

    // Check for entity-level labelExpression first
    if (entity.labelExpression) {
      lookup = buildLookupFromExpressionRecords(seedData, entity.labelExpression);
    } else {
      // Standard column-based lookup
      const labelCol = entity.columns.find(c => c.ui?.label);
      const label2Col = entity.columns.find(c => c.ui?.label2);

      // Seed files use attribute names (not DB column names with _id suffix).
      // LABEL/LABEL2 columns are always non-FK attributes, so names match.
      const rows = seedData.map((r, idx) => ({
        id: idx + 1,
        ...(labelCol ? { [labelCol.name]: r[labelCol.name] ?? null } : {}),
        ...(label2Col ? { [label2Col.name]: r[label2Col.name] ?? null } : {})
      }));

      lookup = buildLookupFromRows(rows, labelCol, label2Col);
    }

    addNormalizedKeys(lookup);
    return { lookup, found: true };
  } catch (e) {
    return { lookup: {}, found: false };
  }
}

/**
 * Build a lookup map from records being imported (for self-referential FKs).
 * Allows earlier records in the import to be referenced by later records.
 *
 * @param {object} entity - Entity schema
 * @param {array} records - Records being imported
 * @returns {object} - Lookup map: label -> row index (1-based, becomes id after insert)
 */
function buildLookupFromImportRecords(entity, records) {
  // Check for entity-level labelExpression first
  if (entity.labelExpression) {
    return buildLookupFromExpressionRecords(records, entity.labelExpression);
  }

  // Standard column-based lookup
  const labelCol = entity.columns.find(c => c.ui?.label);
  const label2Col = entity.columns.find(c => c.ui?.label2);

  if (!labelCol && !label2Col) return {};

  const rows = records.map((r, idx) => ({
    id: idx + 1,  // Row index becomes id after insert
    ...(labelCol ? { [labelCol.name]: r[labelCol.name] ?? null } : {}),
    ...(label2Col ? { [label2Col.name]: r[label2Col.name] ?? null } : {})
  }));

  return buildLookupFromRows(rows, labelCol, label2Col);
}

/**
 * Build a reverse lookup map for an entity: id -> label string
 * Used by backup to convert FK IDs to portable label values.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @returns {object} - Reverse lookup map: id -> label
 */
function buildReverseLabelLookup(db, entity) {
  if (!entity) return {};
  const reverse = {};

  if (entity.labelExpression) {
    // Query from view which has the computed _label column
    try {
      const rows = db.prepare(
        `SELECT id, _label FROM ${entity.tableName}_view`
      ).all();
      for (const row of rows) {
        if (row._label) reverse[row.id] = row._label;
      }
      return reverse;
    } catch {
      // Fallback to column-based lookup below
    }
  }

  // Standard column-based: use primary LABEL column
  const labelCol = entity.columns.find(c => c.ui?.label);
  if (labelCol) {
    try {
      const rows = db.prepare(
        `SELECT id, ${labelCol.name} FROM ${entity.tableName}`
      ).all();
      for (const row of rows) {
        if (row[labelCol.name]) reverse[row.id] = row[labelCol.name];
      }
    } catch { /* ignore */ }
  }

  return reverse;
}

module.exports = {
  buildLookupFromRows,
  addNormalizedKeys,
  buildLabelLookup,
  buildLookupFromComputedLabel,
  isSubsequence,
  getLabelSeparator,
  fuzzyLabelMatch,
  computeLabelFromExpression,
  buildLookupFromExpressionRecords,
  buildLabelLookupFromSeed,
  buildLookupFromImportRecords,
  buildReverseLabelLookup
};
