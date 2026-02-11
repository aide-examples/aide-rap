/**
 * ImportManager - Manages data imports based on MD definitions
 *
 * Supports XLSX files, JSON files, and API URLs as data sources.
 *
 * Workflow:
 * 1. Parse import definition from docs/imports/*.md
 * 2. Load source data (XLSX, JSON file, or API URL)
 * 3. Apply source edits and filters
 * 4. Apply column mapping with transforms
 * 5. Apply SQL-like filter
 * 6. Write JSON to data/import/
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
    this.importsDir = path.join(systemDir, 'docs', 'imports');
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
        if (definition.source.startsWith('http://') || definition.source.startsWith('https://')) {
          hasSource = true; // API sources are always "available"
        } else {
          const sourcePath = path.join(this.systemDir, 'data', definition.source);
          hasSource = fs.existsSync(sourcePath);
        }
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
    return { content, path: `docs/imports/${entityName}.md` };
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
      return { success: true, path: `docs/imports/${entityName}.md` };
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
  async getSourceSchema(entityName) {
    const definition = this.parseImportDefinition(entityName);

    if (!definition) {
      return { error: `No import definition found for ${entityName}` };
    }

    if (!definition.source) {
      return { error: 'No source file specified in import definition' };
    }

    // JSON/API sources: load first page and extract keys
    const isUrl = definition.source.startsWith('http://') || definition.source.startsWith('https://');
    const isJson = !isUrl && definition.source.endsWith('.json');

    if (isUrl || isJson) {
      try {
        const { rawData, error } = isUrl
          ? await this.loadFromApi(definition, 1)
          : this.loadFromJson(path.join(this.systemDir, 'data', definition.source), definition);
        if (!rawData || rawData.length === 0) {
          return { error: error || 'No data returned from source' };
        }
        const columns = Object.keys(rawData[0]);
        return { columns, sourceFile: definition.source };
      } catch (e) {
        this.logger.error('Failed to read source schema:', { error: e.message });
        return { error: e.message };
      }
    }

    // XLSX source
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
   * Get sample rows from the XLSX source file
   * @param {string} entityName - Entity name
   * @param {number} count - Number of rows to return (default: 3)
   * @returns {Object} - { records, sourceFile, sheet, error }
   */
  async getSourceSample(entityName, count = 3) {
    const definition = this.parseImportDefinition(entityName);

    if (!definition) {
      return { error: `No import definition found for ${entityName}` };
    }

    if (!definition.source) {
      return { error: 'No source file specified in import definition' };
    }

    // JSON/API sources: load first page and return first N records
    const isUrl = definition.source.startsWith('http://') || definition.source.startsWith('https://');
    const isJson = !isUrl && definition.source.endsWith('.json');

    if (isUrl || isJson) {
      try {
        const { rawData, error } = isUrl
          ? await this.loadFromApi(definition, 1)
          : this.loadFromJson(path.join(this.systemDir, 'data', definition.source), definition);
        if (!rawData) {
          return { error: error || 'No data returned from source' };
        }
        return {
          records: rawData.slice(0, count),
          sourceFile: definition.source,
          totalRows: rawData.length
        };
      } catch (e) {
        this.logger.error('Failed to read source sample:', { error: e.message });
        return { error: e.message };
      }
    }

    // XLSX source
    const sourcePath = path.join(this.systemDir, 'data', definition.source);

    if (!fs.existsSync(sourcePath)) {
      return { error: `Source file not found: ${definition.source}` };
    }

    try {
      // Read only first few rows for efficiency (header + count data rows)
      const workbook = XLSX.readFile(sourcePath, { sheetRows: count + 1 });

      let sheetName = definition.sheet;
      if (!sheetName) {
        sheetName = workbook.SheetNames[0];
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return { error: `Sheet '${sheetName}' not found in XLSX` };
      }

      // Convert sheet to JSON (first row becomes keys)
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

      return {
        records: rows.slice(0, count),
        sourceFile: definition.source,
        sheet: sheetName,
        totalRows: rows.length
      };
    } catch (e) {
      this.logger.error('Failed to read source sample:', { error: e.message });
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
      dataPath: null,   // JSON path to data array (e.g. "data" or "response.items")
      authKey: null,    // Config key for API credentials (e.g. "kirsenApi")
      match: null,      // Match directive for refresh imports { entityField, apiField }
      maxRows: null,  // Optional row limit for large files (limits XLSX reading)
      limit: null,    // Optional output limit for testing (limits final output after filtering)
      first: null,    // Column name for deduplication (keep first occurrence)
      sort: null,     // Column name for sorting rawData (smart: detects MM.YYYY, numbers)
      changes: null,  // { group: ['col1','col2'], track: ['col3','col4'] } - consecutive dedup
      mapping: [],    // Array of { source, target, transform } - allows same source multiple times
      sourceEdit: [],    // Array of { column, pattern, replacement, flags } - regex edits on XLSX columns
      sourceFilter: [],  // Array of { column, regex } - pre-mapping filter on XLSX columns
      filter: null
    };

    let inMapping = false;
    let mappingTableStarted = false;  // Only parse rows after "| Source |..." header
    let inFilter = false;
    let inSourceEdit = false;
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

      // Parse Limit: directive (optional output limit for testing)
      if (trimmed.startsWith('Limit:')) {
        const val = parseInt(trimmed.substring(6).trim(), 10);
        if (!isNaN(val) && val > 0) {
          definition.limit = val;
        }
        continue;
      }

      // Parse First: directive (deduplication - keep first occurrence per value)
      if (trimmed.startsWith('First:')) {
        definition.first = trimmed.substring(6).trim();
        continue;
      }

      // Parse Sort: directive (sort rawData by column before dedup)
      if (trimmed.startsWith('Sort:')) {
        definition.sort = trimmed.substring(5).trim();
        continue;
      }

      // Parse Changes: directive (consecutive dedup - keep only when track columns change per group)
      // Syntax: Changes: GroupCol1, GroupCol2 | TrackCol1, TrackCol2
      if (trimmed.startsWith('Changes:')) {
        const parts = trimmed.substring(8).split('|').map(s => s.trim());
        if (parts.length === 2) {
          definition.changes = {
            group: parts[0].split(',').map(s => s.trim()).filter(Boolean),
            track: parts[1].split(',').map(s => s.trim()).filter(Boolean)
          };
        }
        continue;
      }

      // Parse DataPath: directive (path to data array in JSON response, e.g. "data" or "response.items")
      if (trimmed.startsWith('DataPath:')) {
        definition.dataPath = trimmed.substring(9).trim();
        continue;
      }

      // Parse AuthKey: directive (config key for API credentials, e.g. "kirsenApi")
      if (trimmed.startsWith('AuthKey:')) {
        definition.authKey = trimmed.substring(8).trim();
        continue;
      }

      // Parse Match: directive (for refresh imports: Match: entity_field = api_field)
      if (trimmed.startsWith('Match:')) {
        const matchParts = trimmed.substring(6).trim().split('=').map(s => s.trim());
        if (matchParts.length === 2) {
          definition.match = {
            entityField: matchParts[0],
            apiField: matchParts[1]
          };
        }
        continue;
      }

      // Detect section headers
      if (trimmed.startsWith('## Mapping')) {
        inMapping = true;
        mappingTableStarted = false;  // Reset - wait for "| Source |" header
        inFilter = false; inSourceEdit = false; inSourceFilter = false;
        continue;
      }

      if (trimmed.startsWith('## Source Edit')) {
        inSourceEdit = true;
        inMapping = false; inFilter = false; inSourceFilter = false;
        continue;
      }

      if (trimmed.startsWith('## Source Filter')) {
        inSourceFilter = true;
        inMapping = false; inFilter = false; inSourceEdit = false;
        continue;
      }

      if (trimmed.startsWith('## Filter')) {
        inFilter = true;
        inMapping = false; inSourceEdit = false; inSourceFilter = false;
        continue;
      }

      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        inMapping = false;
        inFilter = false;
        inSourceEdit = false;
        inSourceFilter = false;
        continue;
      }

      // Parse mapping table rows (Source | Target | Transform)
      // Only start parsing after seeing "| Source | Target |" header row
      if (inMapping && trimmed.startsWith('|') && !trimmed.includes('---')) {
        const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length >= 2) {
          const source = cells[0];
          const target = cells[1];
          const transform = cells[2] || null;

          // Check for header row "| Source | Target |..."
          if (source.toLowerCase() === 'source' && target.toLowerCase() === 'target') {
            mappingTableStarted = true;
            continue;
          }

          // Only parse data rows after header has been seen
          if (mappingTableStarted) {
            definition.mapping.push({ source, target, transform });
          }
        }
      }

      // Collect filter lines
      if (inFilter && trimmed) {
        filterLines.push(trimmed);
      }

      // Parse Source Edit lines: ColumnName: /pattern/replacement/flags
      if (inSourceEdit && trimmed) {
        const match = trimmed.match(/^(.+?):\s*\/(.+?)\/(.*)\/([gimsuy]*)$/);
        if (match) {
          definition.sourceEdit.push({
            column: match[1].trim(),
            pattern: match[2],
            replacement: match[3],
            flags: match[4] || ''
          });
        }
      }

      // Parse Source Filter lines: ColumnName: /regex/ or ColumnName: !/regex/ (negated)
      if (inSourceFilter && trimmed) {
        const match = trimmed.match(/^(.+?):\s*(!)?\/(.+)\/([gimsuy]*)$/);
        if (match) {
          const column = match[1].trim();
          const negate = !!match[2];  // true if ! prefix
          const pattern = match[3];
          const flags = match[4] || '';
          definition.sourceFilter.push({ column, pattern, flags, negate });
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
   * - string           → force value to string
   * - trim             → trim whitespace
   * - replace:/pattern/replacement/flags → regex replacement
   * - concat:OtherColumn:separator → concatenate with another column (e.g., concat:Serial:-)
   * @param {any} value - The value to transform
   * @param {string} transform - The transform specification
   * @param {Object} [row] - The source row (needed for concat transform)
   * @returns {any} - The transformed value
   */
  applyTransform(value, transform, row = null) {
    if (value === null || value === undefined || value === '') {
      return value;
    }

    const str = String(value).trim();

    // Date transforms
    if (transform.startsWith('date:')) {
      const format = transform.substring(5);
      return this.parseDate(str, format);
    }

    // Regex replace: replace:/pattern/replacement/flags
    if (transform.startsWith('replace:')) {
      const spec = transform.substring(8);
      // Parse /pattern/replacement/flags format
      const match = spec.match(/^\/(.+?)\/(.*)\/([gimsuy]*)$/);
      if (match) {
        const [, pattern, replacement, flags] = match;
        try {
          const regex = new RegExp(pattern, flags || 'g');
          return str.replace(regex, replacement);
        } catch (e) {
          this.logger.warn(`Invalid regex in replace transform: ${e.message}`);
          return value;
        }
      }
      this.logger.warn(`Invalid replace transform syntax: ${spec}`);
      return value;
    }

    // Concat transform: concat:OtherColumn:separator
    // Concatenates current value with another column using separator
    // Example: concat:Serial:- → "Boeing" + "-" + "ABC123" = "Boeing-ABC123"
    if (transform.startsWith('concat:')) {
      const spec = transform.substring(7);
      const parts = spec.split(':');
      if (parts.length >= 1 && row) {
        const otherCol = parts[0];
        const separator = parts.length >= 2 ? parts[1] : '';
        const otherValue = row[otherCol];
        if (otherValue !== null && otherValue !== undefined) {
          return `${str}${separator}${String(otherValue).trim()}`;
        }
      }
      this.logger.warn(`Invalid concat transform or missing row: ${transform}`);
      return value;
    }

    // Simple transforms
    switch (transform) {
      case 'string':
        // Force value to string (useful for numeric-looking cells like serial numbers or codes)
        return str;

      case 'timestamp':
        // Convert Unix timestamp (seconds) to ISO datetime string
        const ts = parseFloat(str);
        if (!isNaN(ts)) {
          return new Date(ts * 1000).toISOString().replace('T', ' ').substring(0, 19);
        }
        return value;

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
      } else if (format === 'MM.YYYY') {
        // Month.Year format: 05.1993 → defaults to 1st of month
        const parts = str.split('.');
        if (parts.length === 2) {
          day = '01';
          month = parts[0].padStart(2, '0');
          year = parts[1];
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
      return null;
    } catch (e) {
      this.logger.warn(`Date parse error: ${str}`, { error: e.message });
      return null;
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
   * With inline transforms: concat(Col1>>replace:/a/b/, " ", Col2)
   * - Column names without quotes
   * - String literals with quotes
   * - >> followed by transform spec applies transform to that column
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
        // Separator - flush current if non-empty (column name, possibly with transform)
        const trimmed = current.trim();
        if (trimmed) {
          parts.push(this.parseColumnWithTransform(trimmed));
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

    // Handle remaining content (last column name, possibly with transform)
    const trimmed = current.trim();
    if (trimmed) {
      parts.push(this.parseColumnWithTransform(trimmed));
    }

    return { type: 'concat', parts };
  }

  /**
   * Parse a column reference that may include an inline transform
   * Format: "ColumnName" or "ColumnName>>transform"
   * Example: "Engine Type>>replace:/([A-Z]+)(\d)/$1 $2/"
   * Note: Using >> instead of | to avoid conflicts with Markdown table syntax
   * @param {string} spec - Column spec with optional transform
   * @returns {Object} - { type: 'column', name: string, transform?: string }
   */
  parseColumnWithTransform(spec) {
    const delimIndex = spec.indexOf('>>');
    if (delimIndex === -1) {
      return { type: 'column', name: spec };
    }
    const name = spec.substring(0, delimIndex).trim();
    const transform = spec.substring(delimIndex + 2).trim();
    return { type: 'column', name, transform };
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
            let val = row[part.name];
            if (val === null || val === undefined) return '';
            val = String(val);
            // Apply inline transform if specified (e.g., Col|replace:/a/b/)
            if (part.transform) {
              val = this.applyTransform(val, part.transform, row);
            }
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
   * Flatten nested JSON object to dot-notation keys
   * { location: { lat: 48.1 } } → { "location": {...}, "location.lat": 48.1, "lat": 48.1 }
   * Top-level keys are kept without prefix for convenience.
   */
  flattenObject(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj || {})) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value, fullKey));
      } else {
        result[fullKey] = value;
      }
      // Top-level keys also without prefix for simple access
      if (!prefix) result[key] = value;
    }
    return result;
  }

  /**
   * Build HTTP auth headers from system config
   * @param {string} authKey - Config key (e.g. "kirsenApi")
   * @returns {Object} - Headers object
   */
  buildAuthHeaders(authKey) {
    if (!authKey) return {};
    const configPath = path.join(this.systemDir, 'config.json');
    if (!fs.existsSync(configPath)) return {};
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const creds = config[authKey];
    if (creds?.login && creds?.password) {
      return { 'Authorization': `Basic ${Buffer.from(creds.login + ':' + creds.password).toString('base64')}` };
    }
    return {};
  }

  /**
   * Navigate into a nested JSON object using a dot-path
   * @param {*} data - Root data
   * @param {string} dataPath - Dot-separated path (e.g. "data" or "response.items")
   * @returns {*} - The value at the path
   */
  resolveDataPath(data, dataPath) {
    if (!dataPath) return data;
    for (const key of dataPath.split('.')) {
      data = data?.[key];
    }
    return data;
  }

  /**
   * Load data from a local JSON file
   * @param {string} filePath - Absolute path to JSON file
   * @param {Object} definition - Import definition with dataPath
   * @returns {Object} - { rawData } or { rawData: null, error }
   */
  loadFromJson(filePath, definition) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let data = this.resolveDataPath(raw, definition.dataPath);
    if (!Array.isArray(data)) {
      return { rawData: null, error: `JSON does not contain array${definition.dataPath ? ` at DataPath '${definition.dataPath}'` : ''}` };
    }
    return { rawData: data.map(item => this.flattenObject(item)) };
  }

  /**
   * Load data from an API URL (with pagination support)
   * @param {Object} definition - Import definition with source URL, authKey, dataPath
   * @param {number} [maxPages=100] - Maximum pages to fetch
   * @returns {Promise<Object>} - { rawData } or { rawData: null, error }
   */
  async loadFromApi(definition, maxPages = 100) {
    let allData = [];
    let url = definition.source;
    const headers = this.buildAuthHeaders(definition.authKey);
    let page = 0;

    while (url && page < maxPages) {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        return { rawData: null, error: `API returned HTTP ${resp.status}: ${resp.statusText}` };
      }
      const json = await resp.json();

      let pageData = this.resolveDataPath(json, definition.dataPath);
      if (Array.isArray(pageData)) {
        allData = allData.concat(pageData);
      } else if (pageData && typeof pageData === 'object') {
        // Single-object response (no array)
        allData.push(pageData);
      }

      // Follow pagination links (Kirsen pattern: links.next)
      url = json?.links?.next || null;
      page++;
    }

    if (allData.length === 0) {
      return { rawData: null, error: 'API returned no data' };
    }
    return { rawData: allData.map(item => this.flattenObject(item)) };
  }

  /**
   * Load data from XLSX file (extracted from original runImport)
   * @param {string} sourcePath - Absolute path to XLSX file
   * @param {Object} definition - Import definition with sheet, maxRows, limit
   * @returns {Object} - { rawData } or { rawData: null, error }
   */
  loadFromXlsx(sourcePath, definition) {
    // Check for LibreOffice/Excel lock file
    const sourceDir = path.dirname(sourcePath);
    const sourceFile = path.basename(sourcePath);
    const lockFile = path.join(sourceDir, `.~lock.${sourceFile}#`);
    if (fs.existsSync(lockFile)) {
      return {
        rawData: null,
        error: `File is locked (open in another application): ${sourceFile}. Please close the file and try again.`
      };
    }

    const maxRows = definition.maxRows || 100000;
    const effectiveMaxRows = definition.limit ? Math.min(maxRows, definition.limit + 1) : maxRows;
    const workbook = XLSX.readFile(sourcePath, { sheetRows: effectiveMaxRows });

    let sheetName = definition.sheet;
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { rawData: null, error: `Sheet '${sheetName}' not found in XLSX` };
    }

    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return { rawData };
  }

  /**
   * Load source data based on definition type (URL, JSON file, or XLSX)
   * @param {Object} definition - Import definition
   * @returns {Promise<Object>} - { rawData } or { rawData: null, error }
   */
  async loadSourceData(definition) {
    const source = definition.source;

    // API URL
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return this.loadFromApi(definition);
    }

    // Local file
    const sourcePath = path.join(this.systemDir, 'data', source);
    if (!fs.existsSync(sourcePath)) {
      return { rawData: null, error: `Source not found: ${source}` };
    }

    // JSON file
    if (source.endsWith('.json')) {
      return this.loadFromJson(sourcePath, definition);
    }

    // XLSX file (default)
    return this.loadFromXlsx(sourcePath, definition);
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

    try {
      // Load source data (XLSX, JSON file, or API)
      const { rawData: loadedData, error: loadError } = await this.loadSourceData(definition);
      if (!loadedData) {
        return { success: false, error: loadError };
      }

      let rawData = loadedData;
      const recordsRead = rawData.length;
      this.logger.debug('Source loaded:', { recordsRead, source: definition.source });

      // Apply limit early (truncate before any processing to save time)
      let recordsLimited = 0;
      if (definition.limit && rawData.length > definition.limit) {
        recordsLimited = rawData.length - definition.limit;
        rawData = rawData.slice(0, definition.limit);
        this.logger.debug('Limit applied early:', { limit: definition.limit, truncated: recordsLimited });
      }

      // Apply source edit (regex replacements on XLSX columns, before filtering)
      if (definition.sourceEdit.length > 0) {
        const compiledEdits = definition.sourceEdit.map(({ column, pattern, replacement, flags }) => ({
          column, replacement, regex: new RegExp(pattern, flags)
        }));
        for (const row of rawData) {
          for (const { column, replacement, regex } of compiledEdits) {
            if (row[column] != null) {
              row[column] = String(row[column]).replace(regex, replacement);
            }
          }
        }
        this.logger.debug('Source edit applied:', { rules: compiledEdits.length, records: rawData.length });
      }

      // Apply source filter (regex-based filter on XLSX columns, before mapping)
      let recordsSourceFiltered = 0;
      if (definition.sourceFilter.length > 0) {
        const sourceFilterFns = definition.sourceFilter.map(({ column, pattern, flags, negate }) => {
          const regex = new RegExp(pattern, flags);
          return (row) => {
            const value = row[column];
            if (value === null || value === undefined) return negate; // null/undefined: false unless negated
            const matches = regex.test(String(value));
            return negate ? !matches : matches;
          };
        });
        const beforeCount = rawData.length;
        // All source filters are AND-ed together
        rawData = rawData.filter(row => sourceFilterFns.every(fn => fn(row)));
        recordsSourceFiltered = beforeCount - rawData.length;
        this.logger.debug('Source filter applied:', { recordsSourceFiltered, remaining: rawData.length });
      }

      // Apply Sort: (sort rawData by column before dedup — smart comparator)
      if (definition.sort) {
        const sortCol = definition.sort;
        const mmYYYY = /^(\d{1,2})\.(\d{4})$/;
        const toSortKey = (val) => {
          if (val == null) return '';
          const s = String(val);
          const m = s.match(mmYYYY);
          if (m) return `${m[2]}-${m[1].padStart(2, '0')}`; // MM.YYYY → YYYY-MM
          const n = parseFloat(s);
          if (!isNaN(n)) return n;
          return s;
        };
        rawData.sort((a, b) => {
          const ka = toSortKey(a[sortCol]);
          const kb = toSortKey(b[sortCol]);
          if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
          return String(ka).localeCompare(String(kb));
        });
        this.logger.debug('Sort applied:', { column: sortCol, records: rawData.length });
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

      // Apply Changes: consecutive deduplication (keep only rows where track columns change per group)
      let recordsChangesRemoved = 0;
      if (definition.changes) {
        const { group, track } = definition.changes;
        const lastTrack = new Map(); // groupKey → trackValue
        const beforeCount = rawData.length;
        rawData = rawData.filter(row => {
          const groupKey = group.map(c => String(row[c] ?? '')).join('\0');
          const trackValue = track.map(c => String(row[c] ?? '')).join('\0');
          const prev = lastTrack.get(groupKey);
          lastTrack.set(groupKey, trackValue);
          if (prev === trackValue) return false; // same as last → remove
          return true; // first occurrence or changed → keep
        });
        recordsChangesRemoved = beforeCount - rawData.length;
        this.logger.debug('Changes dedup applied:', { group, track, removed: recordsChangesRemoved, remaining: rawData.length });
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
            // Apply transform if specified (pass row for row-aware transforms like concat)
            if (transform) {
              value = this.applyTransform(value, transform, row);
            }
            mapped[targetCol] = value;
          }
        }
        return mapped;
      });

      // Apply filter
      const filterFn = this.parseFilter(definition.filter);
      let filteredData = mappedData.filter(row => {
        try {
          return filterFn(row);
        } catch (e) {
          this.logger.warn('Filter error for row:', { row, error: e.message });
          return false;
        }
      });

      const recordsFiltered = recordsRead - filteredData.length;

      // Limit was already applied early (before source edit)

      const recordsWritten = filteredData.length;

      // Write JSON to import directory
      const outputPath = path.join(this.importDir, `${entityName}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));

      return {
        success: true,
        recordsRead,
        recordsSourceFiltered,
        recordsDeduplicated,
        recordsChangesRemoved,
        recordsFiltered,
        recordsLimited,
        recordsWritten,
        outputFile: `import/${entityName}.json`
      };
    } catch (e) {
      this.logger.error('Import error:', { error: e.message });
      return { success: false, error: e.message };
    }
  }
  /**
   * Parse a refresh import definition (docs/imports/Entity.refreshName.md)
   * @param {string} entityName - Entity name
   * @param {string} refreshName - Refresh name (e.g., "tracker")
   * @returns {Object|null} - Parsed definition with match config
   */
  parseRefreshDefinition(entityName, refreshName) {
    const defName = `${entityName}.${refreshName}`;
    const definition = this.parseImportDefinition(defName);

    if (!definition) {
      return null;
    }

    if (!definition.match) {
      this.logger.warn(`Refresh definition ${defName} has no Match: directive`);
      return null;
    }

    return definition;
  }

  /**
   * Run an API refresh: fetch data from API, apply mapping, return mapped records + match config
   * Does NOT write to DB — that's done by SeedManager.refreshEntity()
   *
   * @param {string} entityName - Entity name
   * @param {string} refreshName - Refresh name (e.g., "tracker")
   * @returns {Promise<Object>} - { records, match, recordsRead, error }
   */
  async runRefresh(entityName, refreshName) {
    const definition = this.parseRefreshDefinition(entityName, refreshName);

    if (!definition) {
      return { records: null, error: `No refresh definition found for ${entityName}.${refreshName}` };
    }

    if (!definition.source) {
      return { records: null, error: 'No source URL specified in refresh definition' };
    }

    try {
      // Load data from API
      const { rawData, error: loadError } = await this.loadFromApi(definition);
      if (!rawData) {
        return { records: null, error: loadError };
      }

      const recordsRead = rawData.length;

      // Apply mapping with transforms
      const mappedRecords = rawData.map(row => {
        const mapped = {};
        // Always include the API match field (so SeedManager can match)
        mapped[definition.match.apiField] = row[definition.match.apiField];

        for (const { source: sourceExprStr, target: targetCol, transform } of definition.mapping) {
          const sourceExpr = this.parseSourceExpression(sourceExprStr);
          let value = this.resolveSourceValue(sourceExpr, row);

          if (value !== undefined) {
            if (transform) {
              value = this.applyTransform(value, transform, row);
            }
            mapped[targetCol] = value;
          }
        }
        return mapped;
      });

      return {
        records: mappedRecords,
        match: definition.match,
        recordsRead
      };
    } catch (e) {
      this.logger.error('Refresh error:', { error: e.message });
      return { records: null, error: e.message };
    }
  }
}

module.exports = ImportManager;
