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
      first: null,    // Column name for deduplication (keep first occurrence)
      mapping: [],    // Array of { source, target, transform } - allows same source multiple times
      sourceFilter: [],  // Array of { column, regex } - pre-mapping filter on XLSX columns
      filter: null
    };

    let inMapping = false;
    let inFilter = false;
    let inSourceFilter = false;
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

      // Parse First: directive (deduplication - keep first occurrence per value)
      if (trimmed.startsWith('First:')) {
        definition.first = trimmed.substring(6).trim();
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
        inSourceFilter = false;
        continue;
      }

      if (trimmed.startsWith('## Source Filter')) {
        inMapping = false;
        inFilter = false;
        inSourceFilter = true;
        continue;
      }

      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        inMapping = false;
        inFilter = false;
        inSourceFilter = false;
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
            definition.mapping.push({ source, target, transform });
          }
        }
      }

      // Collect filter lines
      if (inFilter && trimmed) {
        filterLines.push(trimmed);
      }

      // Parse Source Filter lines: ColumnName: /regex/
      if (inSourceFilter && trimmed) {
        const match = trimmed.match(/^(.+?):\s*\/(.+)\/([gimsuy]*)$/);
        if (match) {
          const column = match[1].trim();
          const pattern = match[2];
          const flags = match[3] || '';
          definition.sourceFilter.push({ column, pattern, flags });
        }
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
        // Handle German number format: 1.234,56 → 1234.56
        // Remove thousand separators (dots) and replace decimal comma with dot
        const germanNum = str.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(germanNum);
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

    // concat(...)
    const concatMatch = expr.match(/^concat\((.+)\)$/i);
    if (concatMatch) {
      return this.parseConcatExpression(concatMatch[1]);
    }

    // calc(...) - arithmetic expression with column references
    const calcMatch = expr.match(/^calc\((.+)\)$/i);
    if (calcMatch) {
      return this.parseCalcExpression(calcMatch[1]);
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
   * Parse concat(...) expression arguments
   * Supports: concat(Col1, " ", Col2, "-", Col3)
   * - Column names without quotes
   * - String literals with quotes
   * @param {string} args - The arguments inside concat(...)
   * @returns {Object} - { type: 'concat', parts: [...] }
   */
  parseConcatExpression(args) {
    const parts = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < args.length; i++) {
      const ch = args[i];

      if (!inQuotes && (ch === '"' || ch === "'")) {
        // Start of string literal
        inQuotes = true;
        quoteChar = ch;
      } else if (inQuotes && ch === quoteChar) {
        // End of string literal
        parts.push({ type: 'literal', value: current });
        current = '';
        inQuotes = false;
        quoteChar = null;
      } else if (!inQuotes && ch === ',') {
        // Separator - flush current if non-empty (column name)
        const trimmed = current.trim();
        if (trimmed) {
          parts.push({ type: 'column', name: trimmed });
        }
        current = '';
      } else if (inQuotes) {
        // Inside quotes - collect everything
        current += ch;
      } else if (ch !== ' ' || current.length > 0) {
        // Outside quotes - collect non-leading spaces
        current += ch;
      }
    }

    // Handle remaining content (last column name)
    const trimmed = current.trim();
    if (trimmed) {
      parts.push({ type: 'column', name: trimmed });
    }

    return { type: 'concat', parts };
  }

  /**
   * Parse calc(...) expression for arithmetic operations
   * Supports: calc(Col1 * Col2), calc(Price / 100), calc(( A + B ) * C)
   * - Column names may contain spaces and hyphens (e.g., "Faktor Von-Währung")
   * - Operators must be surrounded by spaces: ` + `, ` - `, ` * `, ` / `
   * - Parentheses must have space on inner side: `( ` and ` )`
   * - Number literals
   * @param {string} expr - The expression inside calc(...)
   * @returns {Object} - { type: 'calc', tokens: array, columns: string[] }
   */
  parseCalcExpression(expr) {
    expr = expr.trim();
    const columns = [];
    const tokens = [];

    // Replace operators (with surrounding spaces) with unique markers
    // This preserves column names with spaces like "Faktor Von-Währung"
    const MARKERS = {
      ' + ': '\x00ADD\x00',
      ' - ': '\x00SUB\x00',
      ' * ': '\x00MUL\x00',
      ' / ': '\x00DIV\x00',
      '( ': '\x00LPAR\x00',
      ' )': '\x00RPAR\x00'
    };

    let marked = expr;
    for (const [op, marker] of Object.entries(MARKERS)) {
      marked = marked.split(op).join(marker);
    }

    // Split by markers
    const parts = marked.split(/\x00/);

    for (const part of parts) {
      if (!part) continue;

      // Check for operator markers
      if (part === 'ADD') {
        tokens.push({ type: 'operator', value: '+' });
      } else if (part === 'SUB') {
        tokens.push({ type: 'operator', value: '-' });
      } else if (part === 'MUL') {
        tokens.push({ type: 'operator', value: '*' });
      } else if (part === 'DIV') {
        tokens.push({ type: 'operator', value: '/' });
      } else if (part === 'LPAR') {
        tokens.push({ type: 'operator', value: '(' });
      } else if (part === 'RPAR') {
        tokens.push({ type: 'operator', value: ')' });
      } else {
        // It's an operand (number or column name)
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          tokens.push({ type: 'operand', value: trimmed, isNumber: true });
        } else {
          tokens.push({ type: 'operand', value: trimmed, isColumn: true });
          columns.push(trimmed);
        }
      }
    }

    return { type: 'calc', tokens, columns };
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

      case 'concat': {
        const values = sourceExpr.parts.map(part => {
          if (part.type === 'literal') {
            return part.value;
          } else if (part.type === 'column') {
            const val = row[part.name];
            return val === null || val === undefined ? '' : String(val);
          }
          return '';
        });
        return values.join('');
      }

      case 'calc': {
        // Build expression string by replacing column references with values
        let exprParts = [];
        for (const token of sourceExpr.tokens) {
          if (token.type === 'operator') {
            exprParts.push(token.value);
          } else if (token.isNumber) {
            exprParts.push(token.value);
          } else if (token.isColumn) {
            const val = row[token.value];
            if (val === null || val === undefined) {
              // If any column is null, result is null
              return null;
            }
            // Parse number (handle German format with comma)
            const numVal = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
            if (isNaN(numVal)) {
              this.logger.warn(`calc: Non-numeric value in column "${token.value}": ${val}`);
              return null;
            }
            exprParts.push(numVal);
          }
        }

        // Evaluate the expression
        try {
          // eslint-disable-next-line no-new-func
          const result = new Function(`return ${exprParts.join(' ')};`)();
          return result;
        } catch (e) {
          this.logger.warn(`calc: Expression error: ${exprParts.join(' ')}`, { error: e.message });
          return null;
        }
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
      let rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
      const recordsRead = rawData.length;
      this.logger.debug('XLSX parsed:', { recordsRead });

      // Apply source filter (regex-based filter on XLSX columns, before mapping)
      let recordsSourceFiltered = 0;
      if (definition.sourceFilter.length > 0) {
        const sourceFilterFns = definition.sourceFilter.map(({ column, pattern, flags }) => {
          const regex = new RegExp(pattern, flags);
          return (row) => {
            const value = row[column];
            if (value === null || value === undefined) return false;
            return regex.test(String(value));
          };
        });
        const beforeCount = rawData.length;
        // All source filters are AND-ed together
        rawData = rawData.filter(row => sourceFilterFns.every(fn => fn(row)));
        recordsSourceFiltered = beforeCount - rawData.length;
        this.logger.debug('Source filter applied:', { recordsSourceFiltered, remaining: rawData.length });
      }

      // Apply First: deduplication (keep first occurrence per unique value)
      let recordsDeduplicated = 0;
      if (definition.first) {
        const seen = new Set();
        const beforeCount = rawData.length;
        rawData = rawData.filter(row => {
          const key = row[definition.first];
          if (key === null || key === undefined) return true; // Keep rows with null/undefined
          const keyStr = String(key);
          if (seen.has(keyStr)) return false;
          seen.add(keyStr);
          return true;
        });
        recordsDeduplicated = beforeCount - rawData.length;
        this.logger.debug('First deduplication applied:', { column: definition.first, recordsDeduplicated, remaining: rawData.length });
      }

      // Apply mapping with transforms
      // Source expressions can be: column names, literals, or random() generators
      // Mapping is an array to allow same source column mapped to multiple targets
      const mappedData = rawData.map(row => {
        const mapped = {};
        for (const { source: sourceExprStr, target: targetCol, transform } of definition.mapping) {
          const sourceExpr = this.parseSourceExpression(sourceExprStr);
          let value = this.resolveSourceValue(sourceExpr, row);

          if (value !== undefined) {
            // Apply transform if specified
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
        recordsSourceFiltered,
        recordsDeduplicated,
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
