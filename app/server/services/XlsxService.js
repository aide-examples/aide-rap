/**
 * XlsxService - Server-side Excel generation for entity tables
 * Uses the xlsx (SheetJS) library already available for imports.
 */

const XLSX = require('xlsx');

class XlsxService {
  /**
   * Generate XLSX buffer from columns + records
   * @param {Object} data - { columns, records }
   * @returns {Buffer} XLSX file as buffer
   */
  generateXlsx(data) {
    const { columns, records } = data;

    // Build array-of-arrays: header row + data rows
    const header = columns.map(c => c.label);
    const rows = records.map(record =>
      columns.map(col => record[col.key] ?? '')
    );

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

    // Auto-size columns based on content width
    ws['!cols'] = columns.map((col, i) => {
      let maxLen = col.label.length;
      for (const row of rows) {
        const val = String(row[i] ?? '');
        if (val.length > maxLen) maxLen = val.length;
      }
      return { wch: Math.min(maxLen + 2, 50) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = XlsxService;
