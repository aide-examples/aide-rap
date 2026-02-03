/**
 * Shared utilities for dialog components (Import, Seed Generator)
 * Reduces code duplication for common UI patterns
 */
const DialogUtils = {

  /**
   * Render a data preview table
   * @param {Array} records - Data records to display
   * @param {Object} options - Configuration options
   * @param {number} options.limit - Max rows to display (default: 50)
   * @param {Array} options.fkWarnings - FK validation warnings array
   * @param {Array} options.invalidRows - Array of invalid row numbers (1-based)
   * @param {boolean} options.showAllButton - Show "Show All" button if truncated
   * @param {string} options.showAllId - ID for "Show All" button
   * @param {boolean} options.replaceUnderscores - Replace _ with space in headers
   * @param {function} options.formatCell - Custom cell formatter (value, col) => html
   * @returns {string} HTML string
   */
  renderDataTable(records, options = {}) {
    if (!records || records.length === 0) {
      return '<div class="preview-empty">No records to display.</div>';
    }

    const {
      limit = 50,
      fkWarnings = [],
      invalidRows = [],
      showAllButton = false,
      showAllId = 'btn-show-all',
      replaceUnderscores = false,
      formatCell = null
    } = options;

    // Build warning lookup: row -> field -> warning
    const warningLookup = {};
    for (const w of fkWarnings) {
      if (!warningLookup[w.row]) warningLookup[w.row] = {};
      warningLookup[w.row][w.field] = w;
    }
    const invalidRowSet = new Set(invalidRows);

    // Collect columns from data (exclude id and _ prefixed)
    const dataKeys = new Set();
    for (const record of records) {
      Object.keys(record).forEach(k => {
        if (k !== 'id' && !k.startsWith('_')) dataKeys.add(k);
      });
    }
    const columns = [...dataKeys];

    // Header
    const headerCells = columns.map(c => {
      const displayName = replaceUnderscores ? c.replace(/_/g, ' ') : c;
      return `<th>${DomUtils.escapeHtml(displayName)}</th>`;
    }).join('');

    // Determine if we're showing all or limited
    const showingAll = !limit || limit >= records.length;
    const previewRows = showingAll ? records : records.slice(0, limit);

    // Rows
    const rows = previewRows.map((record, idx) => {
      const rowNum = idx + 1;
      const rowWarnings = warningLookup[rowNum] || {};
      const isInvalidRow = invalidRowSet.has(rowNum);

      const cells = columns.map(col => {
        const value = record[col];
        const warning = rowWarnings[col];

        // Use custom formatter if provided
        if (formatCell) {
          return formatCell(value, col, warning);
        }

        // Default formatting
        if (value === null || value === undefined) {
          return '<td class="null-value">-</td>';
        }

        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        const displayValue = strValue.length > 30 ? strValue.substring(0, 27) + '...' : strValue;

        if (warning) {
          return `<td class="fk-invalid" title="${DomUtils.escapeHtml(warning.message || '')}">${DomUtils.escapeHtml(displayValue)} ⚠</td>`;
        }
        return `<td title="${DomUtils.escapeHtml(strValue)}">${DomUtils.escapeHtml(displayValue)}</td>`;
      }).join('');

      const rowClass = isInvalidRow ? 'class="invalid-row"' : '';
      return `<tr ${rowClass}>${cells}</tr>`;
    }).join('');

    let html = `
      <div class="result-table-wrapper">
        <table class="seed-preview-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // Truncation notice
    if (!showingAll) {
      const remaining = records.length - limit;
      if (showAllButton) {
        html += `<div class="preview-truncated">... and ${remaining} more records <button class="btn-link" id="${showAllId}">Show All</button></div>`;
      } else {
        html += `<div class="preview-truncated">... and ${remaining} more records</div>`;
      }
    }

    return html;
  },

  /**
   * Render FK validation warnings
   * @param {Array} fkWarnings - Warning objects with field, value, targetEntity
   * @param {number} maxDisplay - Max warnings to show before "N more"
   * @returns {string} HTML string
   */
  renderFKWarnings(fkWarnings, maxDisplay = 3) {
    if (!fkWarnings || fkWarnings.length === 0) return '';

    // Deduplicate warnings by field:value
    const uniqueWarnings = new Map();
    for (const w of fkWarnings) {
      const key = `${w.field}:${w.value}`;
      if (!uniqueWarnings.has(key)) {
        uniqueWarnings.set(key, w);
      }
    }

    const warningLines = Array.from(uniqueWarnings.values())
      .slice(0, maxDisplay)
      .map(w => `"${DomUtils.escapeHtml(String(w.value))}" not found in ${DomUtils.escapeHtml(w.targetEntity)}`)
      .join('<br>');

    let html = `<div class="warning-section"><div class="warning-icon">⚠</div><div class="warning-text">${warningLines}`;
    if (uniqueWarnings.size > maxDisplay) {
      html += `<br><span class="warning-more">... and ${uniqueWarnings.size - maxDisplay} more FK warnings</span>`;
    }
    html += '</div></div>';

    return html;
  },

  /**
   * Render conflict mode selector (merge/skip/replace)
   * @param {Object} options - Configuration
   * @param {Array} options.conflicts - Conflict objects with backRefs (for generate mode)
   * @param {number} options.conflictCount - Simple conflict count (for load mode)
   * @param {number} options.totalRecords - Total records to load
   * @param {number} options.dbRowCount - Existing DB row count
   * @param {string} options.selected - Currently selected mode
   * @param {string} options.radioName - Name for radio inputs
   * @param {boolean} options.showDescriptions - Show full descriptions
   * @returns {string} HTML string
   */
  renderConflictSelector(options) {
    const {
      conflicts = [],
      conflictCount = 0,
      totalRecords = 0,
      dbRowCount = 0,
      selected = 'merge',
      radioName = 'import-mode',
      showDescriptions = false
    } = options;

    // Determine conflict count from either source
    const actualConflictCount = conflicts.length || conflictCount;
    if (actualConflictCount === 0) return '';

    const newCount = totalRecords - actualConflictCount;
    const totalBackRefs = conflicts.reduce((sum, c) => sum + (c.backRefs || 0), 0);

    // Header text varies by source
    let headerText;
    if (conflicts.length > 0 && totalBackRefs > 0) {
      headerText = `${actualConflictCount} record(s) would overwrite existing data with ${totalBackRefs} back-reference(s)`;
    } else {
      headerText = `${actualConflictCount} of ${totalRecords} records already exist in the database (${dbRowCount} DB rows total)`;
    }

    let html = `
      <div class="conflict-section">
        <div class="conflict-header">
          <span class="conflict-icon">⚠</span>
          <span class="conflict-text">${headerText}</span>
        </div>
        <div class="conflict-mode-selector">
    `;

    if (showDescriptions) {
      html += `
        <label><input type="radio" name="${radioName}" value="merge" ${selected === 'merge' ? 'checked' : ''}> <strong>Merge</strong> - Update existing, add new (preserves IDs)</label>
        <label><input type="radio" name="${radioName}" value="skip_conflicts" ${selected === 'skip_conflicts' ? 'checked' : ''}> <strong>Skip</strong> - Only add new records</label>
        <label><input type="radio" name="${radioName}" value="replace" ${selected === 'replace' ? 'checked' : ''}> <strong>Replace</strong> - Overwrite all (may break references!)</label>
      `;
    } else {
      html += `
        <label><input type="radio" name="${radioName}" value="skip_conflicts" ${selected === 'skip_conflicts' ? 'checked' : ''}> <strong>Keep existing</strong> — only load ${newCount} new record${newCount !== 1 ? 's' : ''}</label>
        <label><input type="radio" name="${radioName}" value="merge" ${selected === 'merge' ? 'checked' : ''}> <strong>Overwrite existing</strong> — update ${actualConflictCount}, insert ${newCount} new</label>
      `;
    }

    html += `
        </div>
      </div>
    `;

    return html;
  },

  /**
   * Export records as JSON file
   * @param {Array} records - Data to export
   * @param {string} filename - Filename (without extension added if missing)
   */
  exportJson(records, filename) {
    if (!records || records.length === 0) return;
    const json = JSON.stringify(records, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const finalFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
    DomUtils.downloadBlob(blob, finalFilename);
  },

  /**
   * Export records as CSV file (semicolon-separated, UTF-8 BOM)
   * @param {Array} records - Data to export
   * @param {string} filename - Filename (without extension added if missing)
   */
  exportCsv(records, filename) {
    if (!records || records.length === 0) return;

    const columns = Object.keys(records[0]);

    // Header row
    const header = columns.map(c => this.escapeCsvField(c)).join(';');

    // Data rows
    const rows = records.map(record =>
      columns.map(col => this.escapeCsvField(record[col])).join(';')
    );

    // BOM for Excel UTF-8 recognition
    const bom = '\uFEFF';
    const csv = bom + header + '\n' + rows.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const finalFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    DomUtils.downloadBlob(blob, finalFilename);
  },

  /**
   * Escape a field value for CSV
   * @param {*} value - Value to escape
   * @returns {string} Escaped CSV field
   */
  escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

};
