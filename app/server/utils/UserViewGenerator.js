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
      jsType: col.jsType || 'string',
      entityName: baseEntityName
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
    jsType: col.jsType || 'string',
    entityName: currentEntity.className
  };
}

/**
 * Parse back-reference parameter string from inside parentheses.
 *
 * Supports comma-separated directives:
 *   "COUNT"                        → { count: true }
 *   "LIST"                         → { list: true }
 *   "WHERE end_date=null"          → { where: [{ column: "end_date", value: "null" }] }
 *   "ORDER BY start_date DESC"     → { orderBy: { column: "start_date", dir: "DESC" } }
 *   "LIMIT 1"                      → { limit: 1 }
 *
 * @param {string} paramsStr - Raw string from inside parentheses
 * @returns {{ where: Array, orderBy: Object|null, limit: number|null, count: boolean, list: boolean }}
 */
function parseBackRefParams(paramsStr) {
  const result = { where: [], orderBy: null, limit: null, count: false, list: false };

  if (!paramsStr || !paramsStr.trim()) return result;

  const parts = paramsStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (/^COUNT$/i.test(part)) {
      result.count = true;
    } else if (/^LIST$/i.test(part)) {
      result.list = true;
    } else if (/^WHERE\s+/i.test(part)) {
      const whereStr = part.replace(/^WHERE\s+/i, '');
      const eqMatch = whereStr.match(/^(\w+)\s*=\s*(.+)$/);
      if (eqMatch) {
        result.where.push({ column: eqMatch[1], value: eqMatch[2].trim() });
      }
    } else if (/^ORDER\s+BY\s+/i.test(part)) {
      const orderStr = part.replace(/^ORDER\s+BY\s+/i, '');
      const orderMatch = orderStr.match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
      if (orderMatch) {
        result.orderBy = { column: orderMatch[1], dir: (orderMatch[2] || 'ASC').toUpperCase() };
      }
    } else if (/^LIMIT\s+/i.test(part)) {
      const limitMatch = part.match(/^LIMIT\s+(\d+)$/i);
      if (limitMatch) {
        result.limit = parseInt(limitMatch[1], 10);
      }
    }
  }

  return result;
}

/**
 * Resolve a back-reference path against the schema.
 *
 * Syntax: Entity<fk_field(params).outbound.chain.column
 *
 * Examples:
 *   "EngineAllocation<engine(COUNT)"
 *   "EngineAllocation<engine(WHERE end_date=null, LIMIT 1).mount_position"
 *   "EngineAllocation<engine(WHERE end_date=null, LIMIT 1).aircraft.registration"
 *
 * Returns the same interface as resolveColumnPath():
 *   { joins: [], selectExpr: "(SELECT ...)", label, jsType }
 *
 * @param {string} pathStr - Back-reference path expression
 * @param {string} baseEntityName - The view's base entity
 * @param {Object} schema - Full schema object
 */
function resolveBackRefPath(pathStr, baseEntityName, schema) {
  const match = pathStr.match(/^(\w+)<(\w+)\(([^)]*)\)(?:\.(.+))?$/);
  if (!match) {
    throw new Error(`Invalid back-reference syntax: "${pathStr}"`);
  }

  const [, refEntityName, fkFieldName, paramsStr, tailPath] = match;

  // Validate child entity
  const refEntity = schema.entities[refEntityName];
  if (!refEntity) {
    throw new Error(`Back-ref entity "${refEntityName}" not found in schema`);
  }

  // Find FK column in child entity that points to base entity
  const fkCol = refEntity.columns.find(
    c => c.foreignKey && (c.displayName === fkFieldName || c.name === fkFieldName || c.name === fkFieldName + '_id')
  );
  if (!fkCol || !fkCol.foreignKey) {
    throw new Error(
      `FK "${fkFieldName}" not found in entity "${refEntityName}" (back-ref: "${pathStr}")`
    );
  }

  // Verify FK target matches the view's base entity
  if (fkCol.foreignKey.entity !== baseEntityName) {
    throw new Error(
      `FK "${fkFieldName}" in "${refEntityName}" points to "${fkCol.foreignKey.entity}", ` +
      `not "${baseEntityName}" (back-ref: "${pathStr}")`
    );
  }

  const params = parseBackRefParams(paramsStr);

  // Resolve outbound FK tail path (e.g., "aircraft.registration")
  let targetSelectExpr;
  let targetLabel;
  let targetJsType;
  let resolvedEntityName = refEntityName;
  const internalJoins = [];

  if (tailPath) {
    const segments = tailPath.split('.');

    if (segments.length === 1) {
      // Direct column on child entity
      const col = refEntity.columns.find(c => c.name === segments[0] || c.displayName === segments[0]);
      if (!col) {
        throw new Error(
          `Column "${segments[0]}" not found in entity "${refEntityName}" (back-ref: "${pathStr}")`
        );
      }
      targetSelectExpr = `_br.${col.name}`;
      targetLabel = titleCase(col.displayName || col.name);
      targetJsType = col.jsType || 'string';
    } else {
      // Multi-segment: walk FK chain from child entity
      let currentEntity = refEntity;
      let currentAlias = '_br';
      const pathParts = [];

      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        pathParts.push(seg);

        const innerFkCol = currentEntity.columns.find(
          c => c.foreignKey && (c.displayName === seg || c.name === seg || c.name === seg + '_id')
        );

        if (!innerFkCol || !innerFkCol.foreignKey) {
          throw new Error(
            `FK segment "${seg}" not found in entity "${currentEntity.className}" ` +
            `(back-ref tail: "${tailPath}", path: "${pathStr}")`
          );
        }

        const targetEntityName = innerFkCol.foreignKey.entity;
        const targetEntity = schema.entities[targetEntityName];
        if (!targetEntity) {
          throw new Error(`FK target entity "${targetEntityName}" not found in schema`);
        }

        const joinAlias = '_br_' + pathParts.join('_');

        internalJoins.push({
          table: targetEntity.tableName,
          alias: joinAlias,
          onLeft: `${currentAlias}.${innerFkCol.name}`,
          onRight: `${joinAlias}.id`
        });

        currentEntity = targetEntity;
        currentAlias = joinAlias;
      }

      // Terminal column on the last joined entity
      const terminalColName = segments[segments.length - 1];
      const col = currentEntity.columns.find(
        c => c.name === terminalColName || c.displayName === terminalColName
      );
      if (!col) {
        throw new Error(
          `Terminal column "${terminalColName}" not found in entity "${currentEntity.className}" ` +
          `(back-ref tail: "${tailPath}", path: "${pathStr}")`
        );
      }

      targetSelectExpr = `${currentAlias}.${col.name}`;
      targetLabel = titleCase(col.displayName || col.name);
      targetJsType = col.jsType || 'string';
      resolvedEntityName = currentEntity.className;
    }
  }

  // Determine aggregation mode
  const isCount = params.count;
  const isList = params.list;

  if (!isCount && !tailPath) {
    throw new Error(
      `Back-ref requires a target column (.column) or COUNT aggregate (path: "${pathStr}")`
    );
  }

  // Build correlated subquery
  const joinClausesSQL = internalJoins.map(
    j => `LEFT JOIN ${j.table} ${j.alias} ON ${j.onLeft} = ${j.onRight}`
  ).join(' ');

  let whereClause = `_br.${fkCol.name} = b.id`;
  for (const cond of params.where) {
    const condCol = refEntity.columns.find(c => c.name === cond.column || c.displayName === cond.column);
    const colName = condCol ? condCol.name : cond.column;
    if (cond.value === 'null') {
      whereClause += ` AND _br.${colName} IS NULL`;
    } else {
      whereClause += ` AND _br.${colName} = '${cond.value}'`;
    }
  }

  let orderClause = '';
  if (params.orderBy) {
    const orderCol = refEntity.columns.find(
      c => c.name === params.orderBy.column || c.displayName === params.orderBy.column
    );
    const orderColName = orderCol ? orderCol.name : params.orderBy.column;
    orderClause = ` ORDER BY _br.${orderColName} ${params.orderBy.dir}`;
  }

  let selectExpr;
  let label;
  let jsType;

  if (isCount) {
    const fromClause = `${refEntity.tableName} _br`;
    selectExpr = `(SELECT COUNT(*) FROM ${fromClause}${joinClausesSQL ? ' ' + joinClausesSQL : ''} WHERE ${whereClause})`;
    label = 'Count';
    jsType = 'number';
  } else if (isList) {
    const fromClause = `${refEntity.tableName} _br`;
    selectExpr = `(SELECT GROUP_CONCAT(${targetSelectExpr}, ', ') FROM ${fromClause}${joinClausesSQL ? ' ' + joinClausesSQL : ''} WHERE ${whereClause}${orderClause})`;
    label = targetLabel;
    jsType = 'string';
  } else {
    // Scalar mode: implicit LIMIT 1 if not specified
    const limitClause = ` LIMIT ${params.limit || 1}`;
    const fromClause = `${refEntity.tableName} _br`;
    selectExpr = `(SELECT ${targetSelectExpr} FROM ${fromClause}${joinClausesSQL ? ' ' + joinClausesSQL : ''} WHERE ${whereClause}${orderClause}${limitClause})`;
    label = targetLabel;
    jsType = targetJsType;
  }

  return {
    joins: [],
    selectExpr,
    label,
    jsType,
    entityName: resolvedEntityName
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
        const isBackRef = parsed.path.includes('<');
        const resolved = isBackRef
          ? resolveBackRefPath(parsed.path, entry.base, schema)
          : resolveColumnPath(parsed.path, entry.base, schema);
        const label = parsed.label || resolved.label;

        // FK paths (dot notation) default to omit null
        const omit = parsed.omit !== undefined
          ? parsed.omit
          : (parsed.path.includes('.') ? 'null' : undefined);

        // Look up area color for the entity this column belongs to
        const colEntity = schema.entities[resolved.entityName];
        const colAreaColor = colEntity
          ? (schema.areas[colEntity.area]?.color || '#f5f5f5')
          : '#f5f5f5';

        parsedView.columns.push({
          path: parsed.path,
          label,
          jsType: resolved.jsType,
          selectExpr: resolved.selectExpr,
          sqlAlias: label,
          omit,
          areaColor: colAreaColor
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
  resolveBackRefPath,
  parseColumnEntry,
  parseBackRefParams
};
