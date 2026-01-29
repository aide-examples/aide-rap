/**
 * Schema Router
 * Endpoints for schema management: check for changes, reload schema
 */

const express = require('express');
const { getSchema, getSchemaHash, checkSchemaChanged, reloadSchema } = require('../config/database');

module.exports = function(cfg) {
  const router = express.Router();

  /**
   * GET /api/schema
   * Returns the current cached schema (for Layout-Editor)
   */
  router.get('/api/schema', (req, res) => {
    try {
      const schema = getSchema();
      res.json({
        areas: schema.areas,
        entities: schema.entities,
        relationships: schema.relationships,
        globalTypes: schema.globalTypes,
        enabledEntities: schema.enabledEntities
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schema/hash
   * Returns the current schema hash
   */
  router.get('/api/schema/hash', (req, res) => {
    try {
      const hash = getSchemaHash();
      res.json({ hash });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schema/check-changes
   * Compares current schema hash with freshly parsed markdown
   * Returns { changed: boolean, currentHash, freshHash }
   */
  router.get('/api/schema/check-changes', (req, res) => {
    try {
      const result = checkSchemaChanged();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/schema/reload
   * Reloads schema from markdown files (does NOT rebuild database tables)
   * Returns { success: boolean, hash: string, warning?: string }
   */
  router.post('/api/schema/reload', (req, res) => {
    try {
      const result = reloadSchema();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
