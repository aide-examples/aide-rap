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
      const { sort, order, filter, limit, offset } = req.query;

      // Parse filter using shared FilterParser
      const { conditions, params } = parseFilter(filter, {
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
