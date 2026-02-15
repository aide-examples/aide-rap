/**
 * NeutralValues - Provides type-appropriate substitute values for data quality system.
 *
 * When a record has quality deficits, defective field values are replaced with
 * neutral values that satisfy DB constraints (NOT NULL, type checks) while the
 * original values are preserved in the _qd (Quality Deficit) JSON field.
 *
 * See: app/docs/data-quality.md
 */

const { getTypeRegistry } = require('../../shared/types/TypeRegistry');

/**
 * Default neutral values by type.
 * These are used when no [NULL=value] override is specified.
 */
const NEUTRAL_DEFAULTS = {
  'string':  '?',
  'int':     999999,
  'number':  999999,
  'real':    999999,
  'date':    '1970-01-01',
  'bool':    0,
  'boolean': 0,
  'url':     '?',
  'mail':    '?',
  'media':   '?',
  'json':    '{}',
  'geo':     0
};

/**
 * Get the neutral value for a single column.
 *
 * Resolution order:
 * 1. [NULL=value] override from entity definition
 * 2. FK → 1 (null reference record)
 * 3. Enum → first internal value
 * 4. Pattern → '?'
 * 5. Built-in type default from NEUTRAL_DEFAULTS
 *
 * @param {Object} column - Column definition from schema
 * @returns {*} The neutral value for this column
 */
function getNeutralValue(column) {
  // 1. Explicit override via [NULL=value]
  if (column.nullOverride !== undefined && column.nullOverride !== null) {
    return column.nullOverride;
  }

  // 2. FK reference → point to null reference record (id=1)
  if (column.foreignKey) {
    return 1;
  }

  // 3. Resolve custom type (enum, pattern)
  if (column.customType) {
    const registry = getTypeRegistry();
    const typeDef = registry.resolve(column.customType);
    if (typeDef) {
      if (typeDef.kind === 'enum' && typeDef.values && typeDef.values.length > 0) {
        return typeDef.values[0].internal;
      }
      if (typeDef.kind === 'pattern') {
        return '?';
      }
    }
  }

  // 4. Aggregate sub-field: use type of the sub-field
  if (column.aggregateType) {
    // Aggregate sub-fields are typed (number for lat/lng, string for street/city etc.)
    if (column.jsType === 'number') return 0;
    return '?';
  }

  // 5. Built-in type default
  return NEUTRAL_DEFAULTS[column.type] ?? '?';
}

/**
 * Build a complete null reference record for an entity.
 * Contains neutral values for all user columns plus _ql=256.
 *
 * @param {Object} entity - Entity definition from schema
 * @returns {Object} Record object ready for INSERT (without id)
 */
function buildNullRecord(entity) {
  const record = {};

  for (const col of entity.columns) {
    // Skip id (set separately), skip system columns except _ql
    if (col.name === 'id') continue;
    if (col.system) {
      if (col.name === '_ql') {
        record._ql = 256;  // System record marker
      }
      // _qd, _created_at, _updated_at, _version use SQLite DEFAULTs
      continue;
    }

    record[col.name] = getNeutralValue(col);
  }

  return record;
}

module.exports = {
  getNeutralValue,
  buildNullRecord,
  NEUTRAL_DEFAULTS
};
