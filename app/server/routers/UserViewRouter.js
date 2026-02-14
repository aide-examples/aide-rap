/**
 * UserViewRouter - REST API for user-defined views
 *
 * GET /api/views                  - List views with groups/colors
 * GET /api/views/:name            - Query view data (filter, sort, pagination)
 * GET /api/views/:name/schema     - Column metadata for UI rendering
 */

const express = require('express');
const logger = require('../utils/logger');
const { parseFilter, buildWhereClause } = require('../utils/FilterParser');

/**
 * Build view summary for list response
 */
function buildViewSummary(v) {
  const requiredFilterEntities = [];
  for (const spec of (v.requiredFilter || [])) {
    const fieldPath = spec.replace(/:(\w+)$/, '');
    const fkPrefix = fieldPath.split('.')[0];
    const col = v.columns.find(c => c.fkEntity && c.path && c.path.split('.')[0] === fkPrefix);
    if (col) {
      requiredFilterEntities.push({ entity: col.fkEntity, viewColumn: col.sqlAlias });
    }
  }
  return {
    name: v.name,
    base: v.base,
    color: v.color,
    group: v.group,
    columns: v.columns.map(c => c.label),
    ...(v.description ? { description: v.description } : {}),
    ...(v.detail ? { detail: true } : {}),
    ...(requiredFilterEntities.length > 0 ? { requiredFilterEntities } : {})
  };
}

/**
 * Build view schema response (column metadata for UI)
 */
function buildViewSchema(view) {
  const hasGeo = view.columns.some(c => c.aggregateType === 'geo');
  return {
    name: view.name,
    base: view.base,
    color: view.color,
    hasGeo,
    columns: view.columns.map(c => {
      const col = { key: c.sqlAlias, label: c.label, type: c.jsType };
      if (c.path) col.path = c.path;
      if (c.omit !== undefined) col.omit = c.omit;
      if (c.areaColor) col.areaColor = c.areaColor;
      if (c.calculated) col.calculated = c.calculated;
      if (c.autoHidden) col.autoHidden = c.autoHidden;
      if (c.aggregateSource) col.aggregateSource = c.aggregateSource;
      if (c.aggregateType) col.aggregateType = c.aggregateType;
      if (c.aggregateField) col.aggregateField = c.aggregateField;
      if (c.fkEntity) col.fkEntity = c.fkEntity;
      if (c.fkIdColumn) col.fkIdColumn = c.fkIdColumn;
      return col;
    }),
    ...(view.calculator ? { calculator: view.calculator } : {}),
    ...(view.prefilter ? { prefilter: view.prefilter } : {}),
    ...(view.requiredFilter ? { requiredFilter: view.requiredFilter } : {}),
    ...(view.defaultSort ? { defaultSort: view.defaultSort } : {}),
    ...(view.chart ? { chart: view.chart } : {}),
    ...(view.description ? { description: view.description } : {}),
    ...(view.detail ? { detail: true, template: view.template } : {})
  };
}

/**
 * Resolve an attribute value from an entity view row.
 * FK display names (e.g., "type") are resolved to their _label column.
 */
function resolveAttr(entity, row, attr) {
  const fk = entity.foreignKeys.find(fk => fk.displayName === attr);
  if (fk) return row[attr + '_label'] ?? row[fk.column] ?? null;
  return row[attr] ?? null;
}

/**
 * Query a detail view template and return nested JSON.
 * Uses entity SQL views (vw_*) for automatic FK label resolution.
 */
function queryDetailView(view, field, value, schema, db) {
  const tpl = view.template;
  const baseEntity = schema.entities[tpl.base];
  if (!baseEntity) return { error: `Base entity "${tpl.base}" not found`, status: 500 };

  // Resolve filter field: FK displayName → _label column, _label → _label
  let sqlField = field;
  const fk = baseEntity.foreignKeys.find(fk => fk.displayName === field);
  if (fk) sqlField = field + '_label';

  const viewName = `${baseEntity.tableName}_view`;
  const baseRow = db.prepare(`SELECT * FROM ${viewName} WHERE "${sqlField}" = ?`).get(value);
  if (!baseRow) return { error: `No ${tpl.base} found with ${field} = ${value}`, status: 404 };

  // Build root record from template attributes
  const result = { id: baseRow.id };
  for (const attr of (tpl.rootAttributes || [])) {
    result[attr] = resolveAttr(baseEntity, baseRow, attr);
  }

  // Process children (back-refs and FK drill-downs)
  for (const child of (tpl.children || [])) {
    if (child.type === 'backref') {
      result[child.entity] = queryBackRefNode(child, baseRow.id, tpl.base, schema, db);
    } else if (child.type === 'fk') {
      const fkData = queryFkNode(child, baseRow, baseEntity, schema, db);
      // Preserve attribute label on FK drill-down object (attribute may already exist)
      if (fkData && result[child.field] !== undefined) {
        fkData._label = result[child.field];
      }
      result[child.field] = fkData;
    }
  }

  return { data: result };
}

function queryBackRefNode(node, parentId, parentEntityName, schema, db) {
  const childEntity = schema.entities[node.entity];
  if (!childEntity) return [];

  const fkToParent = childEntity.foreignKeys.find(fk => fk.references.entity === parentEntityName);
  if (!fkToParent) return [];

  // Build SQL with optional ORDER BY / LIMIT from template params
  let sql = `SELECT * FROM ${childEntity.tableName}_view WHERE "${fkToParent.column}" = ?`;
  if (node.params) {
    // Template params: "ORDER BY start_date DESC, LIMIT 5" → fix comma before LIMIT
    sql += ' ' + node.params.replace(/,\s*LIMIT/i, ' LIMIT');
  }

  const rows = db.prepare(sql).all(parentId);
  return rows.map(row => {
    const record = { id: row.id };
    for (const attr of (node.attributes || [])) {
      record[attr] = resolveAttr(childEntity, row, attr);
    }
    for (const child of (node.children || [])) {
      if (child.type === 'fk') {
        const fkData = queryFkNode(child, row, childEntity, schema, db);
        if (fkData && record[child.field] !== undefined) {
          fkData._label = record[child.field];
        }
        record[child.field] = fkData;
      } else if (child.type === 'backref') {
        record[child.entity] = queryBackRefNode(child, row.id, node.entity, schema, db);
      }
    }
    return record;
  });
}

function queryFkNode(node, parentRow, parentEntity, schema, db) {
  const fk = parentEntity.foreignKeys.find(fk => fk.displayName === node.field);
  if (!fk) return null;

  const fkId = parentRow[fk.column];
  if (!fkId) return null;

  const refEntity = schema.entities[fk.references.entity];
  if (!refEntity) return null;

  const row = db.prepare(`SELECT * FROM ${refEntity.tableName}_view WHERE id = ?`).get(fkId);
  if (!row) return null;

  const record = { id: row.id };
  for (const attr of (node.attributes || [])) {
    record[attr] = resolveAttr(refEntity, row, attr);
  }
  for (const child of (node.children || [])) {
    if (child.type === 'fk') {
      const fkData = queryFkNode(child, row, refEntity, schema, db);
      if (fkData && record[child.field] !== undefined) {
        fkData._label = record[child.field];
      }
      record[child.field] = fkData;
    } else if (child.type === 'backref') {
      record[child.entity] = queryBackRefNode(child, row.id, fk.references.entity, schema, db);
    }
  }
  return record;
}

module.exports = function() {
  const router = express.Router();
  const { getSchema, getDatabase } = require('../config/database');

  /**
   * Find a parsed view by display name
   */
  function findView(name) {
    const schema = getSchema();
    if (!schema.userViews) return null;
    return schema.userViews.find(v => v.name === name) || null;
  }

  /**
   * GET /api/views/:name/distinct/:column - Get distinct values for a column
   * Query params:
   *   type: 'select' (default), 'year', or 'month' - extraction mode for date columns
   */
  router.get('/api/views/:name/distinct/:column', (req, res) => {
    try {
      const view = findView(req.params.name);
      if (!view) {
        return res.status(404).json({ error: `View "${req.params.name}" not found` });
      }

      const db = getDatabase();
      const colName = req.params.column;
      const extractType = req.query.type || 'select';

      // Find column by sqlAlias or label
      const col = view.columns.find(c => c.sqlAlias === colName || c.label === colName);
      if (!col) {
        return res.status(404).json({ error: `Column "${colName}" not found in view` });
      }

      let sql, valueKey;
      if (extractType === 'year') {
        // Extract distinct years from date column
        sql = `SELECT DISTINCT strftime('%Y', "${col.sqlAlias}") as year FROM ${view.sqlName} WHERE "${col.sqlAlias}" IS NOT NULL ORDER BY year DESC`;
        valueKey = 'year';
      } else if (extractType === 'month') {
        // Extract distinct year-months from date column
        sql = `SELECT DISTINCT strftime('%Y-%m', "${col.sqlAlias}") as month FROM ${view.sqlName} WHERE "${col.sqlAlias}" IS NOT NULL ORDER BY month DESC`;
        valueKey = 'month';
      } else {
        // Default: distinct values
        sql = `SELECT DISTINCT "${col.sqlAlias}" FROM ${view.sqlName} WHERE "${col.sqlAlias}" IS NOT NULL ORDER BY "${col.sqlAlias}"`;
        valueKey = col.sqlAlias;
      }

      const rows = db.prepare(sql).all();
      const values = rows.map(r => r[valueKey]);

      res.json({ values, column: col.sqlAlias, label: col.label, extractType });
    } catch (err) {
      logger.error('Failed to get distinct values', { view: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/views/:name - Query view data
   *
   * Query params:
   *   filter  - "column:value" or "text" (global LIKE search)
   *   sort    - Column label to sort by
   *   order   - "asc" or "desc"
   *   limit   - Max rows
   *   offset  - Skip rows
   */
  router.get('/api/views/:name', (req, res) => {
    try {
      const view = findView(req.params.name);
      if (!view) {
        return res.status(404).json({ error: `View "${req.params.name}" not found` });
      }

      const db = getDatabase();
      const { sort, order, filter, field, value, limit, offset } = req.query;

      // Detail views: assemble tree from template
      if (view.detail) {
        if (!field || value === undefined) {
          return res.status(400).json({ error: 'Detail views require ?field=...&value=... parameters' });
        }
        const schema = getSchema();
        const result = queryDetailView(view, field, value, schema, db);
        if (result.error) return res.status(result.status).json({ error: result.error });
        return res.json({ ...result, view: view.name, detail: true });
      }

      // Support ?field=X&value=Y as alternative to ?filter= (for external tools like HCL Leap)
      const effectiveFilter = (field && value !== undefined)
        ? `=${field}:${value}`
        : filter;

      // Parse filter using shared FilterParser
      const { conditions, params } = parseFilter(effectiveFilter, {
        // Resolve column by sqlAlias or label
        resolveColumn: (colName) => {
          if (colName === 'id') return { sqlName: 'id', jsType: 'number' };
          const col = view.columns.find(c => c.sqlAlias === colName || c.label === colName);
          if (col) return { sqlName: col.sqlAlias, jsType: col.jsType };
          // Also resolve FK ID columns (e.g., "_fk_Engine Type") for IN-filter support
          const fkCol = view.columns.find(c => c.fkIdColumn === colName);
          if (fkCol) return { sqlName: fkCol.fkIdColumn, jsType: 'number' };
          return null;
        },
        // For global text search: use view's string columns
        getStringColumns: () => view.columns
          .filter(c => c.jsType === 'string')
          .map(c => c.sqlAlias)
      });

      let sql = `SELECT * FROM ${view.sqlName}${buildWhereClause(conditions)}`;

      // Sort
      if (sort) {
        const col = view.columns.find(c => c.sqlAlias === sort || c.label === sort);
        if (col) {
          const dir = order === 'desc' ? 'DESC' : 'ASC';
          sql += ` ORDER BY "${col.sqlAlias}" ${dir}`;
        }
      } else {
        sql += ' ORDER BY id ASC';
      }

      // Pagination
      if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit, 10));
      }
      if (offset) {
        sql += ' OFFSET ?';
        params.push(parseInt(offset, 10));
      }

      const rows = db.prepare(sql).all(...params);

      // Total count
      const countSql = `SELECT COUNT(*) as count FROM ${view.sqlName}`;
      const { count } = db.prepare(countSql).get();

      res.json({ data: rows, total: count, view: view.name });
    } catch (err) {
      logger.error('Failed to query view', { view: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// Exported for /api/meta consolidation
module.exports.buildViewSummary = buildViewSummary;
module.exports.buildViewSchema = buildViewSchema;
