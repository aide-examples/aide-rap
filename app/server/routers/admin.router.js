/**
 * Admin Router
 * Administrative endpoints for development/maintenance
 */

const express = require('express');
const logger = require('../utils/logger');
const { reloadUserViews, getDatabasePath } = require('../config/database');
const ExternalQueryService = require('../services/ExternalQueryService');

module.exports = function(systemConfig) {
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

  /**
   * GET /api/admin/external-query/keywords/:provider
   * Get highlight keywords for a provider
   */
  router.get('/api/admin/external-query/keywords/:provider', (req, res) => {
    try {
      const keywords = ExternalQueryService.getProviderKeywords(req.params.provider);
      res.json({ keywords });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/external-query/columns/:provider
   * Get column definitions for a provider's result display
   */
  router.get('/api/admin/external-query/columns/:provider', (req, res) => {
    try {
      const columns = ExternalQueryService.getProviderColumns(req.params.provider);
      res.json({ columns });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/external-query
   * Query an external API provider (e.g., regulatory databases)
   */
  router.get('/api/admin/external-query', async (req, res) => {
    const { provider, term, page } = req.query;
    if (!provider || !term) {
      return res.status(400).json({ error: 'Missing required parameters: provider, term' });
    }
    try {
      const result = await ExternalQueryService.query(provider, term, parseInt(page) || 1, systemConfig);
      res.json(result);
    } catch (err) {
      logger.error('External query failed', { provider, term, error: err.message });
      res.status(502).json({ error: err.message });
    }
  });

  return router;
};
