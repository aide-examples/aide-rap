/**
 * SchemaGenerator - Parse DataModel.md and generate SQL schema + validation rules
 *
 * Single source of truth for the metamodel. Generates:
 * - SQL DDL for table creation
 * - Validation rules for ObjectValidator
 * - Foreign key relationships
 * - UNIQUE constraints and indexes
 * - Area mappings for UI
 */

const fs = require('fs');
const path = require('path');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const { TypeParser } = require('../../shared/types/TypeParser');

// Shared TypeParser instance for extracting type names from markdown links
const typeParserInstance = new TypeParser();

/**
 * Parse the Areas from Entity Descriptions section in DataModel.md.
 * Format: ### AreaName followed by <div style="background-color: #COLOR"> and entity table
 * @param {string} mdContent - Markdown content
 * @returns {Object} - { areas: {}, classToArea: {} }
 */
function parseAreasFromTable(mdContent) {
  const areas = {};
  const classToArea = {};

  // Match ### AreaName followed by <div style="background-color: #COLOR"> and entity table
  const areaPattern = /###\s+([^\n]+)\n<div[^>]*style="[^"]*background-color:\s*(#[0-9A-Fa-f]{6})[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let match;

  while ((match = areaPattern.exec(mdContent)) !== null) {
    const areaName = match[1].trim();
    const color = match[2];
    const tableContent = match[3];

    const areaKey = areaName.toLowerCase().replace(/ /g, '_').replace(/&/g, 'and');

    areas[areaKey] = {
      name: areaName,
      color: color
    };

    // Extract entity names from table rows
    // Supports both: [EntityName](classes/EntityName.md) and plain EntityName
    const tableRows = tableContent.match(/\|\s*([^|]+)\s*\|[^|]+\|/g) || [];
    for (const row of tableRows) {
      // Skip header row
      if (row.includes('Entity') && row.includes('Description')) continue;
      if (row.includes('---')) continue;

      const cellMatch = row.match(/\|\s*([^|]+)\s*\|/);
      if (cellMatch) {
        let entityName = cellMatch[1].trim();
        // Handle markdown link format: [EntityName](classes/EntityName.md)
        const linkMatch = entityName.match(/\[([^\]]+)\]/);
        if (linkMatch) {
          entityName = linkMatch[1].trim();
        }
        // Only accept PascalCase names (entity names)
        if (entityName && /^[A-Z][a-zA-Z0-9]*$/.test(entityName)) {
          classToArea[entityName] = areaKey;
        }
      }
    }
  }

  return { areas, classToArea };
}

/**
 * Extract type name from potential markdown link
 * e.g., "[TailSign](../Types.md#tailsign)" -> "TailSign"
 */
function extractTypeName(typeStr) {
  return typeParserInstance.extractTypeName(typeStr);
}

/**
 * Built-in type mapping from DataModel.md to SQLite and JS
 * Custom types from TypeRegistry take precedence
 */
const TYPE_MAP = {
  int: { sqlType: 'INTEGER', jsType: 'number', validation: { type: 'number' } },
  string: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string' } },
  date: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  bool: { sqlType: 'INTEGER', jsType: 'boolean', validation: { type: 'boolean' } },
  boolean: { sqlType: 'INTEGER', jsType: 'boolean', validation: { type: 'boolean' } }
};

/**
 * System columns added to ALL entities automatically.
 * These are NOT defined in DataModel.md — they're infrastructure columns.
 * - created_at: Timestamp when record was created
 * - updated_at: Timestamp of last modification
 * - version: OCC version counter (starts at 1, incremented on update)
 */
const SYSTEM_COLUMNS = [
  {
    name: 'created_at',
    type: 'string',
    sqlType: "TEXT DEFAULT (datetime('now'))",
    jsType: 'string',
    required: false,
    system: true,
    ui: { readonly: true }
  },
  {
    name: 'updated_at',
    type: 'string',
    sqlType: "TEXT DEFAULT (datetime('now'))",
    jsType: 'string',
    required: false,
    system: true,
    ui: { readonly: true }
  },
  {
    name: 'version',
    type: 'int',
    sqlType: 'INTEGER DEFAULT 1',
    jsType: 'number',
    required: false,
    system: true,
    ui: { readonly: true }
  }
];

/**
 * Convert PascalCase to snake_case
 */
function toSnakeCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Parse constraint annotations from description
 * Supported: [UNIQUE], [UK1], [UK2], [INDEX], [IX1], [IX2]
 */
function parseConstraints(description) {
  const constraints = {
    unique: false,
    uniqueKey: null,
    index: false,
    indexKey: null
  };

  // Match [UNIQUE]
  if (/\[UNIQUE\]/i.test(description)) {
    constraints.unique = true;
  }

  // Match [UK1], [UK2], etc.
  const ukMatch = description.match(/\[UK(\d+)\]/i);
  if (ukMatch) {
    constraints.uniqueKey = `UK${ukMatch[1]}`;
  }

  // Match [INDEX]
  if (/\[INDEX\]/i.test(description)) {
    constraints.index = true;
  }

  // Match [IX1], [IX2], etc.
  const ixMatch = description.match(/\[IX(\d+)\]/i);
  if (ixMatch) {
    constraints.indexKey = `IX${ixMatch[1]}`;
  }

  return constraints;
}

/**
 * Parse UI annotations from description
 * Supported: [LABEL], [LABEL2], [READONLY], [HIDDEN]
 */
function parseUIAnnotations(description) {
  const ui = {};

  if (/\[LABEL\]/i.test(description)) {
    ui.label = true;
  }
  if (/\[LABEL2\]/i.test(description)) {
    ui.label2 = true;
  }
  if (/\[READONLY\]/i.test(description)) {
    ui.readonly = true;
  }
  if (/\[HIDDEN\]/i.test(description)) {
    ui.hidden = true;
  }

  return Object.keys(ui).length > 0 ? ui : null;
}

/**
 * Parse media constraints from description
 * Supported:
 *   [SIZE=50MB] or [MAXSIZE=50MB] - file size limit (B, KB, MB, GB)
 *   [DIMENSION=800x600] - max image dimensions (width x height)
 *   [MAXWIDTH=800] - max image width
 *   [MAXHEIGHT=600] - max image height
 *   [DURATION=5min] - max duration for audio/video (sec, min, h)
 *
 * Images exceeding dimensions are scaled down preserving aspect ratio.
 */
function parseMediaAnnotations(description) {
  const media = {};

  // Parse [SIZE=50MB] or [MAXSIZE=50MB]
  const sizeMatch = description.match(/\[(?:MAX)?SIZE=(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?\]/i);
  if (sizeMatch) {
    const num = parseFloat(sizeMatch[1]);
    const unit = (sizeMatch[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    media.maxSize = Math.floor(num * (multipliers[unit] || 1));
  }

  // Parse [DIMENSION=800x600]
  const dimMatch = description.match(/\[DIMENSION=(\d+)x(\d+)\]/i);
  if (dimMatch) {
    media.maxWidth = parseInt(dimMatch[1], 10);
    media.maxHeight = parseInt(dimMatch[2], 10);
  }

  // Parse [MAXWIDTH=800]
  const widthMatch = description.match(/\[MAXWIDTH=(\d+)\]/i);
  if (widthMatch) {
    media.maxWidth = parseInt(widthMatch[1], 10);
  }

  // Parse [MAXHEIGHT=600]
  const heightMatch = description.match(/\[MAXHEIGHT=(\d+)\]/i);
  if (heightMatch) {
    media.maxHeight = parseInt(heightMatch[1], 10);
  }

  // Parse [DURATION=5min]
  const durMatch = description.match(/\[(?:MAX)?DURATION=(\d+(?:\.\d+)?)\s*(sec|min|h)?\]/i);
  if (durMatch) {
    const num = parseFloat(durMatch[1]);
    const unit = (durMatch[2] || 'sec').toLowerCase();
    const multipliers = { sec: 1, min: 60, h: 3600 };
    media.maxDuration = Math.floor(num * (multipliers[unit] || 1));
  }

  return Object.keys(media).length > 0 ? media : null;
}

/**
 * Parse computed field annotation from description
 * Supported: [DAILY=Entity[condition].field], [IMMEDIATE=...], [HOURLY=...], [ON_DEMAND=...]
 *
 * Condition can be:
 * - Boolean expression: exit_date=null OR exit_date>TODAY
 * - Aggregate function: MAX(end_date), MIN(start_date)
 *
 * Examples:
 * - [DAILY=Registration[exit_date=null OR exit_date>TODAY].operator]
 * - [DAILY=EngineAllocation[MAX(end_date)].aircraft]
 *
 * Returns: { schedule, sourceEntity, condition, targetField, aggregate?, aggregateField? }
 */
function parseComputedAnnotation(description) {
  // Match [SCHEDULE=Entity[condition].field]
  const match = description.match(/\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND|ONCHANGE)=(\w+)\[([^\]]+)\]\.(\w+)\]/i);
  if (!match) {
    return null;
  }

  const condition = match[3];
  const result = {
    schedule: match[1].toUpperCase(),
    sourceEntity: match[2],
    condition,
    targetField: match[4]
  };

  // Check for aggregate function: MAX(field) or MIN(field)
  const aggMatch = condition.match(/^(MAX|MIN)\((\w+)\)$/i);
  if (aggMatch) {
    result.aggregate = aggMatch[1].toUpperCase();
    result.aggregateField = aggMatch[2];
    result.condition = null; // No WHERE condition, just ORDER BY
  }

  return result;
}

/**
 * Parse [CALCULATED] annotation from description
 * Returns true if the field is a calculated field (client-side)
 */
function parseCalculatedAnnotation(description) {
  return /\[CALCULATED\]/i.test(description);
}

/**
 * Parse ## Calculations section from entity markdown content
 * Looks for ### fieldName subsections with:
 *   - **Depends on:** field1, field2  (required fields for calculation)
 *   - **Sort:** field1, field2        (required sort order)
 *   - ```js ... ```                   (calculation code)
 *
 * Returns: { fieldName: { code, depends: [...], sort: [...] }, ... }
 */
function parseCalculationsSection(fileContent) {
  const result = {};
  const lines = fileContent.split('\n');
  let inCalcSection = false;
  let currentField = null;
  let currentCalc = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect ## Calculations section
    if (trimmed === '## Calculations') {
      inCalcSection = true;
      continue;
    }

    // Exit on another ## section
    if (inCalcSection && trimmed.startsWith('## ') && trimmed !== '## Calculations') {
      break;
    }

    if (!inCalcSection) continue;

    // Detect ### fieldName subsection
    if (trimmed.startsWith('### ')) {
      // Save previous calculation if any
      if (currentField && currentCalc) {
        result[currentField] = currentCalc;
      }
      currentField = trimmed.substring(4).trim();
      currentCalc = { code: '', depends: [], sort: [] };
      continue;
    }

    if (!currentField) continue;

    // Parse **Depends on:** field1, field2
    const dependsMatch = trimmed.match(/^\*\*Depends on:\*\*\s*(.+)$/i);
    if (dependsMatch) {
      currentCalc.depends = dependsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }

    // Parse **Sort:** field1, field2
    const sortMatch = trimmed.match(/^\*\*Sort:\*\*\s*(.+)$/i);
    if (sortMatch) {
      currentCalc.sort = sortMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }

    // Parse ```js code block
    if (trimmed === '```js') {
      const jsLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        jsLines.push(lines[i]);
        i++;
      }
      currentCalc.code = jsLines.join('\n').trim();
    }
  }

  // Save last calculation
  if (currentField && currentCalc) {
    result[currentField] = currentCalc;
  }

  return result;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extract type annotations from type string
 * Supported: [DEFAULT=x], [OPTIONAL]
 * Note: [DEFAULT=x] implies [OPTIONAL] - if there's a default, the field is not required
 *
 * e.g., "MaintenanceCategory [DEFAULT=A]" -> { type: "MaintenanceCategory", default: "A", optional: true }
 * e.g., "EngineType [OPTIONAL]" -> { type: "EngineType", default: null, optional: true }
 * e.g., "int" -> { type: "int", default: null, optional: false }
 */
function extractTypeAnnotations(typeStr) {
  let type = typeStr;
  let defaultValue = null;
  let optional = false;

  const defaultMatch = type.match(/\[DEFAULT=([^\]]+)\]/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].trim();
    type = type.replace(/\s*\[DEFAULT=[^\]]+\]/i, '').trim();
    optional = true;  // DEFAULT implies OPTIONAL
  }

  if (/\[OPTIONAL\]/i.test(type)) {
    optional = true;
    type = type.replace(/\s*\[OPTIONAL\]/i, '').trim();
  }

  return { type, default: defaultValue, optional };
}

/**
 * Parse a single entity markdown file
 * Format: | Attribute | Type | Description | Example |
 *
 * The Type column can include annotations:
 *   | maintenance_category | MaintenanceCategory [DEFAULT=A] | Current category | B |
 *   | engine_type | EngineType [OPTIONAL] | Reference | 10 |
 */
function parseEntityFile(fileContent) {
  const lines = fileContent.split('\n');

  // First line should be # EntityName
  const nameMatch = lines[0].match(/^#\s+(\w+)/);
  if (!nameMatch) {
    return null;
  }

  const className = nameMatch[1];
  let description = '';
  const attributes = [];

  // Parse entity-local types and register them
  let localTypes = {};
  const typesSection = typeParserInstance._extractTypesSection(fileContent);
  if (typesSection) {
    localTypes = typeParserInstance._parseTypesContent(typesSection, `entity:${className}`);
    // Types are automatically registered in TypeRegistry by _parseTypesContent
  }

  // Find description (text before the first ## section or table)
  let i = 1;
  while (i < lines.length && !lines[i].startsWith('|') && !lines[i].startsWith('## ')) {
    if (lines[i].trim()) {
      description = lines[i].trim();
    }
    i++;
  }

  // Find the Attributes table - could be directly after description or after ## Attributes
  let inAttributeSection = false;
  let inTable = false;

  for (; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track which section we're in
    if (line === '## Attributes') {
      inAttributeSection = true;
      continue;
    }
    if (line.startsWith('## ') && line !== '## Attributes') {
      // Another section - if we were in Attributes, we're done
      if (inAttributeSection || inTable) break;
      continue;
    }

    // Look for attribute table header
    if (line.startsWith('|') && line.includes('Attribute') && line.includes('Type')) {
      inTable = true;
      continue;
    }

    // Skip separator line
    if (line.startsWith('|') && line.includes('---')) {
      continue;
    }

    // Parse data rows: | Attribute | Type | Description | Example |
    if (inTable && line.startsWith('|')) {
      const parts = line.split('|').slice(1, -1).map(p => p.trim());

      if (parts.length >= 3) {
        // Extract type name and annotations from Type column
        const typeInfo = extractTypeAnnotations(parts[1]);

        // Fallback: extract [DEFAULT=x] from Description column if not in Type column
        let explicitDefault = typeInfo.default;
        let desc = parts[2];
        if (!explicitDefault) {
          const descDefaultMatch = desc.match(/\[DEFAULT=([^\]]+)\]/i);
          if (descDefaultMatch) {
            explicitDefault = descDefaultMatch[1].trim();
            desc = desc.replace(/\s*\[DEFAULT=[^\]]+\]/i, '').trim();
          }
        }

        const attr = {
          name: parts[0],
          type: extractTypeName(typeInfo.type),
          explicitDefault,
          description: desc
        };
        if (typeInfo.optional) attr.optional = true;
        if (parts.length >= 4) {
          attr.example = parts[3];
        }
        attributes.push(attr);
      }
    }
  }

  // Parse ## Calculations section for [CALCULATED] fields
  const calculations = parseCalculationsSection(fileContent);

  return {
    className,
    description,
    attributes,
    calculations,
    localTypes
  };
}

/**
 * Extract classes and attributes from classes/ directory
 * Falls back to parsing Entity Descriptions section in DataModel.md for compatibility
 */
function parseEntityDescriptions(mdContent, mdPath) {
  const classes = {};

  // Try to read from classes/ directory first
  if (mdPath) {
    const classesDir = path.join(path.dirname(mdPath), 'classes');
    if (fs.existsSync(classesDir)) {
      const entityFiles = fs.readdirSync(classesDir).filter(f => f.endsWith('.md'));

      for (const file of entityFiles) {
        const filePath = path.join(classesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseEntityFile(content);

        if (parsed) {
          classes[parsed.className] = {
            description: parsed.description,
            attributes: parsed.attributes,
            calculations: parsed.calculations,
            localTypes: parsed.localTypes
          };
        }
      }

      if (Object.keys(classes).length > 0) {
        return classes;
      }
    }
  }

  // Fallback: parse from Entity Descriptions section in DataModel.md
  const entityMatch = mdContent.match(/## Entity Descriptions\s*\n([\s\S]*?)(?=\n## |\Z|$)/);
  if (!entityMatch) {
    return {};
  }

  let content = entityMatch[1];

  if (content.startsWith('### ')) {
    content = '\n' + content;
  }
  const classBlocks = content.split(/\n### /);

  for (const block of classBlocks.slice(1)) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    const className = lines[0].trim();
    let description = '';
    const attributes = [];

    // Find description (text before the table)
    let i = 1;
    while (i < lines.length && !lines[i].startsWith('|')) {
      if (lines[i].trim()) {
        description = lines[i].trim();
      }
      i++;
    }

    // Parse attribute table (now with 4 columns)
    let inTable = false;
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && !line.includes('---')) {
        if (line.includes('Attribute') && line.includes('Type')) {
          inTable = true;
          continue;
        }
        if (inTable) {
          // Parse table row: | name | type | description | example |
          const parts = line.split('|').slice(1, -1).map(p => p.trim());
          if (parts.length >= 3) {
            const attr = {
              name: parts[0],
              type: extractTypeName(parts[1]),
              description: parts[2]
            };
            // Example column (4th) - null means optional
            if (parts.length >= 4) {
              attr.example = parts[3];
            }
            attributes.push(attr);
          }
        }
      }
    }

    classes[className] = {
      description: description,
      attributes: attributes
    };
  }

  return classes;
}

/**
 * Parse a default value string to the appropriate JS type
 */
function parseDefaultValue(value, jsType) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  switch (jsType) {
    case 'number':
      const num = parseInt(value, 10);
      return isNaN(num) ? null : num;
    case 'boolean':
      return value === 'true' || value === '1' ? 1 : 0;
    default:
      return String(value);
  }
}

/**
 * Map external enum value to internal value
 * e.g., "Line" -> "A", "Open" -> 1
 */
function mapExternalToInternal(externalValue, typeDef) {
  if (!typeDef?.kind === 'enum' || !typeDef.values) {
    return externalValue;
  }

  // Try to find matching external value (case-insensitive)
  const match = typeDef.values.find(v =>
    String(v.external).toLowerCase() === String(externalValue).toLowerCase()
  );

  if (match) {
    return match.internal;
  }

  // If no match, check if it's already an internal value
  const internalMatch = typeDef.values.find(v =>
    String(v.internal).toLowerCase() === String(externalValue).toLowerCase()
  );

  return internalMatch ? internalMatch.internal : externalValue;
}

/**
 * Get default value for a column based on:
 * 1. Explicit default from markdown (highest priority) - uses EXTERNAL enum representation
 * 2. Type-specific default (enum: first value, pattern: example)
 * 3. Built-in type default (number: 0, string: '', date: CURRENT_DATE)
 *
 * @param {Object} attr - Attribute definition with explicitDefault
 * @param {string} jsType - JavaScript type (number, string, boolean)
 * @param {Object} typeDef - Type definition from TypeRegistry (or null)
 * @returns {*} - Default value or null
 */
function getDefaultValue(attr, jsType, typeDef) {
  // 1. Explicit default from markdown [DEFAULT=x] annotation
  if (attr.explicitDefault !== null && attr.explicitDefault !== '') {
    // For enums, map external value to internal
    if (typeDef?.kind === 'enum') {
      return mapExternalToInternal(attr.explicitDefault, typeDef);
    }
    return parseDefaultValue(attr.explicitDefault, jsType);
  }

  // 2. Type-specific defaults
  if (typeDef?.kind === 'enum' && typeDef.values?.length > 0) {
    return typeDef.values[0].internal; // First enum value
  }

  if (typeDef?.kind === 'pattern') {
    return typeDef.example || ''; // Use type example or empty
  }

  // 3. Built-in type defaults
  switch (jsType) {
    case 'number':
      return 0;
    case 'boolean':
      return 0;
    case 'string':
      // Date fields get SQLite's CURRENT_DATE function
      if (attr.name && attr.name.toLowerCase().includes('date')) {
        return 'CURRENT_DATE';
      }
      return '';
    default:
      return null;
  }
}

/**
 * Get type info from TypeRegistry or fall back to TYPE_MAP
 * @param {string} typeName - Type name from attribute definition
 * @param {string} entityName - Entity name for local type resolution
 * @returns {Object} - { sqlType, jsType, validation, isCustomType, typeDef }
 */
function getTypeInfo(typeName, entityName) {
  const typeRegistry = getTypeRegistry();
  const lowerType = typeName.toLowerCase();

  // Check built-in types first (exact match)
  if (TYPE_MAP[lowerType]) {
    return {
      ...TYPE_MAP[lowerType],
      isCustomType: false,
      typeDef: null
    };
  }

  // Try to resolve from TypeRegistry (case-sensitive for custom types)
  const typeDef = typeRegistry.resolve(typeName, entityName);
  if (typeDef) {
    const sqlType = typeRegistry.getSqlType(typeName, entityName);
    const validation = typeRegistry.toValidationRules(typeName, entityName);

    return {
      sqlType,
      jsType: typeDef.kind === 'enum' ? 'number' : 'string',
      validation: validation || { type: 'string' },
      isCustomType: true,
      typeDef
    };
  }

  // Fall back to string type
  return {
    ...TYPE_MAP.string,
    isCustomType: false,
    typeDef: null
  };
}

/**
 * Generate schema for a single entity
 * @param {string} className - Entity name
 * @param {object} classDef - Class definition from markdown
 * @param {string[]} allEntityNames - All known entity names (for FK detection via type)
 */
function generateEntitySchema(className, classDef, allEntityNames = []) {
  const tableName = toSnakeCase(className);
  const columns = [];
  const validationRules = {};
  const uniqueKeys = {};  // UK1 -> [columns]
  const indexes = {};     // IX1 -> [columns]
  const foreignKeys = [];
  const enumFields = {};  // Fields that are enums (for response enrichment)

  for (const attr of classDef.attributes || []) {
    let name = attr.name;
    const attrType = attr.type;
    const desc = attr.description || '';
    const example = attr.example || '';

    // Determine if required (example is not 'null' and not marked [OPTIONAL])
    const isRequired = example.toLowerCase() !== 'null' && name !== 'id' && !attr.optional;

    // Parse constraints from description
    const constraints = parseConstraints(desc);

    // Detect foreign key: Check if type is an entity name (conceptual notation)
    // e.g., "type: AircraftType" means FK to AircraftType
    let foreignKey = null;
    let displayName = null;  // Conceptual name for UI/diagrams

    const cleanType = extractTypeName(attrType);
    const typeRegistry = getTypeRegistry();

    // Check if type is an aggregate (expands to multiple columns)
    if (typeRegistry.isAggregate(cleanType)) {
      const aggregateFields = typeRegistry.getAggregateFields(cleanType);
      const uiAnnotations = parseUIAnnotations(desc);

      // Create a column for each field in the aggregate with prefix
      for (const field of aggregateFields) {
        const colName = `${name}_${field.name}`;
        let sqlType = field.sqlType;

        // Aggregate fields are optional unless explicitly marked required
        // (we don't add NOT NULL by default)

        const column = {
          name: colName,
          type: field.type,
          sqlType,
          jsType: field.type,
          required: false,  // Aggregate sub-fields are optional by default
          customType: null,
          defaultValue: null,
          description: `${name}: ${field.name}`,
          aggregateType: cleanType,       // Mark as part of an aggregate
          aggregateField: field.name,     // Which field within the aggregate
          aggregateSource: name           // Original attribute name from markdown
        };

        // Copy UI annotations from parent to sub-fields (e.g., [HIDDEN])
        if (uiAnnotations) {
          column.ui = { ...uiAnnotations };
        }

        columns.push(column);

        // Add validation rules for each sub-field
        validationRules[colName] = { type: field.type === 'number' ? 'number' : 'string' };
      }

      // Skip normal column creation for aggregate types
      continue;
    }

    if (allEntityNames.includes(cleanType)) {
      // Conceptual FK notation: type is entity name
      // e.g., "type: AircraftType" -> column: type_id, displayName: type
      displayName = name;  // Keep conceptual name for display
      name = name + '_id';  // DB column name with _id suffix
      foreignKey = {
        table: toSnakeCase(cleanType),
        column: 'id',
        entity: cleanType
      };
      foreignKeys.push({
        column: name,
        displayName: displayName,
        references: foreignKey
      });
    }

    // Get type info (from TypeRegistry or TYPE_MAP)
    // For conceptual FKs (type is entity name), use int type
    const effectiveType = displayName ? 'int' : attrType;
    const typeInfo = getTypeInfo(effectiveType, className);

    // Track enum fields for response enrichment
    if (typeInfo.isCustomType && typeInfo.typeDef?.kind === 'enum') {
      enumFields[name] = {
        typeName: attrType,
        values: typeInfo.typeDef.values
      };
    }

    // Build SQL type
    let sqlType = typeInfo.sqlType;
    if (name === 'id') {
      sqlType = 'INTEGER PRIMARY KEY';
    } else if (isRequired && !foreignKey) {
      sqlType += ' NOT NULL';
    }

    // Add DEFAULT clause if explicit default is specified
    if (attr.explicitDefault !== null && attr.explicitDefault !== '' && name !== 'id') {
      // Format default value based on type
      if (typeInfo.jsType === 'boolean') {
        // Convert true/false to 1/0 for SQLite
        const boolVal = attr.explicitDefault.toLowerCase() === 'true' ? 1 : 0;
        sqlType += ` DEFAULT ${boolVal}`;
      } else if (typeInfo.jsType === 'number') {
        sqlType += ` DEFAULT ${attr.explicitDefault}`;
      } else {
        // String/text values need quotes
        sqlType += ` DEFAULT '${attr.explicitDefault.replace(/'/g, "''")}'`;
      }
    }

    // Parse UI annotations
    const uiAnnotations = parseUIAnnotations(desc);

    // Parse media constraints (for media type fields)
    const mediaConstraints = parseMediaAnnotations(desc);

    // Parse computed field annotation (DAILY, IMMEDIATE, etc.)
    const computedRule = parseComputedAnnotation(desc);

    // Parse [CALCULATED] annotation for client-side calculated fields
    const isCalculated = parseCalculatedAnnotation(desc);
    const calculatedDef = isCalculated && classDef.calculations?.[name]
      ? classDef.calculations[name]
      : null;

    // Calculate default value (skip for id and foreign keys)
    let defaultValue = null;
    if (name !== 'id' && !foreignKey) {
      defaultValue = getDefaultValue(attr, typeInfo.jsType, typeInfo.typeDef);
    }

    // Build column definition
    const column = {
      name,
      type: attrType,  // Original type from markdown (e.g., 'string', 'int', 'AircraftOEM')
      sqlType,
      jsType: typeInfo.jsType,
      required: isRequired,
      customType: typeInfo.isCustomType ? attrType : null,
      defaultValue,
      description: desc || null,  // Store description for schema tracking
      // Explicit default from [DEFAULT=x] annotation (vs type-level defaults)
      explicitDefault: attr.explicitDefault || null
    };

    // Add displayName for conceptual FK notation (for UI/diagrams)
    if (displayName) {
      column.displayName = displayName;
    }

    if (foreignKey) {
      column.foreignKey = foreignKey;
    }

    if (constraints.unique) {
      column.unique = true;
    }

    if (uiAnnotations) {
      column.ui = uiAnnotations;
    }

    // Preserve optional flag from [OPTIONAL] annotation in Type column
    if (attr.optional) {
      column.optional = true;
    }

    if (computedRule) {
      column.computed = computedRule;
    }

    if (calculatedDef) {
      column.calculated = calculatedDef;
    }

    // Add media constraints for media type fields
    if (mediaConstraints) {
      column.media = mediaConstraints;
    }

    columns.push(column);

    // Build validation rules (skip 'id' - auto-generated)
    if (name !== 'id') {
      const rules = { ...typeInfo.validation };
      if (isRequired) {
        rules.required = true;
      }
      validationRules[name] = rules;
    }

    // Collect composite unique keys
    if (constraints.uniqueKey) {
      if (!uniqueKeys[constraints.uniqueKey]) {
        uniqueKeys[constraints.uniqueKey] = [];
      }
      uniqueKeys[constraints.uniqueKey].push(name);
    }

    // Collect composite indexes
    if (constraints.indexKey) {
      if (!indexes[constraints.indexKey]) {
        indexes[constraints.indexKey] = [];
      }
      indexes[constraints.indexKey].push(name);
    }

    // Single-column index
    if (constraints.index) {
      indexes[`idx_${tableName}_${name}`] = [name];
    }
  }

  // Extract entity-level labelFields from column UI annotations
  const labelCol = columns.find(c => c.ui?.label);
  const label2Col = columns.find(c => c.ui?.label2);
  const entityUI = {
    labelFields: {
      primary: labelCol?.name || null,
      secondary: label2Col?.name || null
    }
  };

  // Add system columns (timestamps + version) after user-defined columns
  for (const sysCol of SYSTEM_COLUMNS) {
    columns.push({ ...sysCol });
  }

  return {
    className,
    tableName,
    description: classDef.description,
    area: classDef.area || 'unknown',
    columns,
    validationRules,
    uniqueKeys,
    indexes,
    foreignKeys,
    enumFields,
    ui: entityUI,
    localTypes: classDef.localTypes || {}
  };
}

/**
 * Enrich FK metadata with labelFields from target entity
 * This enables Views to generate label columns for FK references
 *
 * @param {Object} entities - All parsed entity schemas
 */
function enrichFKsWithLabelFields(entities) {
  for (const entity of Object.values(entities)) {
    for (const fk of entity.foreignKeys) {
      const targetEntity = entities[fk.references.entity];
      if (targetEntity) {
        // Find LABEL and LABEL2 columns in target entity
        const labelCol = targetEntity.columns.find(c => c.ui?.label);
        const label2Col = targetEntity.columns.find(c => c.ui?.label2);

        fk.labelFields = {
          primary: labelCol?.name || null,
          secondary: label2Col?.name || null
        };
      }
    }
  }
}

/**
 * Build dependency graph for topological sort (FK ordering)
 */
function buildDependencyOrder(entities) {
  const entityMap = {};
  for (const entity of Object.values(entities)) {
    entityMap[entity.className] = entity;
  }

  // Build adjacency list (entity -> dependencies)
  // Skip self-references (e.g., super_type -> same entity) to avoid deadlock
  const deps = {};
  for (const entity of Object.values(entities)) {
    deps[entity.className] = [];
    for (const fk of entity.foreignKeys) {
      if (fk.references.entity !== entity.className) {
        deps[entity.className].push(fk.references.entity);
      }
    }
  }

  // Topological sort using Kahn's algorithm
  const inDegree = {};
  for (const name of Object.keys(deps)) {
    inDegree[name] = 0;
  }
  for (const name of Object.keys(deps)) {
    for (const dep of deps[name]) {
      if (inDegree[dep] !== undefined) {
        inDegree[name]++;
      }
    }
  }

  const queue = [];
  for (const name of Object.keys(inDegree)) {
    if (inDegree[name] === 0) {
      queue.push(name);
    }
  }

  const sorted = [];
  while (queue.length > 0) {
    const node = queue.shift();
    sorted.push(node);

    for (const [name, dependencies] of Object.entries(deps)) {
      // Count how many times this node appears in dependencies (e.g., ExchangeRate has Currency twice)
      const count = dependencies.filter(d => d === node).length;
      if (count > 0) {
        inDegree[name] -= count;
        if (inDegree[name] === 0 && !sorted.includes(name)) {
          queue.push(name);
        }
      }
    }
  }

  // Return in dependency order
  return sorted.map(name => entityMap[name]).filter(Boolean);
}

/**
 * Generate SQL for creating a View with FK label columns
 * The View joins the base table with FK target tables to include readable labels
 *
 * @param {Object} entity - Entity schema with foreignKeys and labelFields
 * @returns {string|null} - SQL CREATE VIEW statement or null if no FKs with labels
 */
function generateViewSQL(entity) {
  const baseTable = entity.tableName;
  // Use first letter as alias, but ensure uniqueness by appending number if needed
  const baseAlias = 'b';

  const selects = [`${baseAlias}.*`];
  const joins = [];
  let joinAliasCounter = 0;

  for (const fk of entity.foreignKeys) {
    // Skip FKs without labelFields
    if (!fk.labelFields?.primary) continue;

    const joinAlias = `fk${joinAliasCounter++}`;
    const targetTable = fk.references.table;
    const labelFieldName = fk.displayName + '_label';

    // Build label expression: primary or "primary (secondary)"
    const { primary, secondary } = fk.labelFields;
    const labelExpr = secondary
      ? `${joinAlias}.${primary} || ' (' || ${joinAlias}.${secondary} || ')'`
      : `${joinAlias}.${primary}`;

    selects.push(`${labelExpr} AS ${labelFieldName}`);
    joins.push(`LEFT JOIN ${targetTable} ${joinAlias} ON ${baseAlias}.${fk.column} = ${joinAlias}.id`);
  }

  // If no FK labels to add, still create view for consistency
  // This ensures all entities can be queried via {table}_view

  const joinClause = joins.length > 0 ? '\n' + joins.join('\n') : '';

  return `CREATE VIEW IF NOT EXISTS ${baseTable}_view AS
SELECT ${selects.join(',\n       ')}
FROM ${baseTable} ${baseAlias}${joinClause}`;
}

/**
 * Generate SQL DDL for creating a table
 */
function generateCreateTableSQL(entity) {
  const lines = [`CREATE TABLE IF NOT EXISTS ${entity.tableName} (`];
  const columnDefs = [];
  const constraints = [];

  // Always add implicit id column first (if not explicitly defined)
  const hasExplicitId = entity.columns.some(c => c.name === 'id');
  if (!hasExplicitId) {
    columnDefs.push('  id INTEGER PRIMARY KEY');
  }

  for (const col of entity.columns) {
    let def = `  ${col.name} ${col.sqlType}`;
    if (col.unique) {
      def += ' UNIQUE';
    }
    columnDefs.push(def);
  }

  // Foreign keys
  for (const fk of entity.foreignKeys) {
    constraints.push(`  FOREIGN KEY (${fk.column}) REFERENCES ${fk.references.table}(${fk.references.column})`);
  }

  // Composite unique keys
  for (const [keyName, columns] of Object.entries(entity.uniqueKeys)) {
    constraints.push(`  CONSTRAINT ${keyName.toLowerCase()}_${entity.tableName} UNIQUE (${columns.join(', ')})`);
  }

  lines.push(columnDefs.concat(constraints).join(',\n'));
  lines.push(');');

  // Indexes (separate statements)
  const indexStatements = [];
  for (const [indexName, columns] of Object.entries(entity.indexes)) {
    const name = indexName.startsWith('idx_') ? indexName : `${indexName.toLowerCase()}_${entity.tableName}`;
    indexStatements.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${entity.tableName}(${columns.join(', ')});`);
  }

  return {
    createTable: lines.join('\n'),
    createIndexes: indexStatements
  };
}

/**
 * Initialize TypeRegistry with global types from Types.md
 */
function initializeTypeRegistry(mdPath) {
  const docsDir = path.dirname(mdPath);
  const typesPath = path.join(docsDir, 'Types.md');

  if (fs.existsSync(typesPath)) {
    const typeParser = new TypeParser();
    typeParser.parseGlobalTypes(typesPath);
  }
}

/**
 * Main: Parse DataModel.md and generate complete schema
 */
function generateSchema(mdPath, enabledEntities = null) {
  const mdContent = fs.readFileSync(mdPath, 'utf-8');

  // Initialize type registry with global types
  initializeTypeRegistry(mdPath);

  // Parse areas and classes
  const { areas, classToArea } = parseAreasFromTable(mdContent);
  const classes = parseEntityDescriptions(mdContent, mdPath);

  // Get all entity names for FK detection (conceptual notation)
  const allEntityNames = Object.keys(classes);

  // Generate schema for each class
  const entities = {};
  for (const [className, classDef] of Object.entries(classes)) {
    // Skip if not in enabled list (when specified)
    if (enabledEntities && !enabledEntities.includes(className)) {
      continue;
    }

    classDef.area = classToArea[className] || 'unknown';
    entities[className] = generateEntitySchema(className, classDef, allEntityNames);
  }

  // Enrich FK metadata with labelFields from target entities (for View generation)
  enrichFKsWithLabelFields(entities);

  // Get dependency-ordered list
  const orderedEntities = buildDependencyOrder(entities);

  // Build inverse relationships (for reverse navigation)
  const inverseRelationships = {};
  for (const entity of Object.values(entities)) {
    for (const fk of entity.foreignKeys) {
      const targetEntity = fk.references.entity;
      if (!inverseRelationships[targetEntity]) {
        inverseRelationships[targetEntity] = [];
      }
      inverseRelationships[targetEntity].push({
        entity: entity.className,
        column: fk.column
      });
    }
  }

  // Build relationships as flat list (for Layout-Editor diagram)
  const relationships = [];
  for (const entity of Object.values(entities)) {
    for (const fk of entity.foreignKeys) {
      relationships.push({
        from: entity.className,
        to: fk.references.entity,
        column: fk.column,
        displayName: fk.displayName
      });
    }
  }

  // Get global types from TypeRegistry (for Layout-Editor)
  // Filter out entity-scoped types (they're already in entity.localTypes)
  const typeRegistry = getTypeRegistry();
  const allTypes = typeRegistry.getAllTypes ? typeRegistry.getAllTypes() : {};
  const globalTypes = {};
  for (const [key, value] of Object.entries(allTypes)) {
    if (!key.startsWith('entity:')) {
      globalTypes[key] = value;
    }
  }

  return {
    areas,
    entities,
    orderedEntities,
    inverseRelationships,
    enabledEntities: enabledEntities || Object.keys(entities),  // Preserve config order
    relationships,  // Flat FK list for diagrams
    globalTypes     // Type definitions for display
  };
}

// Note: Extended schema generation (UI annotations, labelFields, etc.) is handled by
// GenericRepository.getExtendedSchemaInfo() which is used by the API.
// This keeps schema generation focused on DB structure, while the repository
// handles runtime schema enrichment for the frontend.

module.exports = {
  generateSchema,
  generateCreateTableSQL,
  generateViewSQL,
  generateEntitySchema,
  parseEntityDescriptions,
  parseEntityFile,
  parseAreasFromTable,
  parseUIAnnotations,
  parseMediaAnnotations,
  buildDependencyOrder,
  enrichFKsWithLabelFields,
  initializeTypeRegistry,
  getTypeInfo,
  getDefaultValue,
  toSnakeCase,
  TYPE_MAP
};
