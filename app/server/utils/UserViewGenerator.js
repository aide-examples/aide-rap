/**
 * UserViewGenerator - Parse config-defined views and generate SQL
 *
 * Resolves dot-notation path expressions (e.g. "type.manufacturer.name")
 * against the schema FK chain and produces CREATE VIEW statements.
 */

const logger = require('./logger');
const { toSnakeCase, buildLabelSQLWithJoins } = require('./SchemaGenerator');
const { COLUMN_BREAK } = require('./UISpecLoader');

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
 * Find FK column by segment name.
 * Matches: displayName, name, or name + '_id' suffix.
 * @param {Object} entity - Entity with columns array
 * @param {string} segmentName - Path segment to match
 * @returns {Object|undefined} - Matching FK column or undefined
 */
function findFKColumn(entity, segmentName) {
  return entity.columns.find(
    c => c.foreignKey && (c.displayName === segmentName || c.name === segmentName || c.name === segmentName + '_id')
  );
}

/**
 * Parse a single column config entry into { path, label, omit, expandAggregate }
 *
 * Supports:
 *   "serial_number"                        → { path: "serial_number", label: null, omit: undefined }
 *   "type.designation AS Engine Type"      → { path: "type.designation", label: "Engine Type", omit: undefined }
 *   "mount_position AS pos OMIT 0"        → { path: "mount_position", label: "pos", omit: "0" }
 *   "total_cycles OMIT 0"                 → { path: "total_cycles", label: null, omit: "0" }
 *   "position.*"                          → { path: "position", expandAggregate: true }
 *   { path: "type.manufacturer.name", label: "OEM" }           → as-is
 *   { path: "total_cycles", label: "Cycles", omit: 0 }         → omit: "0"
 */
function parseColumnEntry(entry) {
  if (typeof entry === 'object' && entry.path) {
    // Check for expandAggregate flag or .* suffix
    let path = entry.path;
    let expandAggregate = entry.expandAggregate || false;
    if (path.endsWith('.*')) {
      path = path.slice(0, -2);
      expandAggregate = true;
    }
    return {
      path,
      label: entry.label || null,
      omit: entry.omit !== undefined ? String(entry.omit) : undefined,
      expandAggregate
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
      let path = asMatch[1].trim();
      let expandAggregate = false;
      if (path.endsWith('.*')) {
        path = path.slice(0, -2);
        expandAggregate = true;
      }
      return { path, label: asMatch[2].trim(), omit, expandAggregate };
    }

    // Check for .* suffix (expand aggregate)
    let path = str.trim();
    let expandAggregate = false;
    if (path.endsWith('.*')) {
      path = path.slice(0, -2);
      expandAggregate = true;
    }
    return { path, label: null, omit, expandAggregate };
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
      // Check if it's an aggregate source
      const aggregateCols = entity.columns.filter(c => c.aggregateSource === colName);
      if (aggregateCols.length > 0) {
        return {
          isAggregate: true,
          aggregateSource: colName,
          aggregateType: aggregateCols[0].aggregateType,
          targetEntity: entity,
          pathStr: colName
        };
      }
      throw new Error(`Column "${colName}" not found in entity "${baseEntityName}"`);
    }

    // If this is a FK column, auto-resolve to the target entity's label
    if (col.foreignKey) {
      const targetEntityName = col.foreignKey.entity;
      const targetEntity = schema.entities[targetEntityName];

      if (!targetEntity) {
        throw new Error(`FK target entity "${targetEntityName}" not found in schema`);
      }

      // Find label column in target entity (ui.label from [LABEL] annotation)
      const labelCol = targetEntity.columns.find(c => c.ui?.label) ||
                       targetEntity.columns.find(c => c.name === 'name' || c.name === 'designation' || c.name === 'title');

      // Build join to target entity
      const alias = 'j_' + (col.displayName || colName);
      const join = {
        alias,
        table: targetEntity.tableName,
        onLeft: `b.${col.name}`,
        onRight: `${alias}.id`
      };

      // Entity with labelExpression: build computed label SQL
      if (targetEntity.labelExpression) {
        const joinCounter = { value: 0 };
        const result = buildLabelSQLWithJoins(
          targetEntity.labelExpression, alias, targetEntity, schema, joinCounter
        );

        // Make label join aliases unique by prefixing with parent alias
        const prefix = alias + '_';
        const renames = result.joins.map(j => ({ old: j.alias, new: prefix + j.alias }));

        let selectExpr = result.sql;
        for (const r of renames) {
          selectExpr = selectExpr.replaceAll(r.old + '.', r.new + '.');
        }

        const extraJoins = result.joins.map(j => {
          let onLeft = j.onLeft;
          let onRight = j.onRight;
          for (const r of renames) {
            onLeft = onLeft.replaceAll(r.old + '.', r.new + '.');
            onRight = onRight.replaceAll(r.old + '.', r.new + '.');
          }
          return { ...j, alias: prefix + j.alias, onLeft, onRight };
        });

        return {
          joins: [join, ...extraJoins],
          selectExpr,
          label: titleCase(col.displayName || col.name),
          jsType: 'string',
          entityName: targetEntityName,
          fkInfo: {
            fkEntity: targetEntityName,
            fkIdExpr: `b.${col.name}`
          }
        };
      }

      if (!labelCol) {
        // Fallback: just return the FK id (no join)
        return {
          joins: [],
          selectExpr: `b.${col.name}`,
          label: titleCase(col.displayName || col.name),
          jsType: col.jsType || 'string',
          entityName: baseEntityName
        };
      }

      return {
        joins: [join],
        selectExpr: `${alias}.${labelCol.name}`,
        label: titleCase(col.displayName || col.name),
        jsType: labelCol.jsType || 'string',
        entityName: targetEntityName,
        fkInfo: {
          fkEntity: targetEntityName,
          fkIdExpr: `b.${col.name}`
        }
      };
    }

    return {
      joins: [],
      selectExpr: `b.${col.name}`,
      label: titleCase(col.displayName || col.name),
      jsType: col.jsType || 'string',
      entityName: baseEntityName,
      truncate: col.ui?.truncate || null,  // Inherit [TRUNCATE=n] from entity column
      nowrap: col.ui?.nowrap || null       // Inherit [NOWRAP] from entity column
    };
  }

  // Multi-segment: walk FK chain
  const joins = [];
  let currentEntity = entity;
  const pathParts = []; // for building join alias

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    pathParts.push(seg);

    // Find FK column matching this segment name
    const fkCol = findFKColumn(currentEntity, seg);

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
  const lastAlias = 'j_' + pathParts.join('_');

  // Handle _label: computed label expression (e.g., aircraft._label → concat(type, '-', msn))
  if (terminalCol === '_label' && currentEntity.labelExpression) {
    const joinCounter = { value: 0 };
    const result = buildLabelSQLWithJoins(
      currentEntity.labelExpression, lastAlias, currentEntity, schema, joinCounter
    );

    // Make label join aliases unique by prefixing with parent alias
    const prefix = lastAlias + '_';
    const renames = result.joins.map(j => ({ old: j.alias, new: prefix + j.alias }));

    let selectExpr = result.sql;
    for (const r of renames) {
      selectExpr = selectExpr.replaceAll(r.old + '.', r.new + '.');
    }

    const extraJoins = result.joins.map(j => {
      let onLeft = j.onLeft;
      let onRight = j.onRight;
      for (const r of renames) {
        onLeft = onLeft.replaceAll(r.old + '.', r.new + '.');
        onRight = onRight.replaceAll(r.old + '.', r.new + '.');
      }
      return { ...j, alias: prefix + j.alias, onLeft, onRight };
    });

    return {
      joins: [...joins, ...extraJoins],
      selectExpr,
      label: titleCase(currentEntity.className),
      jsType: 'string',
      entityName: currentEntity.className,
      fkInfo: {
        fkEntity: currentEntity.className,
        fkIdExpr: `${lastAlias}.id`
      }
    };
  }

  const col = currentEntity.columns.find(
    c => c.name === terminalCol || c.displayName === terminalCol
  );

  if (!col) {
    // Check if it's an aggregate source
    const aggregateCols = currentEntity.columns.filter(c => c.aggregateSource === terminalCol);
    if (aggregateCols.length > 0) {
      return {
        isAggregate: true,
        aggregateSource: terminalCol,
        aggregateType: aggregateCols[0].aggregateType,
        targetEntity: currentEntity,
        pathStr: dotPath,
        joins  // Include joins for FK path
      };
    }
    throw new Error(
      `Terminal column "${terminalCol}" not found in entity "${currentEntity.className}" ` +
      `(path: "${dotPath}", base: "${baseEntityName}")`
    );
  }

  // Build FK link info for navigation
  // fkEntity: target entity name for the link
  // fkIdExpr: SQL expression to get the FK target's id
  const fkInfo = {
    fkEntity: currentEntity.className,
    fkIdExpr: `${lastAlias}.id`
  };

  return {
    joins,
    selectExpr: `${lastAlias}.${col.name}`,
    label: titleCase(col.displayName || col.name),
    jsType: col.jsType || 'string',
    entityName: currentEntity.className,
    fkInfo
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
  const fkCol = findFKColumn(refEntity, fkFieldName);
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
  let isLabelColumn = false;  // Track if terminal column is [LABEL]
  const internalJoins = [];

  if (tailPath) {
    const segments = tailPath.split('.');

    if (segments.length === 1) {
      // Direct column on child entity
      const col = refEntity.columns.find(c => c.name === segments[0] || c.displayName === segments[0]);
      if (!col) {
        // Check if it's an aggregate source (e.g., "position" → position_latitude, position_longitude)
        const aggregateCols = refEntity.columns.filter(c => c.aggregateSource === segments[0]);
        if (aggregateCols.length > 0) {
          // Return aggregate marker - caller will expand to multiple columns
          return {
            isAggregate: true,
            aggregateSource: segments[0],
            aggregateType: aggregateCols[0].aggregateType,
            targetEntity: refEntity,
            pathStr
          };
        } else {
          throw new Error(
            `Column "${segments[0]}" not found in entity "${refEntityName}" (back-ref: "${pathStr}")`
          );
        }
      } else {
        targetSelectExpr = `_br.${col.name}`;
        targetLabel = titleCase(col.displayName || col.name);
        targetJsType = col.jsType || 'string';
        isLabelColumn = !!col.ui?.label;
      }
    } else {
      // Multi-segment: walk FK chain from child entity
      let currentEntity = refEntity;
      let currentAlias = '_br';
      const pathParts = [];

      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        pathParts.push(seg);

        const innerFkCol = findFKColumn(currentEntity, seg);

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
        // Check if it's an aggregate source
        const aggregateCols = currentEntity.columns.filter(c => c.aggregateSource === terminalColName);
        if (aggregateCols.length > 0) {
          // Return aggregate marker - caller will expand to multiple columns
          return {
            isAggregate: true,
            aggregateSource: terminalColName,
            aggregateType: aggregateCols[0].aggregateType,
            targetEntity: currentEntity,
            pathStr
          };
        } else {
          throw new Error(
            `Terminal column "${terminalColName}" not found in entity "${currentEntity.className}" ` +
            `(back-ref tail: "${tailPath}", path: "${pathStr}")`
          );
        }
      } else {
        targetSelectExpr = `${currentAlias}.${col.name}`;
        targetLabel = titleCase(col.displayName || col.name);
        targetJsType = col.jsType || 'string';
      }
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

  // Build FK link info for scalar back-references (LIMIT 1)
  // Only generate link if the column is the LABEL of the back-ref entity
  // This makes the displayed value clickable to navigate to the referenced record
  let fkInfo = null;
  if (!isCount && !isList && isLabelColumn) {
    const fromClause = `${refEntity.tableName} _br`;
    const limitVal = params.limit || 1;
    fkInfo = {
      fkEntity: refEntityName,
      fkIdExpr: `(SELECT _br.id FROM ${fromClause}${joinClausesSQL ? ' ' + joinClausesSQL : ''} WHERE ${whereClause}${orderClause} LIMIT ${limitVal})`
    };
  }

  return {
    joins: [],
    selectExpr,
    label,
    jsType,
    entityName: resolvedEntityName,
    fkInfo
  };
}

/**
 * Expand a back-reference path with aggregate type into individual columns.
 *
 * Supports:
 *   "EngineTracker<stand(LIMIT 1).position" → expands to position_latitude, position_longitude subqueries
 *
 * @param {string} pathStr - Back-reference path (without .* suffix)
 * @param {string} baseEntityName - The view's base entity
 * @param {Object} schema - Full schema object
 * @param {string|null} labelPrefix - Optional custom label prefix
 * @param {boolean} includeMetadata - Include aggregateSource/Type/Field for client-side grouping
 * @returns {Array<{ path, label, jsType, selectExpr, entityName, [aggregateSource], [aggregateType], [aggregateField] }>}
 */
function expandBackRefAggregateColumns(pathStr, baseEntityName, schema, labelPrefix = null, includeMetadata = false) {
  // Parse back-ref: Entity<fk(params).tailPath
  const match = pathStr.match(/^(\w+)<(\w+)\(([^)]*)\)(?:\.(.+))?$/);
  if (!match) {
    throw new Error(`Invalid back-reference syntax for aggregate expansion: "${pathStr}"`);
  }

  const [, refEntityName, fkFieldName, paramsStr, tailPath] = match;

  // Validate child entity
  const refEntity = schema.entities[refEntityName];
  if (!refEntity) {
    throw new Error(`Back-ref entity "${refEntityName}" not found in schema`);
  }

  // Find FK column in child entity that points to base entity
  const fkCol = findFKColumn(refEntity, fkFieldName);
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

  // Find aggregate columns in the child entity (or follow FK chain for tailPath)
  let targetEntity = refEntity;
  let aggregateSource = tailPath || '';
  const internalJoins = [];
  let currentAlias = '_br';

  if (tailPath && tailPath.includes('.')) {
    // Multi-segment tail: follow FK chain
    const segments = tailPath.split('.');
    aggregateSource = segments[segments.length - 1];
    const pathParts = [];

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      pathParts.push(seg);

      const innerFkCol = findFKColumn(targetEntity, seg);

      if (!innerFkCol || !innerFkCol.foreignKey) {
        throw new Error(
          `FK segment "${seg}" not found in entity "${targetEntity.className}" ` +
          `(back-ref tail: "${tailPath}", path: "${pathStr}")`
        );
      }

      const nextEntityName = innerFkCol.foreignKey.entity;
      const nextEntity = schema.entities[nextEntityName];
      if (!nextEntity) {
        throw new Error(`FK target entity "${nextEntityName}" not found in schema`);
      }

      const joinAlias = '_br_' + pathParts.join('_');

      internalJoins.push({
        table: nextEntity.tableName,
        alias: joinAlias,
        onLeft: `${currentAlias}.${innerFkCol.name}`,
        onRight: `${joinAlias}.id`
      });

      currentAlias = joinAlias;
      targetEntity = nextEntity;
    }
  }

  // Find aggregate columns in target entity
  const aggregateCols = targetEntity.columns.filter(c => c.aggregateSource === aggregateSource);

  if (aggregateCols.length === 0) {
    throw new Error(
      `No aggregate columns found for "${aggregateSource}" in entity "${targetEntity.className}" ` +
      `(path: "${pathStr}.*", base: "${baseEntityName}")`
    );
  }

  // Build WHERE clause
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

  // Build ORDER BY clause
  let orderClause = '';
  if (params.orderBy) {
    const orderCol = refEntity.columns.find(
      c => c.name === params.orderBy.column || c.displayName === params.orderBy.column
    );
    const orderColName = orderCol ? orderCol.name : params.orderBy.column;
    orderClause = ` ORDER BY _br.${orderColName} ${params.orderBy.dir}`;
  }

  // Build JOIN clauses for internal FKs
  const joinClausesSQL = internalJoins.map(
    j => `LEFT JOIN ${j.table} ${j.alias} ON ${j.onLeft} = ${j.onRight}`
  ).join(' ');

  const limitClause = ` LIMIT ${params.limit || 1}`;
  const fromClause = `${refEntity.tableName} _br`;

  // Create a column for each aggregate field
  const results = [];
  const prefix = labelPrefix || titleCase(aggregateSource);

  for (const col of aggregateCols) {
    const fieldLabel = titleCase(col.aggregateField);
    const selectExpr = `${currentAlias}.${col.name}`;

    const subquery = `(SELECT ${selectExpr} FROM ${fromClause}${joinClausesSQL ? ' ' + joinClausesSQL : ''} WHERE ${whereClause}${orderClause}${limitClause})`;

    const result = {
      path: `${pathStr}.${col.aggregateField}`,
      label: `${prefix} ${fieldLabel}`,
      jsType: col.jsType || 'string',
      selectExpr: subquery,
      entityName: targetEntity.className
    };

    // Add metadata for client-side grouping (when not using .* syntax)
    if (includeMetadata) {
      result.aggregateSource = aggregateSource;
      result.aggregateType = col.aggregateType;
      result.aggregateField = col.aggregateField;
    }

    results.push(result);
  }

  return results;
}

/**
 * Expand an aggregate type column into its individual subfield columns.
 *
 * Supports:
 *   "position"                    → expands position_latitude, position_longitude from base entity
 *   "tracker.position"            → walks FK chain, then expands aggregate from final entity
 *
 * @param {string} path - Column path (without .* suffix)
 * @param {string} baseEntityName - The view's base entity
 * @param {Object} schema - Full schema object
 * @param {string|null} labelPrefix - Optional custom label prefix
 * @param {boolean} includeMetadata - Include aggregateSource/Type/Field for client-side grouping
 * @returns {Array<{ path, label, jsType, selectExpr, joins, entityName, [aggregateSource], [aggregateType], [aggregateField] }>}
 */
function expandAggregateColumns(path, baseEntityName, schema, labelPrefix = null, includeMetadata = false) {
  const results = [];
  const segments = path.split('.');

  // Walk FK chain to find target entity and build joins
  let currentEntity = schema.entities[baseEntityName];
  if (!currentEntity) {
    throw new Error(`Base entity "${baseEntityName}" not found in schema`);
  }

  const joins = [];
  const pathParts = [];
  let prevAlias = 'b';

  // All segments are FK segments (we're looking for aggregate field at the end)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    pathParts.push(seg);

    // Check if this segment is a direct aggregate field on current entity
    const aggregateCols = currentEntity.columns.filter(c => c.aggregateSource === seg);
    if (aggregateCols.length > 0) {
      // Found aggregate columns - expand them
      const prefix = labelPrefix || titleCase(seg);
      for (const col of aggregateCols) {
        const fieldLabel = titleCase(col.aggregateField);
        const result = {
          path: segments.slice(0, i).concat([col.name]).join('.') || col.name,
          label: `${prefix} ${fieldLabel}`,
          jsType: col.jsType || 'string',
          selectExpr: `${prevAlias}.${col.name}`,
          joins: [...joins],
          entityName: currentEntity.className
        };
        if (includeMetadata) {
          result.aggregateSource = seg;
          result.aggregateType = col.aggregateType;
          result.aggregateField = col.aggregateField;
        }
        results.push(result);
      }
      return results;
    }

    // Not an aggregate, must be FK segment
    const fkCol = findFKColumn(currentEntity, seg);

    if (!fkCol || !fkCol.foreignKey) {
      throw new Error(
        `FK segment "${seg}" not found in entity "${currentEntity.className}" ` +
        `(expand aggregate path: "${path}", base: "${baseEntityName}")`
      );
    }

    const targetEntityName = fkCol.foreignKey.entity;
    const targetEntity = schema.entities[targetEntityName];

    if (!targetEntity) {
      throw new Error(`FK target entity "${targetEntityName}" not found in schema`);
    }

    const alias = 'j_' + pathParts.join('_');

    joins.push({
      alias,
      table: targetEntity.tableName,
      onLeft: `${prevAlias}.${fkCol.name}`,
      onRight: `${alias}.id`
    });

    prevAlias = alias;
    currentEntity = targetEntity;
  }

  // If we get here, the last segment should be an aggregate source
  const lastSeg = segments[segments.length - 1];
  const aggregateCols = currentEntity.columns.filter(c => c.aggregateSource === lastSeg);

  if (aggregateCols.length === 0) {
    throw new Error(
      `No aggregate columns found for "${lastSeg}" in entity "${currentEntity.className}" ` +
      `(path: "${path}.*", base: "${baseEntityName}")`
    );
  }

  const prefix = labelPrefix || titleCase(lastSeg);
  for (const col of aggregateCols) {
    const fieldLabel = titleCase(col.aggregateField);
    const result = {
      path: path + '.' + col.name.split('_').pop(), // e.g., position.latitude
      label: `${prefix} ${fieldLabel}`,
      jsType: col.jsType || 'string',
      selectExpr: `${prevAlias}.${col.name}`,
      joins: [...joins],
      entityName: currentEntity.className
    };
    if (includeMetadata) {
      result.aggregateSource = lastSeg;
      result.aggregateType = col.aggregateType;
      result.aggregateField = col.aggregateField;
    }
    results.push(result);
  }

  return results;
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
    // Column break marker
    if (entry === COLUMN_BREAK) {
      groups.push({ type: 'column_break' });
      continue;
    }

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

    // Parse sort configuration: "column", "column DESC", or { column, order }
    let defaultSort = null;
    if (entry.sort) {
      if (typeof entry.sort === 'string') {
        const parts = entry.sort.trim().split(/\s+/);
        defaultSort = {
          column: parts[0],
          order: (parts[1] || 'asc').toLowerCase()
        };
      } else if (typeof entry.sort === 'object') {
        defaultSort = {
          column: entry.sort.column,
          order: (entry.sort.order || 'asc').toLowerCase()
        };
      }
    }

    const parsedView = {
      name: entry.name,
      sqlName: toSqlName(entry.name),
      base: entry.base,
      baseTable: baseEntity.tableName,
      color: areaColor,
      group: currentGroup,
      columns: [],
      joins: [],
      calculator: entry.calculator || null,
      prefilter: entry.prefilter || null,
      requiredFilter: entry.requiredFilter || null,
      defaultSort: defaultSort,
      chart: entry.chart || null,
      filter: entry.filter || null  // SQL WHERE clause for view-level filtering
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
        // Handle .* expansion for aggregate types
        if (parsed.expandAggregate) {
          const isBackRef = parsed.path.includes('<');

          if (isBackRef) {
            // Back-reference with aggregate expansion
            const expandedCols = expandBackRefAggregateColumns(parsed.path, entry.base, schema, parsed.label);
            for (const expCol of expandedCols) {
              const omit = parsed.omit !== undefined ? parsed.omit : 'null';

              const colEntity = schema.entities[expCol.entityName];
              const colAreaColor = colEntity
                ? (schema.areas[colEntity.area]?.color || '#f5f5f5')
                : '#f5f5f5';

              parsedView.columns.push({
                path: expCol.path,
                label: expCol.label,
                jsType: expCol.jsType,
                selectExpr: expCol.selectExpr,
                sqlAlias: expCol.label,
                omit,
                areaColor: colAreaColor,
                entityName: expCol.entityName
              });
            }
          } else {
            // Regular path with aggregate expansion
            const expandedCols = expandAggregateColumns(parsed.path, entry.base, schema, parsed.label);
            for (const expCol of expandedCols) {
              // FK paths default to omit null
              const omit = parsed.omit !== undefined
                ? parsed.omit
                : (expCol.path.includes('.') ? 'null' : undefined);

              const colEntity = schema.entities[expCol.entityName];
              const colAreaColor = colEntity
                ? (schema.areas[colEntity.area]?.color || '#f5f5f5')
                : '#f5f5f5';

              parsedView.columns.push({
                path: expCol.path,
                label: expCol.label,
                jsType: expCol.jsType,
                selectExpr: expCol.selectExpr,
                sqlAlias: expCol.label,
                omit,
                areaColor: colAreaColor,
                entityName: expCol.entityName
              });

              for (const join of expCol.joins) {
                if (!joinMap.has(join.alias)) {
                  joinMap.set(join.alias, join);
                }
              }
            }
          }
          continue;
        }

        const isBackRef = parsed.path.includes('<');
        const resolved = isBackRef
          ? resolveBackRefPath(parsed.path, entry.base, schema)
          : resolveColumnPath(parsed.path, entry.base, schema);

        // Check if this is an aggregate type (without .* suffix)
        // If so, expand to multiple columns with metadata for client-side grouping
        if (resolved.isAggregate) {
          // Expand aggregate with metadata for client-side canonical formatting
          const expandedCols = isBackRef
            ? expandBackRefAggregateColumns(parsed.path, entry.base, schema, parsed.label, true)
            : expandAggregateColumns(parsed.path, entry.base, schema, parsed.label, true);

          for (const expCol of expandedCols) {
            const omit = parsed.omit !== undefined ? parsed.omit : 'null';

            const colEntity = schema.entities[expCol.entityName];
            const colAreaColor = colEntity
              ? (schema.areas[colEntity.area]?.color || '#f5f5f5')
              : '#f5f5f5';

            parsedView.columns.push({
              path: expCol.path,
              label: expCol.label,
              jsType: expCol.jsType,
              selectExpr: expCol.selectExpr,
              sqlAlias: expCol.label,
              omit,
              areaColor: colAreaColor,
              entityName: expCol.entityName,  // Entity this column belongs to (for diagrams)
              // Aggregate metadata for client-side grouping
              aggregateSource: expCol.aggregateSource,
              aggregateType: expCol.aggregateType,
              aggregateField: expCol.aggregateField
            });

            // Collect joins for regular paths
            if (expCol.joins) {
              for (const join of expCol.joins) {
                if (!joinMap.has(join.alias)) {
                  joinMap.set(join.alias, join);
                }
              }
            }
          }
          continue;
        }

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

        const colDef = {
          path: parsed.path,
          label,
          jsType: resolved.jsType,
          selectExpr: resolved.selectExpr,
          sqlAlias: label,
          omit,
          areaColor: colAreaColor,
          entityName: resolved.entityName,  // Entity this column belongs to (for diagrams)
          truncate: resolved.truncate || null,  // Inherit [TRUNCATE=n] from entity column
          nowrap: resolved.nowrap || null       // Inherit [NOWRAP] from entity column
        };

        // Add FK link info for navigation (FK paths only)
        if (resolved.fkInfo) {
          colDef.fkEntity = resolved.fkInfo.fkEntity;
          colDef.fkIdExpr = resolved.fkInfo.fkIdExpr;
          colDef.fkIdColumn = `_fk_${label}`;  // Hidden column name for the FK id
        }

        parsedView.columns.push(colDef);

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

    // Auto-add dependencies for [CALCULATED] fields
    const addedDeps = new Set();
    for (const col of [...parsedView.columns]) {  // Iterate over copy to allow modification
      // Only check simple column names (not FK paths) in base entity
      if (!col.path.includes('.') && !col.path.includes('<')) {
        const baseCol = baseEntity.columns.find(c => c.name === col.path);
        if (baseCol?.calculated?.depends) {
          for (const dep of baseCol.calculated.depends) {
            // Skip if dependency is already in view or already added
            const alreadyInView = parsedView.columns.some(c =>
              c.path === dep || c.path === dep.replace('_id', '') // Handle FK notation
            );
            if (!alreadyInView && !addedDeps.has(dep)) {
              addedDeps.add(dep);
              // Resolve the dependency column
              try {
                const resolved = resolveColumnPath(dep, entry.base, schema);
                parsedView.columns.push({
                  path: dep,
                  label: resolved.label,
                  jsType: resolved.jsType,
                  selectExpr: resolved.selectExpr,
                  sqlAlias: dep,  // Use original column name as key for calculation compatibility
                  autoHidden: true,  // Mark as auto-added for calculated field
                  areaColor: areaColor
                });
                // Add joins if needed
                for (const join of resolved.joins) {
                  if (!joinMap.has(join.alias)) {
                    joinMap.set(join.alias, join);
                  }
                }
              } catch (err) {
                logger.warn(`View "${entry.name}": failed to auto-add dependency "${dep}"`, {
                  error: err.message
                });
              }
            }
          }
          // Also attach the calculated definition to the column for client-side execution
          col.calculated = baseCol.calculated;
        }
      }
    }
    // Update joins after adding dependencies
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
    // Add hidden FK id column for navigation links
    if (col.fkIdExpr && col.fkIdColumn) {
      selectCols.push(`${col.fkIdExpr} AS "${col.fkIdColumn}"`);
    }
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

  // Add WHERE clause if filter is specified
  if (parsedView.filter) {
    // Replace unqualified column names with b. prefix for base table columns
    // But preserve already qualified names (containing .)
    let whereClause = parsedView.filter;
    sql.push(`WHERE ${whereClause}`);
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
