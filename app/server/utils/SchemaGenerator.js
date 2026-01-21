/**
 * SchemaGenerator - Parse DataModel.md and generate SQL schema + validation rules
 *
 * Extends the parsing logic from tools/parse-datamodel.js to generate:
 * - SQL DDL for table creation
 * - Validation rules for ObjectValidator
 * - Foreign key relationships
 * - UNIQUE constraints and indexes
 */

const fs = require('fs');
const path = require('path');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const { TypeParser } = require('../../shared/types/TypeParser');

// Shared TypeParser instance for extracting type names from markdown links
const typeParserInstance = new TypeParser();

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
  boolean: { sqlType: 'INTEGER', jsType: 'boolean', validation: { type: 'boolean' } }
};

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
 * Supported: [LABEL], [LABEL2], [DETAIL], [HOVER], [READONLY], [HIDDEN]
 *
 * Display logic:
 * - LABEL/LABEL2/DETAIL: Always visible in tree view ("Grundansicht")
 * - No tag: Only visible on hover/focus
 * - HIDDEN: Never visible
 */
function parseUIAnnotations(description) {
  const ui = {};

  if (/\[LABEL\]/i.test(description)) {
    ui.label = true;
  }
  if (/\[LABEL2\]/i.test(description)) {
    ui.label2 = true;
  }
  if (/\[DETAIL\]/i.test(description)) {
    ui.detail = true;
  }
  if (/\[HOVER\]/i.test(description)) {
    ui.hover = true;
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
 * Parse the Areas from Entity Descriptions section
 * Format: ### AreaName followed by <div style="background-color: #COLOR"> and entity table
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

    // Extract entity names from markdown links: [EntityName](classes/EntityName.md)
    const entityPattern = /\[([^\]]+)\]\(classes\/[^)]+\.md\)/g;
    let entityMatch;
    while ((entityMatch = entityPattern.exec(tableContent)) !== null) {
      const className = entityMatch[1].trim();
      classToArea[className] = areaKey;
    }
  }

  return { areas, classToArea };
}

/**
 * Extract [DEFAULT=x] annotation from type string
 * e.g., "MaintenanceCategory [DEFAULT=A]" -> { type: "MaintenanceCategory", default: "A" }
 * e.g., "int" -> { type: "int", default: null }
 */
function extractDefaultAnnotation(typeStr) {
  const defaultMatch = typeStr.match(/\[DEFAULT=([^\]]+)\]/i);
  if (defaultMatch) {
    const cleanType = typeStr.replace(/\s*\[DEFAULT=[^\]]+\]/i, '').trim();
    return { type: cleanType, default: defaultMatch[1].trim() };
  }
  return { type: typeStr, default: null };
}

/**
 * Parse a single entity markdown file
 * Format: | Attribute | Type | Description | Example |
 *
 * The Type column can include a [DEFAULT=x] annotation:
 *   | maintenance_category | MaintenanceCategory [DEFAULT=A] | Current category | B |
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
  const typesSection = typeParserInstance._extractTypesSection(fileContent);
  if (typesSection) {
    const localTypes = typeParserInstance._parseTypesContent(typesSection, `entity:${className}`);
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
        // Extract type name and [DEFAULT=x] annotation from Type column
        const typeWithDefault = extractDefaultAnnotation(parts[1]);

        const attr = {
          name: parts[0],
          type: extractTypeName(typeWithDefault.type),
          explicitDefault: typeWithDefault.default,
          description: parts[2]
        };
        if (parts.length >= 4) {
          attr.example = parts[3];
        }
        attributes.push(attr);
      }
    }
  }

  return {
    className,
    description,
    attributes
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
            attributes: parsed.attributes
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
 */
function generateEntitySchema(className, classDef) {
  const tableName = toSnakeCase(className);
  const columns = [];
  const validationRules = {};
  const uniqueKeys = {};  // UK1 -> [columns]
  const indexes = {};     // IX1 -> [columns]
  const foreignKeys = [];
  const enumFields = {};  // Fields that are enums (for response enrichment)

  for (const attr of classDef.attributes || []) {
    const name = attr.name;
    const attrType = attr.type;
    const desc = attr.description || '';
    const example = attr.example || '';

    // Determine if required (example is not 'null')
    const isRequired = example.toLowerCase() !== 'null' && name !== 'id';

    // Parse constraints from description
    const constraints = parseConstraints(desc);

    // Detect foreign key from description
    let foreignKey = null;
    const fkMatch = desc.match(/Reference to (\w+)/);
    if (fkMatch) {
      const targetEntity = fkMatch[1];
      foreignKey = {
        table: toSnakeCase(targetEntity),
        column: 'id',
        entity: targetEntity
      };
      foreignKeys.push({
        column: name,
        references: foreignKey
      });
    }

    // Get type info (from TypeRegistry or TYPE_MAP)
    const typeInfo = getTypeInfo(attrType, className);

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

    // Parse UI annotations
    const uiAnnotations = parseUIAnnotations(desc);

    // Calculate default value (skip for id and foreign keys)
    let defaultValue = null;
    if (name !== 'id' && !foreignKey) {
      defaultValue = getDefaultValue(attr, typeInfo.jsType, typeInfo.typeDef);
    }

    // Build column definition
    const column = {
      name,
      sqlType,
      jsType: typeInfo.jsType,
      required: isRequired,
      customType: typeInfo.isCustomType ? attrType : null,
      defaultValue
    };

    if (foreignKey) {
      column.foreignKey = foreignKey;
    }

    if (constraints.unique) {
      column.unique = true;
    }

    if (uiAnnotations) {
      column.ui = uiAnnotations;
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
    enumFields
  };
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
  const deps = {};
  for (const entity of Object.values(entities)) {
    deps[entity.className] = [];
    for (const fk of entity.foreignKeys) {
      deps[entity.className].push(fk.references.entity);
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
      if (dependencies.includes(node)) {
        inDegree[name]--;
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
 * Generate SQL DDL for creating a table
 */
function generateCreateTableSQL(entity) {
  const lines = [`CREATE TABLE IF NOT EXISTS ${entity.tableName} (`];
  const columnDefs = [];
  const constraints = [];

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

  // Generate schema for each class
  const entities = {};
  for (const [className, classDef] of Object.entries(classes)) {
    // Skip if not in enabled list (when specified)
    if (enabledEntities && !enabledEntities.includes(className)) {
      continue;
    }

    classDef.area = classToArea[className] || 'unknown';
    entities[className] = generateEntitySchema(className, classDef);
  }

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

  return {
    areas,
    entities,
    orderedEntities,
    inverseRelationships
  };
}

/**
 * Generate extended schema with UI metadata for frontend
 *
 * Tag meanings:
 * - [LABEL], [LABEL2]: Fields used for display label AND basic view (Grundansicht)
 * - [DETAIL]: Additional fields to show in basic view (Grundansicht)
 * - [HOVER]: (legacy) Explicit hover-only
 * - [HIDDEN]: Never visible
 * - [READONLY]: Not editable
 *
 * Field visibility logic:
 * - detailFields: Fields marked [LABEL], [LABEL2], or [DETAIL] - always visible when expanded
 * - hoverFields: All other fields (except hidden) - only visible on hover/focus
 * - hiddenFields: Fields marked [HIDDEN] - never visible
 */
function generateExtendedSchema(entity, inverseRelationships) {
  const labelFields = [];
  const detailFields = [];
  const hoverFields = [];
  const readonlyFields = ['id']; // id is always readonly
  const hiddenFields = [];

  for (const col of entity.columns) {
    const isLabel = col.ui?.label || col.ui?.label2;
    const isDetail = col.ui?.detail;
    const isHidden = col.ui?.hidden;

    // labelFields are for display purposes (title/subtitle)
    if (col.ui?.label) labelFields.push(col.name);
    if (col.ui?.label2) labelFields.push(col.name);
    if (col.ui?.readonly) readonlyFields.push(col.name);

    if (isHidden) {
      hiddenFields.push(col.name);
    } else if (isLabel || isDetail) {
      // LABEL, LABEL2, DETAIL fields are always visible in Grundansicht
      detailFields.push(col.name);
    } else {
      // All other fields are hover-only
      hoverFields.push(col.name);
    }
  }

  // Get back-references (entities that reference this one)
  const backReferences = inverseRelationships[entity.className] || [];

  return {
    ...entity,
    ui: {
      labelFields: labelFields.length > 0 ? labelFields : null,
      detailFields: detailFields.length > 0 ? detailFields : null,
      hoverFields: hoverFields.length > 0 ? hoverFields : null,
      readonlyFields,
      hiddenFields: hiddenFields.length > 0 ? hiddenFields : null
    },
    backReferences
  };
}

module.exports = {
  generateSchema,
  generateCreateTableSQL,
  generateEntitySchema,
  generateExtendedSchema,
  parseEntityDescriptions,
  parseEntityFile,
  parseAreasFromTable,
  parseUIAnnotations,
  buildDependencyOrder,
  initializeTypeRegistry,
  getTypeInfo,
  getDefaultValue,
  toSnakeCase,
  TYPE_MAP
};
