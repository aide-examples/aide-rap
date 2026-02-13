/**
 * Admin Router
 * Administrative endpoints for development/maintenance
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../utils/logger');
const { reloadUserViews, getDatabasePath } = require('../config/database');
const ExternalQueryService = require('../services/ExternalQueryService');

// aide-rap project root (parent of app/)
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');

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

  /**
   * POST /api/admin/reinstall
   * Trigger server reinstall from uploaded ZIP package.
   * Spawns reinstall.sh as detached process, then the server restarts via PM2.
   */
  router.post('/api/admin/reinstall', (req, res) => {
    const scriptPath = path.join(PROJECT_DIR, 'reinstall.sh');
    const zipPath = path.join(path.dirname(PROJECT_DIR), 'aide-rap-latest.zip');

    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: 'reinstall.sh not found on server' });
    }
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'No update package found (aide-rap-latest.zip)' });
    }

    // Spawn detached child — survives when PM2 stops the Node process
    const child = spawn('bash', [scriptPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    logger.warn('Reinstall initiated by admin', { user: req.user?.userId || req.user?.role });
    res.json({
      status: 'reinstalling',
      message: 'Server will restart in ~10 seconds. Page will auto-reload.'
    });
  });

  /**
   * GET /api/admin/reinstall/status
   * Check if an update package is available and return reinstall log tail.
   */
  router.get('/api/admin/reinstall/status', (req, res) => {
    const zipPath = path.join(path.dirname(PROJECT_DIR), 'aide-rap-latest.zip');
    const logPath = path.join(PROJECT_DIR, 'reinstall.log');

    const result = { zipAvailable: fs.existsSync(zipPath) };

    if (fs.existsSync(logPath)) {
      try {
        const log = fs.readFileSync(logPath, 'utf8');
        const lines = log.split('\n');
        result.lastReinstall = lines.slice(-10).join('\n');
      } catch (e) { /* ignore */ }
    }

    res.json(result);
  });

  return router;
};
