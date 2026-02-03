/**
 * Import Router
 * Routes: /api/import/* (status, run)
 *
 * Handles XLSX → JSON conversion based on MD import definitions
 */

const express = require('express');
const ImportManager = require('../utils/ImportManager');
const logger = require('../utils/logger');
const { getSchema } = require('../config/database');

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

  /**
   * GET /api/import/validate/:entity
   * Validates import rule mapping against source schema and entity schema
   * Returns: { valid, sourceErrors[], targetErrors[] }
   */
  router.get('/api/import/validate/:entity', (req, res) => {
    try {
      const entityName = req.params.entity;
      const errors = { source: [], target: [] };

      // Get parsed import definition
      const definition = importManager.parseImportDefinition(entityName);
      if (!definition) {
        return res.json({ valid: false, error: 'No import definition found', sourceErrors: [], targetErrors: [] });
      }

      // Get XLSX source schema
      const sourceSchema = importManager.getSourceSchema(entityName);
      const sourceColumns = sourceSchema.columns || [];
      const sourceColumnSet = new Set(sourceColumns);

      // Get mapping columns
      const mappedSourceCols = new Set(Object.keys(definition.mapping));
      const mappedTargetCols = new Set(Object.values(definition.mapping));

      // Check source columns in mapping
      for (const sourceCol of mappedSourceCols) {
        if (!sourceColumnSet.has(sourceCol)) {
          errors.source.push({
            column: sourceCol,
            message: `Source column "${sourceCol}" not found in XLSX`
          });
        }
      }

      // Find unused source columns (in XLSX but not in mapping)
      const unusedSourceColumns = sourceColumns.filter(col => !mappedSourceCols.has(col));

      // Get entity schema
      const schema = getSchema();
      const entity = schema?.entities?.[entityName];
      let unmappedTargetColumns = [];
      let unmappedRequiredColumns = [];

      if (entity) {
        const entityColumnSet = new Set(entity.columns.map(c => c.name));

        // Check target columns in mapping
        for (const targetCol of mappedTargetCols) {
          if (!entityColumnSet.has(targetCol)) {
            errors.target.push({
              column: targetCol,
              message: `Target column "${targetCol}" not found in entity ${entityName}`
            });
          }
        }

        // Find unmapped target columns (in entity but not filled by mapping)
        // Exclude 'id' as it's auto-generated
        for (const col of entity.columns) {
          if (col.name === 'id' || mappedTargetCols.has(col.name)) continue;

          if (col.required) {
            // Required column not mapped - this is an error
            unmappedRequiredColumns.push(col.name);
            errors.target.push({
              column: col.name,
              message: `Required column "${col.name}" is not mapped`
            });
          } else {
            // Optional column not mapped - just info
            unmappedTargetColumns.push(col.name);
          }
        }
      } else {
        errors.target.push({
          column: null,
          message: `Entity "${entityName}" not found in schema`
        });
      }

      const valid = errors.source.length === 0 && errors.target.length === 0;
      res.json({
        valid,
        sourceErrors: errors.source,
        targetErrors: errors.target,
        unusedSourceColumns,
        unmappedTargetColumns,
        unmappedRequiredColumns,
        mappingCount: mappedSourceCols.size,
        sourceColumns: sourceColumns.length,
        targetColumns: entity?.columns?.length || 0
      });
    } catch (e) {
      console.error(`Failed to validate import for ${req.params.entity}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
