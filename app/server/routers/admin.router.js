/**
 * Admin Router
 * Administrative endpoints for development/maintenance
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('../utils/logger');
const { reloadUserViews, getDatabasePath, getDatabase, closeDatabase } = require('../config/database');
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
   * In-process reinstall: flush DB, unzip new code, npm ci, then exit.
   * PM2 auto-restarts the process with the original arguments (--base-path etc.)
   */
  router.post('/api/admin/reinstall', (req, res) => {
    const parentDir = path.dirname(PROJECT_DIR);
    const zipPath = path.join(parentDir, 'aide-rap-latest.zip');
    const logPath = path.join(PROJECT_DIR, 'reinstall.log');

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'No update package found (aide-rap-latest.zip)' });
    }

    logger.warn('Reinstall initiated by admin', { user: req.user?.userId || req.user?.role });

    // Send response while connection is still alive
    res.json({
      status: 'reinstalling',
      message: 'Server will restart in ~30 seconds. Page will auto-reload.'
    });

    // After response is flushed: do everything in-process, then exit
    res.on('finish', () => {
      // Log helper — writes to reinstall.log + app logger
      const logLines = [];
      const log = (msg) => {
        const line = `[${new Date().toISOString()}] ${msg}`;
        logLines.push(line);
        logger.info(msg);
      };

      try {
        log('=== Reinstall started ===');

        // 1. Stop HTTP server (no more incoming requests)
        const httpServer = req.app._httpServer;
        if (httpServer) {
          httpServer.stop();
          log('HTTP server stopped');
        }

        // 2. Flush SQLite WAL to disk and close DB
        const db = getDatabase();
        if (db) {
          db.pragma('wal_checkpoint(TRUNCATE)');
          log('SQLite WAL checkpoint completed');
        }
        closeDatabase();
        log('Database closed');

        // 3. Unzip new code (overwrites everything except DB)
        log('Unzipping...');
        execSync(`unzip -o "${zipPath}"`, { cwd: parentDir, timeout: 60000 });
        log('Unzip completed');

        // 4. Install dependencies
        log('Installing dependencies...');
        execSync('npm ci --omit=dev', { cwd: PROJECT_DIR, timeout: 120000 });
        log('Main dependencies installed');

        const aideFrameDir = path.join(PROJECT_DIR, 'aide-frame', 'js', 'aide_frame');
        if (fs.existsSync(path.join(aideFrameDir, 'package.json'))) {
          execSync('npm ci --omit=dev', { cwd: aideFrameDir, timeout: 60000 });
          log('aide-frame dependencies installed');
        }

        log('=== Reinstall completed — exiting for PM2 restart ===');
        fs.writeFileSync(logPath, logLines.join('\n') + '\n');
        process.exit(0);
      } catch (err) {
        log(`ERROR: ${err.message}`);
        log('=== Reinstall FAILED ===');
        fs.writeFileSync(logPath, logLines.join('\n') + '\n');
        process.exit(1);
      }
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

  /**
   * POST /api/admin/reports
   * Generate developer reports (LOC statistics + client/server dependency graphs)
   */
  router.post('/api/admin/reports', (req, res) => {
    try {
      const FRAME_ROOT = path.join(PROJECT_DIR, 'aide-frame');
      const reportsDir = path.join(systemConfig.systemDir, 'docs', 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });

      const files = [];

      // 1. LOC Statistics
      const statsScript = path.join(FRAME_ROOT, 'tools', 'loc-stats.sh');
      if (fs.existsSync(statsScript)) {
        const stats = execSync(
          `bash "${statsScript}" "${PROJECT_DIR}" --markdown --system ${systemConfig.systemName}`,
          { timeout: 30000 }
        );
        fs.writeFileSync(path.join(reportsDir, 'statistics.md'), stats);
        files.push('statistics.md');
      }

      const depScript = path.join(FRAME_ROOT, 'tools', 'dependency-graph.js');
      if (fs.existsSync(depScript)) {
        // 2. Client-Side Dependency Graph
        const clientDeps = execSync(
          `node "${depScript}" "${path.join(PROJECT_DIR, 'app', 'static', 'rap')}" --report`,
          { timeout: 30000 }
        );
        fs.writeFileSync(path.join(reportsDir, 'client_dependencies.md'), clientDeps);
        files.push('client_dependencies.md');

        // 3. Server-Side Dependency Graph
        const serverDeps = execSync(
          `node "${depScript}" "${path.join(PROJECT_DIR, 'app', 'server')}" --server --report`,
          { timeout: 30000 }
        );
        fs.writeFileSync(path.join(reportsDir, 'server_dependencies.md'), serverDeps);
        files.push('server_dependencies.md');
      }

      logger.info(`Developer reports generated: ${files.join(', ')}`);
      res.json({ success: true, files });
    } catch (err) {
      logger.error('Failed to generate reports', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
