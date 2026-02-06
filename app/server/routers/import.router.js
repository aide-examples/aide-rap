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
   * GET /api/import/sample/:entity
   * Returns first N rows from the XLSX source file as JSON
   * Query params: count (default: 3)
   */
  router.get('/api/import/sample/:entity', (req, res) => {
    try {
      const count = parseInt(req.query.count) || 3;
      const result = importManager.getSourceSample(req.params.entity, count);

      if (result.error) {
        res.status(400).json(result);
      } else {
        res.json(result);
      }
    } catch (e) {
      console.error(`Failed to get sample for ${req.params.entity}:`, e);
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

      // Get mapping columns (mapping is now an array of {source, target, transform})
      const mappedTargetCols = new Set(definition.mapping.map(m => m.target));

      // Track which XLSX columns are actually used
      const usedXlsxColumns = new Set();

      // Check source expressions in mapping
      for (const { source: sourceExprStr } of definition.mapping) {
        const sourceExpr = importManager.parseSourceExpression(sourceExprStr);

        if (sourceExpr.type === 'column') {
          // Column reference - validate against XLSX schema
          if (!sourceColumnSet.has(sourceExpr.name)) {
            errors.source.push({
              column: sourceExpr.name,
              message: `Source column "${sourceExpr.name}" not found in XLSX`
            });
          } else {
            usedXlsxColumns.add(sourceExpr.name);
          }
        } else if (sourceExpr.type === 'randomEnum') {
          // ENUM reference - validate enum type exists
          const enumValues = importManager.getEnumValues(sourceExpr.enumName);
          if (!enumValues || enumValues.length === 0) {
            errors.source.push({
              column: sourceExprStr,
              message: `Unknown ENUM type: ${sourceExpr.enumName}`
            });
          }
        } else if (sourceExpr.type === 'concat') {
          // Validate each column reference in concat
          for (const part of sourceExpr.parts) {
            if (part.type === 'column') {
              if (!sourceColumnSet.has(part.name)) {
                errors.source.push({
                  column: part.name,
                  message: `Source column "${part.name}" not found in XLSX (in concat)`
                });
              } else {
                usedXlsxColumns.add(part.name);
              }
            }
          }
        } else if (sourceExpr.type === 'calc') {
          // Validate each column reference in calc expression
          for (const colName of sourceExpr.columns || []) {
            if (!sourceColumnSet.has(colName)) {
              errors.source.push({
                column: colName,
                message: `Source column "${colName}" not found in XLSX (in calc)`
              });
            } else {
              usedXlsxColumns.add(colName);
            }
          }
        }
        // Literals and randomNumber/randomChoice don't need validation
      }

      // Check source edit columns
      for (const { column, pattern, flags } of (definition.sourceEdit || [])) {
        if (!sourceColumnSet.has(column)) {
          errors.source.push({
            column,
            message: `Source edit column "${column}" not found in XLSX`
          });
        } else {
          usedXlsxColumns.add(column);
        }
        // Validate regex syntax
        try {
          new RegExp(pattern, flags);
        } catch (e) {
          errors.source.push({
            column,
            message: `Invalid regex in source edit for "${column}": ${e.message}`
          });
        }
      }

      // Check source filter columns
      for (const { column, pattern, flags } of (definition.sourceFilter || [])) {
        if (!sourceColumnSet.has(column)) {
          errors.source.push({
            column,
            message: `Source filter column "${column}" not found in XLSX`
          });
        } else {
          usedXlsxColumns.add(column);
        }
        // Validate regex syntax
        try {
          new RegExp(pattern, flags);
        } catch (e) {
          errors.source.push({
            column,
            message: `Invalid regex in source filter for "${column}": ${e.message}`
          });
        }
      }

      // Check First: column for deduplication
      if (definition.first) {
        if (!sourceColumnSet.has(definition.first)) {
          errors.source.push({
            column: definition.first,
            message: `First column "${definition.first}" not found in XLSX`
          });
        } else {
          usedXlsxColumns.add(definition.first);
        }
      }

      // Find unused source columns (in XLSX but not used by any column mapping)
      const unusedSourceColumns = sourceColumns.filter(col => !usedXlsxColumns.has(col));

      // Get entity schema
      const schema = getSchema();
      const entity = schema?.entities?.[entityName];
      let unmappedTargetColumns = [];
      let unmappedRequiredColumns = [];

      if (entity) {
        // Build set of valid target names:
        // - All column names (e.g., serial_number, current_operator_id)
        // - FK displayNames (e.g., current_operator) which map to _id columns
        const validTargetNames = new Set(entity.columns.map(c => c.name));

        // Build FK mappings:
        // - displayName → column (e.g., current_operator → current_operator_id)
        // - column → displayName (reverse, for error messages)
        const fkDisplayToColumn = new Map();
        const fkColumnToDisplay = new Map();
        for (const fk of (entity.foreignKeys || [])) {
          if (fk.displayName && fk.column) {
            validTargetNames.add(fk.displayName);
            fkDisplayToColumn.set(fk.displayName, fk.column);
            fkColumnToDisplay.set(fk.column, fk.displayName);
          }
        }

        // Check target columns in mapping
        for (const targetCol of mappedTargetCols) {
          if (!validTargetNames.has(targetCol)) {
            errors.target.push({
              column: targetCol,
              message: `Target column "${targetCol}" not found in entity ${entityName}`
            });
          }
        }

        // Build set of "covered" columns (mapped directly or via FK displayName)
        const coveredColumns = new Set();
        for (const targetCol of mappedTargetCols) {
          coveredColumns.add(targetCol);
          // If it's a FK displayName, also mark the _id column as covered
          if (fkDisplayToColumn.has(targetCol)) {
            coveredColumns.add(fkDisplayToColumn.get(targetCol));
          }
        }

        // Find unmapped target columns (in entity but not filled by mapping)
        // Exclude 'id' as it's auto-generated
        for (const col of entity.columns) {
          if (col.name === 'id' || coveredColumns.has(col.name)) continue;

          // Use displayName for FK columns in messages (more user-friendly)
          const displayName = fkColumnToDisplay.get(col.name) || col.name;

          if (col.required) {
            // Required column not mapped - this is an error
            unmappedRequiredColumns.push(displayName);
            errors.target.push({
              column: displayName,
              message: `Required column "${displayName}" is not mapped`
            });
          } else {
            // Optional column not mapped - just info
            unmappedTargetColumns.push(displayName);
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
        mappingCount: definition.mapping.length,
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
