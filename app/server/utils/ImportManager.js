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
  /**
   * @param {string} systemDir - Path to system directory
   * @param {Object} [logger] - Logger instance (defaults to console)
   */
  constructor(systemDir, logger = null) {
    this.systemDir = systemDir;
    this.logger = logger || console;
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
   * Get raw markdown content of import definition
   * @param {string} entityName - Entity name
   * @returns {Object} - { content, path } or { error }
   */
  getRawDefinition(entityName) {
    const mdPath = path.join(this.importsDir, `${entityName}.md`);

    if (!fs.existsSync(mdPath)) {
      return { error: `No import definition found for ${entityName}` };
    }

    const content = fs.readFileSync(mdPath, 'utf-8');
    return { content, path: `imports/${entityName}.md` };
  }

  /**
   * Save raw markdown content of import definition
   * @param {string} entityName - Entity name
   * @param {string} content - Markdown content
   * @returns {Object} - { success } or { error }
   */
  saveRawDefinition(entityName, content) {
    const mdPath = path.join(this.importsDir, `${entityName}.md`);

    try {
      fs.writeFileSync(mdPath, content, 'utf-8');
      return { success: true, path: `imports/${entityName}.md` };
    } catch (e) {
      this.logger.error('Failed to save import definition:', { error: e.message });
      return { error: e.message };
    }
  }

  /**
   * Get column names (schema) from the XLSX source file
   * @param {string} entityName - Entity name
   * @returns {Object} - { columns, sourceFile, sheet, error }
   */
  getSourceSchema(entityName) {
    const definition = this.parseImportDefinition(entityName);

    if (!definition) {
      return { error: `No import definition found for ${entityName}` };
    }

    if (!definition.source) {
      return { error: 'No source file specified in import definition' };
    }

    const sourcePath = path.join(this.systemDir, 'data', definition.source);

    if (!fs.existsSync(sourcePath)) {
      return { error: `Source file not found: ${definition.source}` };
    }

    try {
      // Read only first row (headers) for efficiency
      const workbook = XLSX.readFile(sourcePath, { sheetRows: 2 });

      let sheetName = definition.sheet;
      if (!sheetName) {
        sheetName = workbook.SheetNames[0];
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return { error: `Sheet '${sheetName}' not found in XLSX` };
      }

      // Get column names from first row
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      const columns = [];

      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = sheet[cellAddress];
        if (cell && cell.v !== undefined) {
          columns.push(String(cell.v));
        }
      }

      return {
        columns,
        sourceFile: definition.source,
        sheet: sheetName
      };
    } catch (e) {
      this.logger.error('Failed to read source schema:', { error: e.message });
      return { error: e.message };
    }
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
      maxRows: null,  // Optional row limit for large files
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

      // Parse MaxRows: directive (optional limit for large files)
      if (trimmed.startsWith('MaxRows:')) {
        const val = parseInt(trimmed.substring(8).trim(), 10);
        if (!isNaN(val) && val > 0) {
          definition.maxRows = val;
        }
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
        this.logger.warn(`Unknown transform: ${transform}`);
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

      this.logger.warn(`Could not parse date: ${str} with format ${format}`);
      return str;
    } catch (e) {
      this.logger.warn(`Date parse error: ${str}`, { error: e.message });
      return str;
    }
  }

  /**
   * Parse a source expression from the mapping table
   * Supported formats:
   * - Column name: "Registration" → value from XLSX column
   * - Number literal: 42 or 3.14 → fixed number
   * - String literal: "text" or 'text' → fixed string
   * - random(min,max) → random integer in range
   * - random("a","b","c") → random choice from strings
   * - random(EnumType) → random internal value from enum
   * @param {string} expr - The source expression
   * @returns {Object} - { type, value?, name?, min?, max?, values?, enumName? }
   */
  parseSourceExpression(expr) {
    expr = expr.trim();

    // Number literal: 42, -5, 3.14
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return { type: 'literal', value: parseFloat(expr) };
    }

    // String literal: "text" or 'text'
    const stringMatch = expr.match(/^["'](.*)["']$/);
    if (stringMatch) {
      return { type: 'literal', value: stringMatch[1] };
    }

    // random(...)
    const randomMatch = expr.match(/^random\((.+)\)$/i);
    if (randomMatch) {
      return this.parseRandomExpression(randomMatch[1]);
    }

    // Otherwise: XLSX column name
    return { type: 'column', name: expr };
  }

  /**
   * Parse random(...) expression arguments
   * @param {string} args - The arguments inside random(...)
   * @returns {Object} - { type: 'randomNumber'|'randomChoice'|'randomEnum', ... }
   */
  parseRandomExpression(args) {
    args = args.trim();

    // Check for number range: random(1, 100)
    const numberRangeMatch = args.match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    if (numberRangeMatch) {
      return {
        type: 'randomNumber',
        min: parseInt(numberRangeMatch[1], 10),
        max: parseInt(numberRangeMatch[2], 10)
      };
    }

    // Check for string choices: random("A", "B", "C")
    const stringMatches = args.match(/["']([^"']+)["']/g);
    if (stringMatches && stringMatches.length > 0) {
      const values = stringMatches.map(s => s.slice(1, -1));
      return { type: 'randomChoice', values };
    }

    // Otherwise: ENUM type name: random(CurrencyCode)
    return { type: 'randomEnum', enumName: args };
  }

  /**
   * Resolve a source expression to a value for a given row
   * @param {Object} sourceExpr - Parsed source expression from parseSourceExpression()
   * @param {Object} row - The current XLSX row data
   * @returns {any} - The resolved value
   */
  resolveSourceValue(sourceExpr, row) {
    switch (sourceExpr.type) {
      case 'literal':
        return sourceExpr.value;

      case 'column':
        return row[sourceExpr.name];

      case 'randomNumber': {
        const min = sourceExpr.min;
        const max = sourceExpr.max;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      case 'randomChoice': {
        const idx = Math.floor(Math.random() * sourceExpr.values.length);
        return sourceExpr.values[idx];
      }

      case 'randomEnum': {
        const enumValues = this.getEnumValues(sourceExpr.enumName);
        if (!enumValues || enumValues.length === 0) {
          this.logger.warn(`Unknown ENUM type: ${sourceExpr.enumName}`);
          return null;
        }
        const idx = Math.floor(Math.random() * enumValues.length);
        return enumValues[idx].internal;
      }

      default:
        return undefined;
    }
  }

  /**
   * Get enum values from the TypeRegistry
   * @param {string} enumName - The enum type name
   * @returns {Array|null} - Array of { internal, external, description } or null
   */
  getEnumValues(enumName) {
    try {
      const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
      const registry = getTypeRegistry();
      return registry.getEnumValues(enumName);
    } catch (e) {
      this.logger.warn(`Could not get enum values for ${enumName}:`, e.message);
      return null;
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
      this.logger.error('Failed to parse filter:', { whereClause, error: e.message });
      return () => true; // Return all rows on parse error
    }
  }

  /**
   * Run import for an entity
   * @param {string} entityName - Entity name
   * @returns {Promise<Object>} - { success, recordsRead, recordsFiltered, recordsWritten, error }
   */
  async runImport(entityName) {
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

    // Check for LibreOffice/Excel lock file
    const sourceDir = path.dirname(sourcePath);
    const sourceFile = path.basename(sourcePath);
    const lockFile = path.join(sourceDir, `.~lock.${sourceFile}#`);
    if (fs.existsSync(lockFile)) {
      return {
        success: false,
        error: `File is locked (open in another application): ${sourceFile}. Please close the file and try again.`
      };
    }

    try {
      // Read XLSX with row limit to avoid processing empty rows
      // (Excel files sometimes have range extending to max rows due to formatting)
      const maxRows = definition.maxRows || 100000;
      const workbook = XLSX.readFile(sourcePath, { sheetRows: maxRows });

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
      this.logger.debug('XLSX parsed:', { recordsRead });

      // Apply mapping with transforms
      // Source expressions can be: column names, literals, or random() generators
      const mappedData = rawData.map(row => {
        const mapped = {};
        for (const [sourceExprStr, targetCol] of Object.entries(definition.mapping)) {
          const sourceExpr = this.parseSourceExpression(sourceExprStr);
          let value = this.resolveSourceValue(sourceExpr, row);

          if (value !== undefined) {
            // Apply transform if specified
            const transform = definition.transforms[sourceExprStr];
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
          this.logger.warn('Filter error for row:', { row, error: e.message });
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
      this.logger.error('Import error:', { error: e.message });
      return { success: false, error: e.message };
    }
  }
}

module.exports = ImportManager;
