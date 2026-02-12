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
  number: { sqlType: 'REAL', jsType: 'number', validation: { type: 'number' } },
  real: { sqlType: 'REAL', jsType: 'number', validation: { type: 'number' } },
  string: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string' } },
  date: { sqlType: 'TEXT', jsType: 'string', validation: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  bool: { sqlType: 'INTEGER', jsType: 'boolean', validation: { type: 'boolean' } },
  boolean: { sqlType: 'INTEGER', jsType: 'boolean', validation: { type: 'boolean' } },
  geo: { sqlType: 'TEXT', jsType: 'geo', validation: { type: 'string' } }
};

/**
 * System columns added to ALL entities automatically.
 * These are NOT defined in DataModel.md — they're infrastructure columns.
 * Prefixed with underscore to avoid polluting the user's attribute namespace.
 * - _created_at: Timestamp when record was created
 * - _updated_at: Timestamp of last modification
 * - _version: OCC version counter (starts at 1, incremented on update)
 */
const SYSTEM_COLUMNS = [
  {
    name: '_created_at',
    type: 'string',
    sqlType: "TEXT DEFAULT (datetime('now'))",
    jsType: 'string',
    required: false,
    system: true,
    ui: { readonly: true }
  },
  {
    name: '_updated_at',
    type: 'string',
    sqlType: "TEXT DEFAULT (datetime('now'))",
    jsType: 'string',
    required: false,
    system: true,
    ui: { readonly: true }
  },
  {
    name: '_version',
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
 * Supported: [LABEL], [LABEL2], [READONLY], [HIDDEN], [TRUNCATE=n]
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
  // Parse [TRUNCATE=n] - truncate display to n characters with tooltip
  const truncateMatch = description.match(/\[TRUNCATE=(\d+)\]/i);
  if (truncateMatch) {
    ui.truncate = parseInt(truncateMatch[1], 10);
  }
  // Parse [NOWRAP] - prevent text wrapping in table cells
  if (/\[NOWRAP\]/i.test(description)) {
    ui.nowrap = true;
  }

  // Parse [API: name] - field populated by API refresh
  const apiMatch = description.match(/\[API:\s*(\w+)\]/i);
  if (apiMatch) {
    ui.apiSource = apiMatch[1];
  }

  return Object.keys(ui).length > 0 ? ui : null;
}

/**
 * Split concat() arguments respecting quoted strings
 * e.g., "field1, ' - ', field2" -> ["field1", "' - '", "field2"]
 */
function splitConcatArgs(argsStr) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = null;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === quoteChar && inQuote) {
      inQuote = false;
      current += ch;
      quoteChar = null;
    } else if (ch === ',' && !inQuote) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Parse a label expression from [LABEL=expr] or [LABEL2=expr]
 * Supports: concat(field1, 'sep', field2), field.chain, or simple fieldname
 * @param {string} expr - The expression string
 * @returns {object} - Structured expression with typed parts
 */
function parseLabelExpression(expr) {
  const trimmed = expr.trim();

  // Match concat(...)
  const concatMatch = trimmed.match(/^concat\((.+)\)$/i);
  if (concatMatch) {
    const rawParts = splitConcatArgs(concatMatch[1]);
    const parts = rawParts.map(p => {
      // Check if it's a quoted literal
      if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
        return { type: 'literal', value: p.slice(1, -1) };
      }
      // Check for dot notation (FK chain)
      if (p.includes('.')) {
        return { type: 'fkChain', path: p };
      }
      // Simple field or FK reference - distinguished later based on schema
      return { type: 'ref', name: p };
    });
    return { type: 'concat', parts };
  }

  // Simple field/FK reference
  if (trimmed.includes('.')) {
    return { type: 'fkChain', path: trimmed };
  }
  return { type: 'ref', name: trimmed };
}

/**
 * Parse entity-level annotations from content before ## sections
 * Supports: [LABEL=concat(...)] or [LABEL=fieldname], [LABEL2=...]
 * @param {string[]} headerLines - Lines between H1 and first ## section
 * @returns {object} - { labelExpression?, label2Expression? }
 */
function parseEntityLevelAnnotations(headerLines) {
  const annotations = {};

  for (const line of headerLines) {
    // Match [LABEL=concat(...)] or [LABEL=fieldname]
    const labelMatch = line.match(/\[LABEL=(.+?)\]/i);
    if (labelMatch) {
      annotations.labelExpression = parseLabelExpression(labelMatch[1]);
    }

    // Match [LABEL2=concat(...)] or [LABEL2=fieldname]
    const label2Match = line.match(/\[LABEL2=(.+?)\]/i);
    if (label2Match) {
      annotations.label2Expression = parseLabelExpression(label2Match[1]);
    }

    // Match [PAIRS=SourceEntity(chain1, chain2)]
    const pairsMatch = line.match(/\[PAIRS=(\w+)\(([^)]+)\)\]/i);
    if (pairsMatch) {
      const chains = pairsMatch[2].split(',').map(c => c.trim().split('.'));
      annotations.pairs = { sourceEntity: pairsMatch[1], chains };
      annotations.computed = true;
    }

    // Match [API_REFRESH: name] — entity can be refreshed from external API
    const apiRefreshMatch = line.match(/\[API_REFRESH:\s*(\w+)\]/i);
    if (apiRefreshMatch) {
      if (!annotations.apiRefresh) annotations.apiRefresh = [];
      annotations.apiRefresh.push(apiRefreshMatch[1]);
    }

    // Match [API_REFRESH_ON_LOAD: name] — auto-refresh when CRUD dialog opens
    const apiRefreshOnLoadMatch = line.match(/\[API_REFRESH_ON_LOAD:\s*(\w+)\]/i);
    if (apiRefreshOnLoadMatch) {
      if (!annotations.apiRefreshOnLoad) annotations.apiRefreshOnLoad = [];
      annotations.apiRefreshOnLoad.push(apiRefreshOnLoadMatch[1]);
      // Also add to apiRefresh (ON_LOAD implies refresh capability)
      if (!annotations.apiRefresh) annotations.apiRefresh = [];
      if (!annotations.apiRefresh.includes(apiRefreshOnLoadMatch[1])) {
        annotations.apiRefresh.push(apiRefreshOnLoadMatch[1]);
      }
    }
  }

  return Object.keys(annotations).length > 0 ? annotations : null;
}

/**
 * Build SQL expression from label expression (simple version without FK resolution)
 * Used for FK label columns where the join already exists
 * @param {object} expr - Structured label expression
 * @param {string} alias - Table alias (e.g., 'b') or empty string
 * @returns {string} - SQL expression
 */
function buildLabelSQL(expr, alias) {
  const prefix = alias ? `${alias}.` : '';

  // Handle new structured format
  if (expr.type === 'ref') {
    return `${prefix}${expr.name}`;
  }

  if (expr.type === 'fkChain') {
    // For simple buildLabelSQL, just use the path as-is (caller must ensure alias is correct)
    const segments = expr.path.split('.');
    return `${prefix}${segments[segments.length - 1]}`;
  }

  if (expr.type === 'literal') {
    return `'${expr.value}'`;
  }

  // Legacy format support
  if (expr.type === 'field') {
    return `${prefix}${expr.field}`;
  }

  if (expr.type === 'concat') {
    const sqlParts = expr.parts.map(p => {
      // Handle new structured parts
      if (typeof p === 'object') {
        if (p.type === 'literal') return `'${p.value}'`;
        if (p.type === 'ref') return `${prefix}${p.name}`;
        if (p.type === 'fkChain') {
          const segs = p.path.split('.');
          return `${prefix}${segs[segs.length - 1]}`;
        }
      }
      // Legacy: string parts
      if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
        return p;
      }
      return `${prefix}${p}`;
    });
    return `(${sqlParts.join(' || ')})`;
  }

  return 'NULL';
}

/**
 * Build SQL expression with FK chain resolution
 * Resolves FK references to their target entity's labels, creating necessary JOINs
 * @param {object} expr - Structured label expression
 * @param {string} baseAlias - Base table alias (e.g., 'b')
 * @param {object} entity - Entity definition (for FK column lookup)
 * @param {object} schema - Full schema (for target entity resolution)
 * @param {object} joinCounter - Mutable counter for generating unique join aliases
 * @returns {{ sql: string, joins: Array<{alias, table, onLeft, onRight}> }}
 */
function buildLabelSQLWithJoins(expr, baseAlias, entity, schema, joinCounter = { value: 0 }) {

  /**
   * Resolve a simple reference (field or FK) to SQL
   */
  function resolveRef(refName, currentAlias, currentEntity) {
    // Check if it's an FK column
    const fkCol = currentEntity.columns.find(
      c => c.foreignKey && (c.displayName === refName || c.name === refName || c.name === refName + '_id')
    );

    if (!fkCol) {
      // Simple field on current table
      return { sql: `${currentAlias}.${refName}`, joins: [] };
    }

    // FK reference - need to join and resolve target's label
    const targetEntityName = fkCol.foreignKey.entity;
    const targetEntity = schema.entities[targetEntityName];
    if (!targetEntity) {
      console.warn(`[labelExpression] Target entity "${targetEntityName}" not found for FK "${refName}"`);
      return { sql: `${currentAlias}.${fkCol.name}`, joins: [] };
    }

    const joinAlias = `lbl${joinCounter.value++}`;
    const join = {
      alias: joinAlias,
      table: targetEntity.tableName,
      onLeft: `${currentAlias}.${fkCol.name}`,
      onRight: `${joinAlias}.id`
    };

    if (targetEntity.labelExpression) {
      // Recursive: target has computed label - resolve its expression
      const nested = buildLabelSQLWithJoins(
        targetEntity.labelExpression, joinAlias, targetEntity, schema, joinCounter
      );
      return { sql: nested.sql, joins: [join, ...nested.joins] };
    } else {
      // Use target's LABEL column
      const labelCol = targetEntity.columns.find(c => c.ui?.label);
      const colName = labelCol?.name || 'id';
      return { sql: `${joinAlias}.${colName}`, joins: [join] };
    }
  }

  /**
   * Resolve an FK chain (e.g., type.manufacturer.name) to SQL
   */
  function resolveFKChain(path, currentAlias, currentEntity) {
    const segments = path.split('.');
    let alias = currentAlias;
    let ent = currentEntity;
    const chainJoins = [];

    // Walk intermediate FKs (all segments except last)
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const fkCol = ent.columns.find(
        c => c.foreignKey && (c.displayName === seg || c.name === seg || c.name === seg + '_id')
      );

      if (!fkCol) {
        console.warn(`[labelExpression] FK "${seg}" not found in ${ent.className}`);
        return { sql: 'NULL', joins: chainJoins };
      }

      const targetEntityName = fkCol.foreignKey.entity;
      const targetEntity = schema.entities[targetEntityName];
      if (!targetEntity) {
        console.warn(`[labelExpression] Target entity "${targetEntityName}" not found`);
        return { sql: 'NULL', joins: chainJoins };
      }

      const joinAlias = `lbl${joinCounter.value++}`;
      chainJoins.push({
        alias: joinAlias,
        table: targetEntity.tableName,
        onLeft: `${alias}.${fkCol.name}`,
        onRight: `${joinAlias}.id`
      });

      alias = joinAlias;
      ent = targetEntity;
    }

    // Terminal segment is a column name on the last entity
    const terminalCol = segments[segments.length - 1];
    return { sql: `${alias}.${terminalCol}`, joins: chainJoins };
  }

  // Handle different expression types
  if (expr.type === 'ref') {
    return resolveRef(expr.name, baseAlias, entity);
  }

  if (expr.type === 'fkChain') {
    return resolveFKChain(expr.path, baseAlias, entity);
  }

  if (expr.type === 'literal') {
    return { sql: `'${expr.value}'`, joins: [] };
  }

  // Legacy 'field' type
  if (expr.type === 'field') {
    return resolveRef(expr.field, baseAlias, entity);
  }

  if (expr.type === 'concat') {
    const sqlParts = [];
    const allJoins = [];

    for (const part of expr.parts) {
      if (part.type === 'literal') {
        sqlParts.push(`'${part.value}'`);
      } else if (part.type === 'ref') {
        const r = resolveRef(part.name, baseAlias, entity);
        sqlParts.push(r.sql);
        allJoins.push(...r.joins);
      } else if (part.type === 'fkChain') {
        const r = resolveFKChain(part.path, baseAlias, entity);
        sqlParts.push(r.sql);
        allJoins.push(...r.joins);
      } else if (typeof part === 'string') {
        // Legacy string parts
        if ((part.startsWith("'") && part.endsWith("'")) || (part.startsWith('"') && part.endsWith('"'))) {
          sqlParts.push(part);
        } else {
          const r = resolveRef(part, baseAlias, entity);
          sqlParts.push(r.sql);
          allJoins.push(...r.joins);
        }
      }
    }

    return { sql: `(${sqlParts.join(' || ')})`, joins: allJoins };
  }

  return { sql: 'NULL', joins: [] };
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
 *   - **Trigger:** ONCHANGE           (optional: run calculation on save, implies READONLY)
 *   - ```js ... ```                   (calculation code)
 *
 * Returns: { fieldName: { code, depends: [...], sort: [...], trigger: string|null }, ... }
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
      currentCalc = { code: '', depends: [], sort: [], trigger: null };
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

    // Parse **Trigger:** ONCHANGE (triggers calculation on save)
    const triggerMatch = trimmed.match(/^\*\*Trigger:\*\*\s*(.+)$/i);
    if (triggerMatch) {
      currentCalc.trigger = triggerMatch[1].trim().toUpperCase();
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
 * Generic parser for calculation sections with configurable header
 * Used by parseClientCalculationsSection and parseServerCalculationsSection
 *
 * @param {string} fileContent - Markdown content
 * @param {string} sectionHeader - Section to parse (e.g., '## Client Calculations')
 * @returns {Object} { fieldName: { code, depends: [...], sort: [...], trigger: string|null }, ... }
 */
function parseCalculationsSectionByName(fileContent, sectionHeader) {
  const result = {};
  const lines = fileContent.split('\n');
  let inCalcSection = false;
  let currentField = null;
  let currentCalc = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect target section
    if (trimmed === sectionHeader) {
      inCalcSection = true;
      continue;
    }

    // Exit on another ## section
    if (inCalcSection && trimmed.startsWith('## ') && trimmed !== sectionHeader) {
      break;
    }

    if (!inCalcSection) continue;

    // Detect ### fieldName subsection
    if (trimmed.startsWith('### ')) {
      if (currentField && currentCalc) {
        result[currentField] = currentCalc;
      }
      currentField = trimmed.substring(4).trim();
      currentCalc = { code: '', depends: [], sort: [], trigger: null };
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

    // Parse **Trigger:** for custom triggers (mostly for server calculations)
    const triggerMatch = trimmed.match(/^\*\*Trigger:\*\*\s*(.+)$/i);
    if (triggerMatch) {
      currentCalc.trigger = triggerMatch[1].trim().toUpperCase();
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
 * Parse ## Client Calculations section - display-only calculations run in browser
 * @param {string} fileContent - Markdown content
 * @returns {Object} { fieldName: { code, depends: [...], sort: [] }, ... }
 */
function parseClientCalculationsSection(fileContent) {
  return parseCalculationsSectionByName(fileContent, '## Client Calculations');
}

/**
 * Parse ## Server Calculations section - persistent calculations run on server after save
 * Default trigger is ONCHANGE (calculated after every create/update)
 * @param {string} fileContent - Markdown content
 * @returns {Object} { fieldName: { code, depends: [...], sort: [...], trigger: 'ONCHANGE' }, ... }
 */
function parseServerCalculationsSection(fileContent) {
  const calcs = parseCalculationsSectionByName(fileContent, '## Server Calculations');
  // Default trigger is ONCHANGE for server calculations
  for (const def of Object.values(calcs)) {
    if (!def.trigger) {
      def.trigger = 'ONCHANGE';
    }
  }
  return calcs;
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

  // Collect header lines (between H1 and first ## section or table)
  // These contain description and entity-level annotations like [LABEL=concat(...)]
  const headerLines = [];
  let i = 1;
  while (i < lines.length && !lines[i].startsWith('|') && !lines[i].startsWith('## ')) {
    const line = lines[i].trim();
    if (line) {
      headerLines.push(line);
      // Last non-annotation line is the description
      if (!line.startsWith('[')) {
        description = line;
      }
    }
    i++;
  }

  // Parse entity-level annotations from header lines
  const entityAnnotations = parseEntityLevelAnnotations(headerLines);

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

  // Parse calculation sections
  // New: ## Client Calculations and ## Server Calculations
  const clientCalculations = parseClientCalculationsSection(fileContent);
  const serverCalculations = parseServerCalculationsSection(fileContent);

  // Legacy: ## Calculations (deprecated, kept for backward compatibility)
  const legacyCalculations = parseCalculationsSection(fileContent);

  // Merge legacy calculations with new format:
  // - Legacy without trigger → client
  // - Legacy with ONCHANGE trigger → server
  const mergedClientCalcs = {};
  const mergedServerCalcs = { ...serverCalculations };

  for (const [name, def] of Object.entries(legacyCalculations)) {
    if (def.trigger === 'ONCHANGE') {
      // Legacy with ONCHANGE → server (unless already defined in ## Server Calculations)
      if (!mergedServerCalcs[name]) {
        mergedServerCalcs[name] = def;
      }
    } else {
      // Legacy without trigger → client (unless already defined in ## Client Calculations)
      if (!clientCalculations[name]) {
        mergedClientCalcs[name] = def;
      }
    }
  }

  // Add explicit client calculations (override legacy)
  Object.assign(mergedClientCalcs, clientCalculations);

  // Emit deprecation warning if legacy section is used but new sections are not
  const hasLegacy = Object.keys(legacyCalculations).length > 0;
  const hasNewSections = Object.keys(clientCalculations).length > 0 ||
                         Object.keys(serverCalculations).length > 0;
  if (hasLegacy && !hasNewSections) {
    console.warn(
      `[Schema Warning] ${className}: "## Calculations" is deprecated. ` +
      `Migrate to "## Client Calculations" or "## Server Calculations".`
    );
  }

  return {
    className,
    description,
    attributes,
    clientCalculations: mergedClientCalcs,
    serverCalculations: mergedServerCalcs,
    // Legacy: keep 'calculations' for backward compat during transition
    calculations: legacyCalculations,
    localTypes,
    entityAnnotations
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
            clientCalculations: parsed.clientCalculations,
            serverCalculations: parsed.serverCalculations,
            localTypes: parsed.localTypes,
            entityAnnotations: parsed.entityAnnotations
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
    if (typeRegistry.isAggregate(cleanType, className)) {
      const aggregateFields = typeRegistry.getAggregateFields(cleanType, className);
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
          customType: (['url', 'mail', 'media'].includes(field.type)) ? field.type : null,
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
      // Computed fields (DAILY, CALCULATED) are populated after INSERT, so skip NOT NULL
      const isComputed = /\[(DAILY|CALCULATED|IMMEDIATE|HOURLY|ON_DEMAND)[=\]]/.test(desc);
      if (!isComputed) {
        sqlType += ' NOT NULL';
      }
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

    // Parse [CALCULATED] annotation
    const isCalculated = parseCalculatedAnnotation(desc);

    // Check for client calculation (display-only, runs in browser)
    const clientCalcDef = isCalculated && classDef.clientCalculations?.[name]
      ? classDef.clientCalculations[name]
      : null;

    // Check for server calculation (persistent, runs after save)
    const serverCalcDef = classDef.serverCalculations?.[name] || null;

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

    // Client calculation (display-only, runs in browser)
    if (clientCalcDef) {
      column.clientCalculated = clientCalcDef;
      // Legacy: keep 'calculated' for backward compat with existing client code
      column.calculated = clientCalcDef;
    }

    // Server calculation (persistent, runs after save)
    if (serverCalcDef) {
      column.serverCalculated = serverCalcDef;
      // Server calculations are ALWAYS readonly (auto-computed, not user-editable)
      if (!column.ui) column.ui = {};
      column.ui.readonly = true;
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

  // Store entity-level label expression if defined
  const entityAnnotations = classDef.entityAnnotations || null;
  const hasComputedLabel = !!entityAnnotations?.labelExpression;

  const entityUI = {
    labelFields: {
      primary: labelCol?.name || null,
      secondary: label2Col?.name || null
    },
    hasComputedLabel
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
    localTypes: classDef.localTypes || {},
    // Entity-level label expression (takes precedence over column [LABEL])
    labelExpression: entityAnnotations?.labelExpression || null,
    label2Expression: entityAnnotations?.label2Expression || null,
    // Computed entity: PAIRS annotation for auto-populated M:N mapping
    pairs: entityAnnotations?.pairs || null,
    computed: entityAnnotations?.computed || false,
    // API Refresh: entity can be updated from external API
    apiRefresh: entityAnnotations?.apiRefresh || null,
    apiRefreshOnLoad: entityAnnotations?.apiRefreshOnLoad || null
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
        // Check if target has entity-level labelExpression
        if (targetEntity.labelExpression) {
          fk.labelFields = {
            primary: null,  // No column - computed expression
            secondary: null,
            expression: targetEntity.labelExpression  // Store the expression
          };
        } else {
          // Fallback: Find LABEL and LABEL2 columns in target entity
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
function generateViewSQL(entity, schema) {
  const baseTable = entity.tableName;
  const baseAlias = 'b';

  const selects = [`${baseAlias}.*`];
  const joinStatements = [];
  const joinAliases = new Set(); // Track used aliases to avoid duplicates

  // Helper to add a join if not already present
  function addJoin(join) {
    if (!joinAliases.has(join.alias)) {
      joinAliases.add(join.alias);
      joinStatements.push(`LEFT JOIN ${join.table} ${join.alias} ON ${join.onLeft} = ${join.onRight}`);
    }
  }

  // Shared join counter for all label expressions
  const joinCounter = { value: 0 };

  // Add computed _label if entity has labelExpression
  if (entity.labelExpression && schema) {
    const result = buildLabelSQLWithJoins(entity.labelExpression, baseAlias, entity, schema, joinCounter);
    selects.push(`${result.sql} AS _label`);
    result.joins.forEach(addJoin);
  }

  // Add computed _label2 if entity has label2Expression
  if (entity.label2Expression && schema) {
    const result = buildLabelSQLWithJoins(entity.label2Expression, baseAlias, entity, schema, joinCounter);
    selects.push(`${result.sql} AS _label2`);
    result.joins.forEach(addJoin);
  }

  // Add FK label columns
  for (const fk of entity.foreignKeys) {
    // Skip FKs without labelFields (no primary column AND no expression)
    if (!fk.labelFields?.primary && !fk.labelFields?.expression) continue;

    const joinAlias = `fk${joinCounter.value++}`;
    const targetTable = fk.references.table;
    const targetEntityName = fk.references.entity;
    const targetEntity = schema?.entities?.[targetEntityName];
    const labelFieldName = fk.displayName + '_label';

    // Add join for this FK
    const fkJoin = {
      alias: joinAlias,
      table: targetTable,
      onLeft: `${baseAlias}.${fk.column}`,
      onRight: `${joinAlias}.id`
    };
    addJoin(fkJoin);

    let labelExpr;
    if (fk.labelFields.expression && targetEntity && schema) {
      // Target has computed label - resolve with FK chain support
      const result = buildLabelSQLWithJoins(fk.labelFields.expression, joinAlias, targetEntity, schema, joinCounter);
      labelExpr = result.sql;
      result.joins.forEach(addJoin);
    } else if (fk.labelFields.expression) {
      // Fallback: use simple buildLabelSQL (no FK resolution)
      labelExpr = buildLabelSQL(fk.labelFields.expression, joinAlias);
    } else {
      // Build label expression: primary or "primary (secondary)"
      const { primary, secondary } = fk.labelFields;
      labelExpr = secondary
        ? `${joinAlias}.${primary} || ' (' || ${joinAlias}.${secondary} || ')'`
        : `${joinAlias}.${primary}`;
    }

    selects.push(`${labelExpr} AS ${labelFieldName}`);
  }

  // Build final SQL
  const joinClause = joinStatements.length > 0 ? '\n' + joinStatements.join('\n') : '';

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
 * Validate schema and emit warnings for common issues:
 * - LABEL column without UNIQUE constraint (FK resolution may be ambiguous)
 * - LABEL on aggregate types (unsupported - will be copied to all sub-fields)
 */
function validateSchemaLabelUniqueness(entities) {
  for (const entity of Object.values(entities)) {
    // Skip if entity uses computed labelExpression (no column to check)
    if (entity.labelExpression) continue;

    // Find LABEL column
    const labelCol = entity.columns.find(c => c.ui?.label);
    if (!labelCol) continue;

    // Check if LABEL column has UNIQUE constraint or is part of UK
    const hasUnique = labelCol.unique === true;
    const isPartOfUK = Object.values(entity.uniqueKeys || {}).some(
      cols => cols.includes(labelCol.name)
    );

    if (!hasUnique && !isPartOfUK) {
      console.warn(
        `[Schema Warning] ${entity.className}: LABEL column "${labelCol.name}" is not UNIQUE. ` +
        `FK resolution during import may be ambiguous if duplicate values exist.`
      );
    }

    // Check if LABEL is on an aggregate type (unsupported)
    if (labelCol.aggregateType) {
      console.warn(
        `[Schema Warning] ${entity.className}: [LABEL] annotation on aggregate type "${labelCol.aggregateType}" is not meaningful. ` +
        `Consider using a string field as LABEL instead.`
      );
    }
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

  // Validate schema and emit warnings for common issues
  validateSchemaLabelUniqueness(entities);

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

/**
 * Generate SQL to populate a computed PAIRS entity from its source entity.
 * Follows FK chains to resolve the target IDs for each column.
 *
 * Example: [PAIRS=EngineAllocation(engine.type, aircraft.type)]
 * → SELECT DISTINCT engine.type_id, aircraft.type_id FROM engine_allocation ...
 *
 * @param {object} entity - The computed entity schema (must have entity.pairs)
 * @param {object} allEntities - All entity schemas keyed by className
 * @returns {string|null} - INSERT SQL statement, or null on error
 */
function generatePairsSQL(entity, allEntities) {
  const { pairs } = entity;
  if (!pairs) return null;

  const sourceEntity = allEntities[pairs.sourceEntity];
  if (!sourceEntity) {
    console.warn(`[PAIRS] Source entity "${pairs.sourceEntity}" not found`);
    return null;
  }

  const selects = [];
  const joins = [];
  const whereNotNull = [];
  const fkColumns = entity.columns.filter(c => c.foreignKey);

  for (let chainIdx = 0; chainIdx < pairs.chains.length; chainIdx++) {
    const chain = pairs.chains[chainIdx];
    if (!fkColumns[chainIdx]) {
      console.warn(`[PAIRS] No FK column at index ${chainIdx} for chain "${chain.join('.')}"`);
      return null;
    }

    let currentEntity = sourceEntity;
    let currentAlias = 'src';

    for (let stepIdx = 0; stepIdx < chain.length; stepIdx++) {
      const fkName = chain[stepIdx];
      const isLastStep = stepIdx === chain.length - 1;

      const fkCol = currentEntity.columns.find(c =>
        c.foreignKey && c.name === `${fkName}_id`
      );
      if (!fkCol) {
        console.warn(`[PAIRS] FK "${fkName}" (${fkName}_id) not found in ${currentEntity.className}`);
        return null;
      }

      if (isLastStep) {
        selects.push(`${currentAlias}.${fkCol.name}`);
        whereNotNull.push(`${currentAlias}.${fkCol.name} IS NOT NULL`);
      } else {
        const targetEntity = allEntities[fkCol.foreignKey.entity];
        if (!targetEntity) {
          console.warn(`[PAIRS] Target entity "${fkCol.foreignKey.entity}" not found`);
          return null;
        }
        const joinAlias = `j${chainIdx}_${stepIdx}`;
        joins.push(`JOIN ${targetEntity.tableName} ${joinAlias} ON ${joinAlias}.id = ${currentAlias}.${fkCol.name}`);
        whereNotNull.push(`${currentAlias}.${fkCol.name} IS NOT NULL`);
        currentEntity = targetEntity;
        currentAlias = joinAlias;
      }
    }
  }

  const targetCols = fkColumns.slice(0, pairs.chains.length).map(c => c.name);
  const joinClause = joins.length > 0 ? '\n' + joins.join('\n') : '';

  return `INSERT OR IGNORE INTO ${entity.tableName} (${targetCols.join(', ')})
SELECT DISTINCT ${selects.join(', ')}
FROM ${sourceEntity.tableName} src${joinClause}
WHERE ${whereNotNull.join(' AND ')}`;
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
  TYPE_MAP,
  // Entity-level label expression utilities
  buildLabelSQL,
  buildLabelSQLWithJoins,
  parseLabelExpression,
  // Computed entity utilities
  generatePairsSQL
};
