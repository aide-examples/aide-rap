/**
 * CsvService - Server-side CSV generation for entity tables
 * Generates UTF-8 CSV with semicolon separator (Excel DE standard)
 */

class CsvService {
  /**
   * Generate CSV and send to response
   * @param {Object} data - { columns, records }
   * @param {Response} res - Express response object
   */
  generateCsv(data, res) {
    const { columns, records } = data;

    // CSV Header
    const header = columns.map(c => this.escapeCsvField(c.label)).join(';');

    // CSV Rows
    const rows = records.map(record =>
      columns.map(col => this.escapeCsvField(record[col.key] ?? '')).join(';')
    );

    // BOM for Excel UTF-8 recognition + content
    const bom = '\uFEFF';
    const csv = bom + header + '\n' + rows.join('\n');

    res.end(csv);
  }

  /**
   * Escape a field value for CSV
   * Handles semicolons, quotes, and newlines
   */
  escapeCsvField(value) {
    const str = String(value);
    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
}

module.exports = CsvService;
