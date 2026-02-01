/**
 * UserViewRouter - REST API for user-defined views
 *
 * GET /api/views                  - List views with groups/colors
 * GET /api/views/:name            - Query view data (filter, sort, pagination)
 * GET /api/views/:name/schema     - Column metadata for UI rendering
 */

const express = require('express');
const logger = require('../utils/logger');

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
   * GET /api/views - List all views with grouping info
   */
  router.get('/api/views', (req, res) => {
    try {
      const schema = getSchema();
      const views = schema.userViews || [];
      const groups = schema.userViewGroups || [];

      res.json({ views: views.map(v => ({
        name: v.name,
        base: v.base,
        color: v.color,
        group: v.group,
        columns: v.columns.map(c => c.label)
      })), groups });
    } catch (err) {
      logger.error('Failed to list views', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/views/:name/schema - Column metadata for UI
   */
  router.get('/api/views/:name/schema', (req, res) => {
    try {
      const view = findView(req.params.name);
      if (!view) {
        return res.status(404).json({ error: `View "${req.params.name}" not found` });
      }

      res.json({
        name: view.name,
        base: view.base,
        color: view.color,
        columns: view.columns.map(c => {
          const col = { key: c.sqlAlias, label: c.label, type: c.jsType };
          if (c.path) col.path = c.path; // Original column path for prefilter matching
          if (c.omit !== undefined) col.omit = c.omit;
          if (c.areaColor) col.areaColor = c.areaColor;
          if (c.calculated) col.calculated = c.calculated;
          if (c.autoHidden) col.autoHidden = c.autoHidden;
          // Aggregate metadata for client-side grouping
          if (c.aggregateSource) col.aggregateSource = c.aggregateSource;
          if (c.aggregateType) col.aggregateType = c.aggregateType;
          if (c.aggregateField) col.aggregateField = c.aggregateField;
          return col;
        }),
        ...(view.calculator ? { calculator: view.calculator } : {}),
        ...(view.prefilter ? { prefilter: view.prefilter } : {}),
        ...(view.requiredFilter ? { requiredFilter: view.requiredFilter } : {}),
        ...(view.defaultSort ? { defaultSort: view.defaultSort } : {})
      });
    } catch (err) {
      logger.error('Failed to get view schema', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

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

      let sql = `SELECT * FROM ${view.sqlName}`;
      const params = [];

      // Filter - supports multiple filters joined with && (AND)
      if (filter) {
        const filterParts = filter.split('&&');
        const conditions = [];

        for (const part of filterParts) {
          const trimmedPart = part.trim();
          if (!trimmedPart) continue;

          // Check filter prefix type:
          // @Y = year filter (strftime year extraction)
          // @M = month filter (strftime year-month extraction)
          // ~ = LIKE match
          // (none) = exact match
          const yearMatch = trimmedPart.match(/^@Y(.+?):(.+)$/);
          const monthMatch = trimmedPart.match(/^@M(.+?):(.+)$/);
          const likeMatch = trimmedPart.match(/^~(.+?):(.+)$/);
          const exactMatch = trimmedPart.match(/^([^~@].+?):(.+)$/);

          if (yearMatch) {
            const [, colLabel, value] = yearMatch;
            const col = view.columns.find(c => c.sqlAlias === colLabel || c.label === colLabel);
            if (col) {
              conditions.push(`strftime('%Y', "${col.sqlAlias}") = ?`);
              params.push(value);
            }
          } else if (monthMatch) {
            const [, colLabel, value] = monthMatch;
            const col = view.columns.find(c => c.sqlAlias === colLabel || c.label === colLabel);
            if (col) {
              conditions.push(`strftime('%Y-%m', "${col.sqlAlias}") = ?`);
              params.push(value);
            }
          } else if (likeMatch) {
            const [, colLabel, value] = likeMatch;
            const col = view.columns.find(c => c.sqlAlias === colLabel || c.label === colLabel);
            if (col) {
              conditions.push(`"${col.sqlAlias}" LIKE ?`);
              params.push(`%${value}%`);
            }
          } else if (exactMatch) {
            const [, colLabel, value] = exactMatch;
            const col = view.columns.find(c => c.sqlAlias === colLabel || c.label === colLabel);
            if (col) {
              conditions.push(`"${col.sqlAlias}" = ?`);
              params.push(value);
            }
          } else {
            // Global LIKE search across all text columns
            const textCols = view.columns.filter(c => c.jsType === 'string');
            if (textCols.length > 0) {
              const textConditions = textCols.map(c => `"${c.sqlAlias}" LIKE ?`);
              conditions.push(`(${textConditions.join(' OR ')})`);
              const filterValue = `%${trimmedPart}%`;
              params.push(...textCols.map(() => filterValue));
            }
          }
        }

        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }
      }

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
