/**
 * UserViewGenerator - Parse config-defined views and generate SQL
 *
 * Resolves dot-notation path expressions (e.g. "type.manufacturer.name")
 * against the schema FK chain and produces CREATE VIEW statements.
 */

const logger = require('./logger');

/**
 * Convert PascalCase to snake_case
 */
function toSnakeCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Convert view name to SQL-safe view name
 * "Engine Status" → "uv_engine_status"
 */
function toSqlName(viewName) {
  return 'uv_' + viewName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

/**
 * Title-case a string: "serial_number" → "Serial Number"
 */
function titleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Parse a single column config entry into { path, label, omit }
 *
 * Supports:
 *   "serial_number"                        → { path: "serial_number", label: null, omit: undefined }
 *   "type.designation AS Engine Type"      → { path: "type.designation", label: "Engine Type", omit: undefined }
 *   "mount_position AS pos OMIT 0"        → { path: "mount_position", label: "pos", omit: "0" }
 *   "total_cycles OMIT 0"                 → { path: "total_cycles", label: null, omit: "0" }
 *   { path: "type.manufacturer.name", label: "OEM" }           → as-is
 *   { path: "total_cycles", label: "Cycles", omit: 0 }         → omit: "0"
 */
function parseColumnEntry(entry) {
  if (typeof entry === 'object' && entry.path) {
    return {
      path: entry.path,
      label: entry.label || null,
      omit: entry.omit !== undefined ? String(entry.omit) : undefined
    };
  }

  if (typeof entry === 'string') {
    let str = entry;
    let omit;

    // Extract OMIT suffix first
    const omitMatch = str.match(/^(.+?)\s+OMIT\s+(.+)$/i);
    if (omitMatch) {
      str = omitMatch[1].trim();
      omit = omitMatch[2].trim();
    }

    // Then extract AS alias
    const asMatch = str.match(/^(.+?)\s+AS\s+(.+)$/i);
    if (asMatch) {
      return { path: asMatch[1].trim(), label: asMatch[2].trim(), omit };
    }
    return { path: str.trim(), label: null, omit };
  }

  return null;
}

/**
 * Resolve a dot-notation path against the schema FK chain.
 *
 * Example: resolveColumnPath("type.manufacturer.name", "Engine", schema)
 *
 * Returns:
 *   {
 *     joins: [{ alias, table, onLeft, onRight }],
 *     selectExpr: 'j_type_manufacturer.name',
 *     label: "Name",
 *     jsType: "string"
 *   }
 */
function resolveColumnPath(dotPath, baseEntityName, schema) {
  const segments = dotPath.split('.');
  const entity = schema.entities[baseEntityName];

  if (!entity) {
    throw new Error(`Base entity "${baseEntityName}" not found in schema`);
  }

  // Single segment: direct column on base table
  if (segments.length === 1) {
    const colName = segments[0];
    const col = entity.columns.find(c => c.name === colName || c.displayName === colName);
    if (!col) {
      throw new Error(`Column "${colName}" not found in entity "${baseEntityName}"`);
    }
    return {
      joins: [],
      selectExpr: `b.${col.name}`,
      label: titleCase(col.displayName || col.name),
      jsType: col.jsType || 'string'
    };
  }

  // Multi-segment: walk FK chain
  const joins = [];
  let currentEntity = entity;
  const pathParts = []; // for building join alias

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    pathParts.push(seg);

    // Find FK column matching this segment name (displayName)
    const fkCol = currentEntity.columns.find(
      c => c.foreignKey && (c.displayName === seg || c.name === seg || c.name === seg + '_id')
    );

    if (!fkCol || !fkCol.foreignKey) {
      throw new Error(
        `FK segment "${seg}" not found in entity "${currentEntity.className}" ` +
        `(path: "${dotPath}", base: "${baseEntityName}")`
      );
    }

    const targetEntityName = fkCol.foreignKey.entity;
    const targetEntity = schema.entities[targetEntityName];

    if (!targetEntity) {
      throw new Error(`FK target entity "${targetEntityName}" not found in schema`);
    }

    const alias = 'j_' + pathParts.join('_');
    const prevAlias = i === 0 ? 'b' : 'j_' + pathParts.slice(0, i).join('_');

    joins.push({
      alias,
      table: targetEntity.tableName,
      onLeft: `${prevAlias}.${fkCol.name}`,
      onRight: `${alias}.id`
    });

    currentEntity = targetEntity;
  }

  // Terminal segment: column on the last joined entity
  const terminalCol = segments[segments.length - 1];
  const col = currentEntity.columns.find(
    c => c.name === terminalCol || c.displayName === terminalCol
  );

  if (!col) {
    throw new Error(
      `Terminal column "${terminalCol}" not found in entity "${currentEntity.className}" ` +
      `(path: "${dotPath}", base: "${baseEntityName}")`
    );
  }

  const lastAlias = 'j_' + pathParts.join('_');

  return {
    joins,
    selectExpr: `${lastAlias}.${col.name}`,
    label: titleCase(col.displayName || col.name),
    jsType: col.jsType || 'string'
  };
}

/**
 * Parse all user view definitions and resolve against schema.
 *
 * @param {Array} viewsConfig - Array from config.json "views" key
 * @param {Object} schema - Full schema object from SchemaGenerator
 * @returns {{ views: ParsedView[], groups: GroupEntry[] }}
 */
function parseAllUserViews(viewsConfig, schema) {
  if (!viewsConfig || !Array.isArray(viewsConfig) || viewsConfig.length === 0) {
    return { views: [], groups: [] };
  }

  const views = [];
  const groups = [];
  let currentGroup = null;

  for (const entry of viewsConfig) {
    // Separator string: "-------------------- Fleet Analysis"
    if (typeof entry === 'string') {
      const label = entry.replace(/^-+\s*/, '').trim();
      currentGroup = label || null;
      const groupColor = Object.values(schema.areas)
          .find(a => a.name === currentGroup)?.color || '#f1f5f9';
      groups.push({ type: 'separator', label: currentGroup, color: groupColor });
      continue;
    }

    if (!entry.name || !entry.base || !entry.columns) {
      logger.warn('Invalid view config entry, skipping', { entry });
      continue;
    }

    const baseEntity = schema.entities[entry.base];
    if (!baseEntity) {
      logger.warn(`View "${entry.name}": base entity "${entry.base}" not found, skipping`);
      continue;
    }

    // Resolve area color
    const areaKey = baseEntity.area;
    const areaColor = schema.areas[areaKey]?.color || '#f5f5f5';

    const parsedView = {
      name: entry.name,
      sqlName: toSqlName(entry.name),
      base: entry.base,
      baseTable: baseEntity.tableName,
      color: areaColor,
      group: currentGroup,
      columns: [],
      joins: []
    };

    // Deduplicate joins by alias
    const joinMap = new Map();

    for (const colEntry of entry.columns) {
      const parsed = parseColumnEntry(colEntry);
      if (!parsed) {
        logger.warn(`View "${entry.name}": invalid column entry, skipping`, { colEntry });
        continue;
      }

      try {
        const resolved = resolveColumnPath(parsed.path, entry.base, schema);
        const label = parsed.label || resolved.label;

        // FK paths (dot notation) default to omit null
        const omit = parsed.omit !== undefined
          ? parsed.omit
          : (parsed.path.includes('.') ? 'null' : undefined);

        parsedView.columns.push({
          path: parsed.path,
          label,
          jsType: resolved.jsType,
          selectExpr: resolved.selectExpr,
          sqlAlias: label,
          omit
        });

        // Collect joins
        for (const join of resolved.joins) {
          if (!joinMap.has(join.alias)) {
            joinMap.set(join.alias, join);
          }
        }
      } catch (err) {
        logger.warn(`View "${entry.name}": column resolution failed`, {
          path: parsed.path,
          error: err.message
        });
      }
    }

    parsedView.joins = Array.from(joinMap.values());

    if (parsedView.columns.length > 0) {
      views.push(parsedView);
      groups.push({ type: 'view', name: entry.name, color: areaColor });
    }
  }

  return { views, groups };
}

/**
 * Generate SQL CREATE VIEW statement for a parsed view.
 *
 * @param {Object} parsedView - Parsed view object from parseAllUserViews
 * @returns {string} SQL statement
 */
function generateUserViewSQL(parsedView) {
  const selectCols = [
    'b.id'
  ];

  for (const col of parsedView.columns) {
    selectCols.push(`${col.selectExpr} AS "${col.sqlAlias}"`);
  }

  const joinClauses = parsedView.joins.map(
    j => `LEFT JOIN ${j.table} ${j.alias} ON ${j.onLeft} = ${j.onRight}`
  );

  const sql = [
    `CREATE VIEW IF NOT EXISTS ${parsedView.sqlName} AS`,
    `SELECT ${selectCols.join(',\n       ')}`,
    `FROM ${parsedView.baseTable} b`
  ];

  if (joinClauses.length > 0) {
    sql.push(joinClauses.join('\n'));
  }

  return sql.join('\n');
}

module.exports = {
  parseAllUserViews,
  generateUserViewSQL,
  toSqlName,
  resolveColumnPath,
  parseColumnEntry
};
