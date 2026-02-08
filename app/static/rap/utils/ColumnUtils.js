/**
 * ColumnUtils - Shared utilities for column/schema handling
 * Works on server (Node.js) and client (browser)
 *
 * Consolidates duplicated logic from:
 * - GenericRepository.js
 * - entity-table.js
 * - entity-tree.js
 * - detail-panel.js
 */

// System columns that are hidden by default (version, timestamps)
// Prefixed with underscore to avoid polluting the user's attribute namespace
const SYSTEM_COLUMNS = ['_version', '_created_at', '_updated_at'];

const ColumnUtils = {
  // Expose SYSTEM_COLUMNS for components that need it
  SYSTEM_COLUMNS,
  /**
   * Get the label field name for a column
   * For FK columns (ending in _id), returns the corresponding _label field
   * @param {Object} col - Column definition with name and optional foreignKey
   * @returns {string} - Field name to use for label display
   */
  getLabelFieldName(col) {
    if (col.foreignKey) {
      // FK column: aircraft_type_id -> aircraft_type_label
      return col.name.replace(/_id$/, '') + '_label';
    }
    return col.name;
  },

  /**
   * Transform FK column name to label column name
   * @param {string} colName - Column name (e.g., "aircraft_type_id")
   * @returns {string} - Label column name (e.g., "aircraft_type_label")
   */
  fkToLabelName(colName) {
    return colName.replace(/_id$/, '') + '_label';
  },

  /**
   * Get base name from FK column (remove _id suffix)
   * @param {string} colName - Column name (e.g., "aircraft_type_id")
   * @returns {string} - Base name (e.g., "aircraft_type")
   */
  fkBaseName(colName) {
    return colName.replace(/_id$/, '');
  },

  /**
   * Get visible columns (excluding hidden fields and optionally system columns)
   * @param {Object} schema - Schema with columns and ui.hiddenFields
   * @param {boolean} showSystem - Whether to include system columns (default: false)
   * @returns {Array} - Filtered columns array
   */
  getVisibleColumns(schema, showSystem = false) {
    const hiddenFields = schema.ui?.hiddenFields || [];
    return schema.columns.filter(col =>
      !hiddenFields.includes(col.name) &&
      (showSystem || !SYSTEM_COLUMNS.includes(col.name))
    );
  },

  /**
   * Separate columns into regular and FK columns
   * @param {Array} columns - Array of column definitions
   * @returns {Object} - { regular: [], fk: [] }
   */
  separateByType(columns) {
    return {
      regular: columns.filter(col => !col.foreignKey),
      fk: columns.filter(col => col.foreignKey)
    };
  },

  /**
   * Build labelFields array from schema columns
   * For FK columns marked as LABEL/LABEL2, uses the resolved _label column
   * @param {Array} columns - Array of column definitions
   * @returns {Array} - Array of field names to use as labels
   */
  buildLabelFields(columns) {
    const labelFields = [];
    for (const col of columns) {
      if (col.ui?.label) {
        labelFields.push(this.getLabelFieldName(col));
      }
      if (col.ui?.label2) {
        labelFields.push(this.getLabelFieldName(col));
      }
    }
    return labelFields;
  },

  /**
   * Get display label for a record using schema labelFields
   * @param {Object} record - Data record
   * @param {Object} schema - Schema with ui.labelFields and ui.hasComputedLabel
   * @returns {Object} - { title: string, subtitle: string|null }
   */
  getRecordLabel(record, schema) {
    let title = `#${record.id}`;
    let subtitle = null;

    // Check for computed _label first (from entity-level labelExpression)
    if (schema.ui?.hasComputedLabel && record._label) {
      title = String(record._label);
      // Check for _label2 if available
      if (record._label2) {
        subtitle = String(record._label2);
      }
      return { title, subtitle };
    }

    // Standard column-based label
    const labelFields = schema.ui?.labelFields;
    if (labelFields && labelFields.length > 0) {
      const primaryLabel = record[labelFields[0]];
      if (primaryLabel) {
        title = String(primaryLabel);
      }

      if (labelFields.length > 1) {
        const secondaryLabel = record[labelFields[1]];
        if (secondaryLabel) {
          subtitle = String(secondaryLabel);
        }
      }
    } else {
      // Fallback: use heuristics
      const candidates = ['name', 'title', 'designation', 'code'];
      for (const name of candidates) {
        if (record[name]) {
          title = String(record[name]);
          break;
        }
      }
    }

    return { title, subtitle };
  },

  /**
   * Get combined label string (title + subtitle)
   * @param {Object} record - Data record
   * @param {Object} schema - Schema with ui.labelFields
   * @param {string} separator - Separator between title and subtitle (default: ' · ')
   * @returns {string} - Combined label
   */
  getFullLabel(record, schema, separator = ' · ') {
    const { title, subtitle } = this.getRecordLabel(record, schema);
    if (subtitle) {
      return `${title}${separator}${subtitle}`;
    }
    return title;
  },

  /**
   * Build display columns for FK-only entities (like junction tables)
   * Converts FK columns to their _label equivalents
   * @param {Array} columns - Schema columns
   * @returns {Array} - Display column definitions with virtual label columns
   */
  buildDisplayColumnsWithLabels(columns) {
    const { regular, fk } = this.separateByType(columns);

    return [
      ...regular,
      ...fk.map(col => ({
        name: this.fkToLabelName(col.name),
        displayName: this.fkBaseName(col.name).replace(/_/g, ' '),
        isVirtualLabel: true,
        originalFk: col
      }))
    ];
  }
};

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColumnUtils;
} else if (typeof window !== 'undefined') {
  window.ColumnUtils = ColumnUtils;
}
