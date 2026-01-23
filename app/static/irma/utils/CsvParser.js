/**
 * CsvParser - Client-side CSV parsing utility
 * Auto-detects separator (semicolon, comma, tab)
 * Handles quoted fields with escaped quotes
 */
const CsvParser = {
  /**
   * Detect the most likely separator in CSV text
   * @param {string} text - CSV text
   * @returns {string} - Detected separator (; , or \t)
   */
  detectSeparator(text) {
    const firstLine = text.split('\n')[0] || '';
    const counts = { ';': 0, ',': 0, '\t': 0 };

    // Count occurrences outside of quoted strings
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && counts[char] !== undefined) {
        counts[char]++;
      }
    }

    // Return most frequent separator, default to semicolon
    const sorted = Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    return sorted[0]?.[0] || ';';
  },

  /**
   * Parse a single CSV line into fields
   * Handles quoted fields and escaped quotes ("")
   * @param {string} line - CSV line
   * @param {string} sep - Separator character
   * @returns {string[]} - Array of field values
   */
  parseLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        // Check for escaped quote ""
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === sep && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  },

  /**
   * Parse CSV text into array of objects
   * @param {string} text - CSV text (with header row)
   * @returns {object[]} - Array of record objects
   */
  parse(text) {
    const separator = this.detectSeparator(text);
    const lines = text.split(/\r?\n/).filter(l => l.trim());

    if (lines.length === 0) return [];

    // Parse header
    const headers = this.parseLine(lines[0], separator).map(h => h.trim());

    // Parse data rows
    return lines.slice(1).map(line => {
      const values = this.parseLine(line, separator);
      const record = {};

      headers.forEach((header, i) => {
        if (!header) return; // Skip empty headers

        let value = values[i]?.trim() ?? '';

        // Convert empty strings to null for optional fields
        // Keep as string for now - server will handle type conversion
        record[header] = value === '' ? null : value;
      });

      return record;
    });
  },

  /**
   * Detect format of input text (JSON or CSV)
   * @param {string} text - Input text
   * @returns {string} - 'json' or 'csv'
   */
  detectFormat(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return 'json';
    }
    return 'csv';
  }
};
