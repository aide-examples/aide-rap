/**
 * FilterParser - Shared filter parsing utility for entities and views
 *
 * Supports filter formats joined with && (AND):
 * - "~column:value" - LIKE match (e.g., "~meter_label:Gas")
 * - "=column:value" - exact match on view column (e.g., "=meter_label:Wasser")
 * - "@Ycolumn:value" - year filter using strftime (e.g., "@Yreading_at:2024")
 * - "@Mcolumn:value" - month filter using strftime (e.g., "@Mreading_at:2024-03")
 * - "column:value" - exact match on entity column (e.g., "type_id:5")
 * - "text" - LIKE search across all string columns
 */

/**
 * Parse filter string into SQL conditions and parameters
 *
 * @param {string} filter - Filter string with && separators
 * @param {Object} options - Configuration options
 * @param {Function} options.resolveColumn - (colName) => { sqlName, jsType } | null
 *   - For entities: looks up by column name, returns { sqlName: col.name, jsType }
 *   - For views: looks up by sqlAlias or label, returns { sqlName: col.sqlAlias, jsType }
 * @param {Function} options.getStringColumns - () => string[]  - returns SQL column names for text search
 * @param {Function} [options.validateEntityColumn] - (colName) => { sqlName, jsType } | null
 *   - Optional: for entity "column:value" exact match (validated against schema)
 * @returns {{ conditions: string[], params: any[] }}
 */
function parseFilter(filter, options) {
  const { resolveColumn, getStringColumns, validateEntityColumn } = options;
  const conditions = [];
  const params = [];

  if (!filter) {
    return { conditions, params };
  }

  const filterParts = filter.split('&&');

  for (const part of filterParts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    // Check filter prefix type
    const yearMatch = trimmedPart.match(/^@Y(.+?):(.+)$/);
    const monthMatch = trimmedPart.match(/^@M(.+?):(.+)$/);
    const likeMatch = trimmedPart.match(/^~(.+?):(.+)$/);
    const exactViewMatch = trimmedPart.match(/^=(.+?):(.+)$/);
    const colonMatch = trimmedPart.match(/^([^~=@].+?):(.+)$/);

    if (yearMatch) {
      const [, colName, value] = yearMatch;
      const col = resolveColumn(colName);
      if (col) {
        conditions.push(`strftime('%Y', "${col.sqlName}") = ?`);
        params.push(value);
      }
    } else if (monthMatch) {
      const [, colName, value] = monthMatch;
      const col = resolveColumn(colName);
      if (col) {
        conditions.push(`strftime('%Y-%m', "${col.sqlName}") = ?`);
        params.push(value);
      }
    } else if (exactViewMatch) {
      const [, colName, value] = exactViewMatch;
      const col = resolveColumn(colName);
      if (col) {
        // Handle null specially for IS NULL queries
        if (value.toLowerCase() === 'null') {
          conditions.push(`"${col.sqlName}" IS NULL`);
        } else {
          conditions.push(`"${col.sqlName}" = ?`);
          params.push(value);
        }
      }
    } else if (likeMatch) {
      const [, colName, value] = likeMatch;
      const col = resolveColumn(colName);
      if (col) {
        conditions.push(`"${col.sqlName}" LIKE ?`);
        params.push(`%${value}%`);
      }
    } else if (colonMatch) {
      const [, colName, value] = colonMatch;
      // For entity exact match: use validateEntityColumn if provided
      const col = validateEntityColumn ? validateEntityColumn(colName) : resolveColumn(colName);
      if (col) {
        // Handle null specially for IS NULL queries (especially for FK columns)
        if (value.toLowerCase() === 'null') {
          conditions.push(`"${col.sqlName}" IS NULL`);
        } else {
          conditions.push(`"${col.sqlName}" = ?`);
          const paramValue = col.jsType === 'number' ? parseInt(value, 10) : value;
          params.push(paramValue);
        }
      }
    } else {
      // Global LIKE search across all string columns
      const stringColumns = getStringColumns();
      if (stringColumns.length > 0) {
        const textConditions = stringColumns.map(col => `"${col}" LIKE ?`);
        conditions.push(`(${textConditions.join(' OR ')})`);
        const filterValue = `%${trimmedPart}%`;
        params.push(...stringColumns.map(() => filterValue));
      }
    }
  }

  return { conditions, params };
}

/**
 * Build WHERE clause from conditions
 * @param {string[]} conditions
 * @returns {string} - " WHERE ..." or ""
 */
function buildWhereClause(conditions) {
  if (conditions.length === 0) return '';
  return ` WHERE ${conditions.join(' AND ')}`;
}

module.exports = {
  parseFilter,
  buildWhereClause
};
