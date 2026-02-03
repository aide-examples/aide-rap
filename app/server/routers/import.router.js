/**
 * Import Router
 * Routes: /api/import/* (status, run)
 *
 * Handles XLSX → JSON conversion based on MD import definitions
 */

const express = require('express');
const ImportManager = require('../utils/ImportManager');
const logger = require('../utils/logger');

module.exports = function(cfg) {
  const router = express.Router();

  // Initialize ImportManager with system directory and logger
  const importManager = new ImportManager(cfg.systemDir, logger);

  /**
   * GET /api/import/status
   * Returns list of available import definitions and their status
   */
  router.get('/api/import/status', (req, res) => {
    try {
      const imports = importManager.getAvailableImports();
      res.json({ imports });
    } catch (e) {
      console.error('Failed to get import status:', e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/import/run/:entity
   * Runs XLSX → JSON conversion for an entity
   * Returns: { success, recordsRead, recordsFiltered, recordsWritten }
   */
  router.post('/api/import/run/:entity', async (req, res) => {
    try {
      const result = await importManager.runImport(req.params.entity);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (e) {
      console.error(`Failed to run import for ${req.params.entity}:`, e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * GET /api/import/definition/:entity
   * Returns the parsed import definition for an entity
   */
  router.get('/api/import/definition/:entity', (req, res) => {
    try {
      const definition = importManager.parseImportDefinition(req.params.entity);

      if (definition) {
        res.json(definition);
      } else {
        res.status(404).json({ error: `No import definition found for ${req.params.entity}` });
      }
    } catch (e) {
      console.error(`Failed to get import definition for ${req.params.entity}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/import/definition/:entity/raw
   * Returns the raw markdown content of the import definition
   */
  router.get('/api/import/definition/:entity/raw', (req, res) => {
    try {
      const result = importManager.getRawDefinition(req.params.entity);

      if (result.error) {
        res.status(404).json(result);
      } else {
        res.json(result);
      }
    } catch (e) {
      console.error(`Failed to get raw definition for ${req.params.entity}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PUT /api/import/definition/:entity/raw
   * Saves the raw markdown content of the import definition
   */
  router.put('/api/import/definition/:entity/raw', (req, res) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid content' });
      }

      const result = importManager.saveRawDefinition(req.params.entity, content);

      if (result.error) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    } catch (e) {
      console.error(`Failed to save definition for ${req.params.entity}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/import/schema/:entity
   * Returns column names from the XLSX source file
   */
  router.get('/api/import/schema/:entity', (req, res) => {
    try {
      const result = importManager.getSourceSchema(req.params.entity);

      if (result.error) {
        res.status(400).json(result);
      } else {
        res.json(result);
      }
    } catch (e) {
      console.error(`Failed to get schema for ${req.params.entity}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
