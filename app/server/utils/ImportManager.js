/**
 * ImportManager - Manages XLSX imports based on MD definitions
 *
 * Workflow:
 * 1. Parse import definition from imports/*.md
 * 2. Read XLSX from data/extern/
 * 3. Apply column mapping
 * 4. Apply SQL-like filter
 * 5. Write JSON to data/import/
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

class ImportManager {
  constructor(systemDir) {
    this.systemDir = systemDir;
    this.importsDir = path.join(systemDir, 'imports');
    this.externDir = path.join(systemDir, 'data', 'extern');
    this.importDir = path.join(systemDir, 'data', 'import');

    // Ensure directories exist
    for (const dir of [this.importsDir, this.externDir, this.importDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Get list of available import definitions
   * @returns {Array} - [{ entity, hasDefinition, hasSource, sourceFile }]
   */
  getAvailableImports() {
    const imports = [];

    if (!fs.existsSync(this.importsDir)) {
      return imports;
    }

    const files = fs.readdirSync(this.importsDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const entity = file.replace('.md', '');
      const definition = this.parseImportDefinition(entity);

      let hasSource = false;
      let sourceFile = null;

      if (definition && definition.source) {
        const sourcePath = path.join(this.systemDir, 'data', definition.source);
        hasSource = fs.existsSync(sourcePath);
        sourceFile = definition.source;
      }

      imports.push({
        entity,
        hasDefinition: !!definition,
        hasSource,
        sourceFile,
        sheet: definition?.sheet || null
      });
    }

    return imports;
  }

  /**
   * Parse import definition from MD file
   * @param {string} entityName - Entity name (without .md extension)
   * @returns {Object|null} - { source, sheet, mapping, transforms, filter }
   */
  parseImportDefinition(entityName) {
    const mdPath = path.join(this.importsDir, `${entityName}.md`);

    if (!fs.existsSync(mdPath)) {
      return null;
    }

    const content = fs.readFileSync(mdPath, 'utf-8');
    const lines = content.split('\n');

    const definition = {
      source: null,
      sheet: null,
      mapping: {},
      transforms: {},  // sourceCol -> transform type
      filter: null
    };

    let inMapping = false;
    let inFilter = false;
    let filterLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse Source: directive
      if (trimmed.startsWith('Source:')) {
        definition.source = trimmed.substring(7).trim();
        continue;
      }

      // Parse Sheet: directive
      if (trimmed.startsWith('Sheet:')) {
        definition.sheet = trimmed.substring(6).trim();
        continue;
      }

      // Detect section headers
      if (trimmed.startsWith('## Mapping')) {
        inMapping = true;
        inFilter = false;
        continue;
      }

      if (trimmed.startsWith('## Filter')) {
        inMapping = false;
        inFilter = true;
        continue;
      }

      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        inMapping = false;
        inFilter = false;
        continue;
      }

      // Parse mapping table rows (Source | Target | Transform)
      if (inMapping && trimmed.startsWith('|') && !trimmed.includes('---')) {
        const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length >= 2) {
          const source = cells[0];
          const target = cells[1];
          const transform = cells[2] || null;
          // Skip header row
          if (source.toLowerCase() !== 'source' && target.toLowerCase() !== 'target') {
            definition.mapping[source] = target;
            if (transform) {
              definition.transforms[source] = transform;
            }
          }
        }
      }

      // Collect filter lines
      if (inFilter && trimmed) {
        filterLines.push(trimmed);
      }
    }

    // Combine filter lines
    if (filterLines.length > 0) {
      definition.filter = filterLines.join(' ').trim();
    }

    return definition;
  }

  /**
   * Apply a transform to a value
   * Supported transforms:
   * - date:DD.MM.YYYY  → converts German date to ISO (YYYY-MM-DD)
   * - date:MM/DD/YYYY  → converts US date to ISO
   * - number           → parse as number
   * - trim             → trim whitespace
   * @param {any} value - The value to transform
   * @param {string} transform - The transform specification
   * @returns {any} - The transformed value
   */
  applyTransform(value, transform) {
    if (value === null || value === undefined || value === '') {
      return value;
    }

    const str = String(value).trim();

    // Date transforms
    if (transform.startsWith('date:')) {
      const format = transform.substring(5);
      return this.parseDate(str, format);
    }

    // Simple transforms
    switch (transform) {
      case 'number':
        // Handle German number format (comma as decimal separator)
        const num = parseFloat(str.replace(',', '.'));
        return isNaN(num) ? value : num;

      case 'trim':
        return str;

      default:
        console.warn(`Unknown transform: ${transform}`);
        return value;
    }
  }

  /**
   * Parse a date string in various formats to ISO format (YYYY-MM-DD)
   * @param {string} str - The date string
   * @param {string} format - The format (DD.MM.YYYY, MM/DD/YYYY, etc.)
   * @returns {string} - ISO date string or original if parsing fails
   */
  parseDate(str, format) {
    try {
      let day, month, year;

      if (format === 'DD.MM.YYYY') {
        // German format: 01.06.2020
        const parts = str.split('.');
        if (parts.length === 3) {
          day = parts[0].padStart(2, '0');
          month = parts[1].padStart(2, '0');
          year = parts[2];
        }
      } else if (format === 'MM/DD/YYYY') {
        // US format: 06/01/2020
        const parts = str.split('/');
        if (parts.length === 3) {
          month = parts[0].padStart(2, '0');
          day = parts[1].padStart(2, '0');
          year = parts[2];
        }
      } else if (format === 'YYYY-MM-DD') {
        // Already ISO format
        return str;
      }

      if (day && month && year) {
        return `${year}-${month}-${day}`;
      }

      // Try to parse as Excel serial date (number of days since 1900-01-01)
      const serial = parseFloat(str);
      if (!isNaN(serial) && serial > 0 && serial < 100000) {
        const date = new Date((serial - 25569) * 86400 * 1000);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }

      console.warn(`Could not parse date: ${str} with format ${format}`);
      return str;
    } catch (e) {
      console.warn(`Date parse error: ${str}`, e);
      return str;
    }
  }

  /**
   * Parse SQL-like WHERE clause into a filter function
   * Supports: =, !=, <, <=, >, >=, IN (...), NOT IN (...), AND, OR
   * @param {string} whereClause - SQL WHERE clause (without WHERE keyword)
   * @returns {Function} - (row) => boolean
   */
  parseFilter(whereClause) {
    if (!whereClause) {
      return () => true;
    }

    // Remove leading WHERE if present
    let clause = whereClause.trim();
    if (clause.toUpperCase().startsWith('WHERE ')) {
      clause = clause.substring(6).trim();
    }

    try {
      // Convert SQL operators to JavaScript
      let jsExpr = clause;

      // Handle IN (...) - must come before simple operators
      jsExpr = jsExpr.replace(
        /(\w+)\s+IN\s*\(([^)]+)\)/gi,
        (match, field, values) => {
          const items = values.split(',').map(v => v.trim());
          return `[${items.join(',')}].includes(row['${field}'])`;
        }
      );

      // Handle NOT IN (...)
      jsExpr = jsExpr.replace(
        /(\w+)\s+NOT\s+IN\s*\(([^)]+)\)/gi,
        (match, field, values) => {
          const items = values.split(',').map(v => v.trim());
          return `![${items.join(',')}].includes(row['${field}'])`;
        }
      );

      // Handle LIKE (simple prefix/suffix matching)
      jsExpr = jsExpr.replace(
        /(\w+)\s+LIKE\s+'([^']+)'/gi,
        (match, field, pattern) => {
          if (pattern.startsWith('%') && pattern.endsWith('%')) {
            return `String(row['${field}']).includes('${pattern.slice(1, -1)}')`;
          } else if (pattern.startsWith('%')) {
            return `String(row['${field}']).endsWith('${pattern.slice(1)}')`;
          } else if (pattern.endsWith('%')) {
            return `String(row['${field}']).startsWith('${pattern.slice(0, -1)}')`;
          }
          return `row['${field}'] === '${pattern}'`;
        }
      );

      // Handle comparison operators with quoted strings
      jsExpr = jsExpr.replace(/(\w+)\s*>=\s*'([^']+)'/g, "row['$1'] >= '$2'");
      jsExpr = jsExpr.replace(/(\w+)\s*<=\s*'([^']+)'/g, "row['$1'] <= '$2'");
      jsExpr = jsExpr.replace(/(\w+)\s*!=\s*'([^']+)'/g, "row['$1'] !== '$2'");
      jsExpr = jsExpr.replace(/(\w+)\s*=\s*'([^']+)'/g, "row['$1'] === '$2'");
      jsExpr = jsExpr.replace(/(\w+)\s*>\s*'([^']+)'/g, "row['$1'] > '$2'");
      jsExpr = jsExpr.replace(/(\w+)\s*<\s*'([^']+)'/g, "row['$1'] < '$2'");

      // Handle comparison operators with numbers
      jsExpr = jsExpr.replace(/(\w+)\s*>=\s*(\d+(?:\.\d+)?)/g, "row['$1'] >= $2");
      jsExpr = jsExpr.replace(/(\w+)\s*<=\s*(\d+(?:\.\d+)?)/g, "row['$1'] <= $2");
      jsExpr = jsExpr.replace(/(\w+)\s*!=\s*(\d+(?:\.\d+)?)/g, "row['$1'] !== $2");
      jsExpr = jsExpr.replace(/(\w+)\s*=\s*(\d+(?:\.\d+)?)/g, "row['$1'] === $2");
      jsExpr = jsExpr.replace(/(\w+)\s*>\s*(\d+(?:\.\d+)?)/g, "row['$1'] > $2");
      jsExpr = jsExpr.replace(/(\w+)\s*<\s*(\d+(?:\.\d+)?)/g, "row['$1'] < $2");

      // Handle AND/OR
      jsExpr = jsExpr.replace(/\bAND\b/gi, '&&');
      jsExpr = jsExpr.replace(/\bOR\b/gi, '||');

      // Create filter function
      // eslint-disable-next-line no-new-func
      const filterFn = new Function('row', `return ${jsExpr};`);
      return filterFn;
    } catch (e) {
      console.error('Failed to parse filter:', whereClause, e);
      return () => true; // Return all rows on parse error
    }
  }

  /**
   * Run import for an entity
   * @param {string} entityName - Entity name
   * @returns {Object} - { success, recordsRead, recordsFiltered, recordsWritten, error }
   */
  runImport(entityName) {
    const definition = this.parseImportDefinition(entityName);

    if (!definition) {
      return { success: false, error: `No import definition found for ${entityName}` };
    }

    if (!definition.source) {
      return { success: false, error: 'No source file specified in import definition' };
    }

    const sourcePath = path.join(this.systemDir, 'data', definition.source);

    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source file not found: ${definition.source}` };
    }

    try {
      // Read XLSX
      const workbook = XLSX.readFile(sourcePath);

      // Select sheet
      let sheetName = definition.sheet;
      if (!sheetName) {
        sheetName = workbook.SheetNames[0];
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return { success: false, error: `Sheet '${sheetName}' not found in XLSX` };
      }

      // Convert to JSON (array of objects with original column names)
      const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
      const recordsRead = rawData.length;

      // Apply mapping with transforms
      const mappedData = rawData.map(row => {
        const mapped = {};
        for (const [sourceCol, targetCol] of Object.entries(definition.mapping)) {
          if (sourceCol in row) {
            let value = row[sourceCol];
            // Apply transform if specified
            const transform = definition.transforms[sourceCol];
            if (transform) {
              value = this.applyTransform(value, transform);
            }
            mapped[targetCol] = value;
          }
        }
        return mapped;
      });

      // Apply filter
      const filterFn = this.parseFilter(definition.filter);
      const filteredData = mappedData.filter(row => {
        try {
          return filterFn(row);
        } catch (e) {
          console.warn('Filter error for row:', row, e);
          return false;
        }
      });

      const recordsFiltered = recordsRead - filteredData.length;
      const recordsWritten = filteredData.length;

      // Write JSON to import directory
      const outputPath = path.join(this.importDir, `${entityName}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));

      return {
        success: true,
        recordsRead,
        recordsFiltered,
        recordsWritten,
        outputFile: `import/${entityName}.json`
      };
    } catch (e) {
      console.error('Import error:', e);
      return { success: false, error: e.message };
    }
  }
}

module.exports = ImportManager;
