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
          if (c.omit !== undefined) col.omit = c.omit;
          if (c.areaColor) col.areaColor = c.areaColor;
          if (c.calculated) col.calculated = c.calculated;
          if (c.autoHidden) col.autoHidden = c.autoHidden;
          return col;
        }),
        ...(view.calculator ? { calculator: view.calculator } : {})
      });
    } catch (err) {
      logger.error('Failed to get view schema', { error: err.message });
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

      // Filter
      if (filter) {
        const colonMatch = filter.match(/^(.+?):(.+)$/);

        if (colonMatch) {
          const [, colLabel, value] = colonMatch;
          // Validate column exists
          const col = view.columns.find(c => c.sqlAlias === colLabel || c.label === colLabel);
          if (col) {
            sql += ` WHERE "${col.sqlAlias}" LIKE ?`;
            params.push(`%${value}%`);
          }
        } else {
          // Global LIKE search across all text columns
          const textCols = view.columns.filter(c => c.jsType === 'string');
          if (textCols.length > 0) {
            const conditions = textCols.map(c => `"${c.sqlAlias}" LIKE ?`);
            sql += ` WHERE (${conditions.join(' OR ')})`;
            const filterValue = `%${filter}%`;
            params.push(...textCols.map(() => filterValue));
          }
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
