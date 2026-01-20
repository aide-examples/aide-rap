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

/**
 * Type mapping from DataModel.md to SQLite and JS
 */
const TYPE_MAP = {
  int: { sqlType: 'INTEGER', jsType: 'number', validation: { type: 'number' } },
  string: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string' } },
  date: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
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
 * Supported: [LABEL], [LABEL2], [HOVER], [READONLY], [HIDDEN]
 */
function parseUIAnnotations(description) {
  const ui = {};

  if (/\[LABEL\]/i.test(description)) {
    ui.label = true;
  }
  if (/\[LABEL2\]/i.test(description)) {
    ui.label2 = true;
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
 * Parse the Areas of Competence HTML table
 */
function parseAreasFromTable(mdContent) {
  const areas = {};
  const classToArea = {};

  const tableMatch = mdContent.match(/<table>[\s\S]*?<\/table>/);
  if (!tableMatch) {
    return { areas, classToArea };
  }

  const tableHtml = tableMatch[0];
  const rowPattern = /<tr[^>]*style="background-color:\s*(#[0-9A-Fa-f]{6})[^"]*"[^>]*>[\s\S]*?<td><strong>([^<]+)<\/strong><\/td>\s*<td>([^<]+)<\/td>/g;
  let match;

  while ((match = rowPattern.exec(tableHtml)) !== null) {
    const color = match[1];
    const areaName = decodeHtmlEntities(match[2].trim());
    const classesStr = match[3].trim();

    const areaKey = areaName.toLowerCase().replace(/ /g, '_').replace(/&/g, 'and');

    areas[areaKey] = {
      name: areaName,
      color: color
    };

    for (const className of classesStr.split(',').map(c => c.trim())) {
      classToArea[className] = areaKey;
    }
  }

  return { areas, classToArea };
}

/**
 * Extract classes and attributes from Entity Descriptions section
 * Now includes Example column for required detection
 */
function parseEntityDescriptions(mdContent) {
  const classes = {};

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
              type: parts[1],
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
 * Generate schema for a single entity
 */
function generateEntitySchema(className, classDef) {
  const tableName = toSnakeCase(className);
  const columns = [];
  const validationRules = {};
  const uniqueKeys = {};  // UK1 -> [columns]
  const indexes = {};     // IX1 -> [columns]
  const foreignKeys = [];

  for (const attr of classDef.attributes || []) {
    const name = attr.name;
    const baseType = attr.type.toLowerCase();
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

    // Map type
    const typeInfo = TYPE_MAP[baseType] || TYPE_MAP.string;

    // Build SQL type
    let sqlType = typeInfo.sqlType;
    if (name === 'id') {
      sqlType = 'INTEGER PRIMARY KEY';
    } else if (isRequired && !foreignKey) {
      sqlType += ' NOT NULL';
    }

    // Parse UI annotations
    const uiAnnotations = parseUIAnnotations(desc);

    // Build column definition
    const column = {
      name,
      sqlType,
      jsType: typeInfo.jsType,
      required: isRequired
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
    foreignKeys
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
 * Main: Parse DataModel.md and generate complete schema
 */
function generateSchema(mdPath, enabledEntities = null) {
  const mdContent = fs.readFileSync(mdPath, 'utf-8');

  // Parse areas and classes
  const { areas, classToArea } = parseAreasFromTable(mdContent);
  const classes = parseEntityDescriptions(mdContent);

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
 */
function generateExtendedSchema(entity, inverseRelationships) {
  const labelFields = [];
  const hoverFields = [];
  const readonlyFields = ['id']; // id is always readonly
  const hiddenFields = [];

  for (const col of entity.columns) {
    if (col.ui) {
      if (col.ui.label) labelFields.push(col.name);
      if (col.ui.label2) labelFields.push(col.name);
      if (col.ui.hover) hoverFields.push(col.name);
      if (col.ui.readonly) readonlyFields.push(col.name);
      if (col.ui.hidden) hiddenFields.push(col.name);
    }
  }

  // Get back-references (entities that reference this one)
  const backReferences = inverseRelationships[entity.className] || [];

  return {
    ...entity,
    ui: {
      labelFields: labelFields.length > 0 ? labelFields : null,
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
  parseAreasFromTable,
  parseUIAnnotations,
  buildDependencyOrder,
  toSnakeCase,
  TYPE_MAP
};
