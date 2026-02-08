/**
 * Admin Router
 * Administrative endpoints for development/maintenance
 */

const express = require('express');
const logger = require('../utils/logger');
const { reloadUserViews, getDatabasePath } = require('../config/database');

module.exports = function() {
  const router = express.Router();

  /**
   * POST /api/admin/reload-views
   * Reload user views from Views.md without server restart
   */
  router.post('/api/admin/reload-views', (req, res) => {
    try {
      const result = reloadUserViews();
      logger.info('User views reloaded via admin endpoint');
      res.json(result);
    } catch (err) {
      logger.error('Failed to reload views', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/db-file
   * Serve the SQLite database file for admin inspection (SQL Browser)
   */
  router.get('/api/admin/db-file', (req, res) => {
    try {
      const dbPath = getDatabasePath();
      if (!dbPath) {
        return res.status(500).json({ error: 'Database path not available' });
      }
      res.sendFile(dbPath);
    } catch (err) {
      logger.error('Failed to serve database file', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
