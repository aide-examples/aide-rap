/**
 * GenericCrudRouter - REST API endpoints for all entities
 *
 * Endpoints:
 * GET    /api/entities                    - List all entity types
 * GET    /api/entities/:entity            - List all records
 * GET    /api/entities/:entity/:id        - Get single record
 * POST   /api/entities/:entity            - Create record
 * PUT    /api/entities/:entity/:id        - Update record
 * DELETE /api/entities/:entity/:id        - Delete record
 * GET    /api/entities/:entity/schema     - Get schema info
 */

const express = require('express');
const service = require('../services/GenericService');
const { EntityNotFoundError } = require('../errors/NotFoundError');
const calculationService = require('../services/CalculationService');
const { getDatabase } = require('../config/database');

const router = express.Router();

/**
 * Build ETag string from entity, id, and version
 * Format: "Entity:id:version"
 */
function buildETag(entity, id, version) {
  return `"${entity}:${id}:${version}"`;
}

/**
 * Parse If-Match header to extract version
 * Returns version number or null if not present/invalid
 */
function parseIfMatch(header) {
  if (!header) return null;
  // Format: "Entity:id:version"
  const match = header.match(/"(\w+):(\d+):(\d+)"/);
  if (match) {
    return parseInt(match[3], 10);
  }
  return null;
}

/**
 * Validate entity name middleware
 */
function validateEntity(req, res, next) {
  const { entity } = req.params;
  const enabledEntities = service.getEnabledEntities();

  if (!enabledEntities.includes(entity)) {
    return res.status(404).json({
      error: {
        code: 'ENTITY_NOT_FOUND',
        message: `Entity '${entity}' not found or not enabled`,
        correlationId: req.correlationId
      }
    });
  }

  next();
}

/**
 * GET /api/entities/:entity/distinct/:column - Get distinct values for a column (for prefilter dropdowns)
 * Query params:
 *   type: 'select' (default), 'year', or 'month' - extraction mode for date columns
 */
router.get('/:entity/distinct/:column', validateEntity, (req, res, next) => {
  try {
    const { entity, column } = req.params;
    const extractType = req.query.type || 'select';
    const values = service.getDistinctValues(entity, column, extractType);

    res.json(values);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/:id/references - Get back-references to this record
 */
router.get('/:entity/:id/references', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const references = service.getBackReferences(entity, parseInt(id, 10), req.correlationId);

    res.json(references);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/hierarchy/roots - Get root nodes for hierarchy view
 * Returns records where the self-referential FK is NULL
 */
router.get('/:entity/hierarchy/roots', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const schema = service.getExtendedSchema(entity);

    if (!schema.selfRefFK) {
      return res.status(400).json({
        error: {
          code: 'NO_SELF_REF_FK',
          message: `Entity '${entity}' has no self-referential foreign key`
        }
      });
    }

    // Use the FK column name directly (e.g., "super_type_id")
    // Filter format: column:value where column is the actual DB column
    const result = service.listEntities(entity, {
      filter: `${schema.selfRefFK}:null`,
      sort: schema.ui?.labelFields?.[0] || 'id'
    }, req.correlationId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/hierarchy/children/:parentId - Get children in hierarchy
 * Returns records where the self-referential FK equals parentId
 */
router.get('/:entity/hierarchy/children/:parentId', validateEntity, (req, res, next) => {
  try {
    const { entity, parentId } = req.params;
    const schema = service.getExtendedSchema(entity);

    if (!schema.selfRefFK) {
      return res.status(400).json({
        error: {
          code: 'NO_SELF_REF_FK',
          message: `Entity '${entity}' has no self-referential foreign key`
        }
      });
    }

    // Use the FK column name directly (e.g., "super_type_id")
    const result = service.listEntities(entity, {
      filter: `${schema.selfRefFK}:${parentId}`,
      sort: schema.ui?.labelFields?.[0] || 'id'
    }, req.correlationId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/:id/lineage - Get ancestor chain for hierarchical entities
 * Returns the ID itself plus all ancestor IDs (walking up the self-referential FK).
 * For non-hierarchical entities, returns just the given ID.
 */
router.get('/:entity/:id/lineage', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const schema = service.getExtendedSchema(entity);

    if (!schema.selfRefFK) {
      // No hierarchy — just return the ID itself
      return res.json({ ids: [numId] });
    }

    const db = getDatabase();
    const rows = db.prepare(`
      WITH RECURSIVE lineage(id) AS (
        SELECT id FROM "${schema.tableName}" WHERE id = ?
        UNION ALL
        SELECT t."${schema.selfRefFK}" FROM "${schema.tableName}" t
        JOIN lineage l ON l.id = t.id
        WHERE t."${schema.selfRefFK}" IS NOT NULL
      )
      SELECT id FROM lineage
    `).all(numId);

    res.json({ ids: rows.map(r => r.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity - List all records
 */
router.get('/:entity', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const { sort, order, filter, field, value, limit, offset } = req.query;

    // Support ?field=X&value=Y as alternative to ?filter= (for external tools like HCL Leap)
    const effectiveFilter = (field && value !== undefined)
      ? `${field}:${value}`
      : filter;

    const options = {};
    if (sort) options.sort = sort;
    if (order) options.order = order;
    if (effectiveFilter) options.filter = effectiveFilter;
    if (limit) options.limit = parseInt(limit, 10);
    if (offset) options.offset = parseInt(offset, 10);

    const result = service.listEntities(entity, options, req.correlationId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/:id - Get single record
 */
router.get('/:entity/:id', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const record = service.getEntity(entity, parseInt(id, 10), req.correlationId);

    // Set ETag for OCC
    if (record._version !== undefined) {
      res.set('ETag', buildETag(entity, record.id, record._version));
    }

    res.json(record);
  } catch (err) {
    next(err);
  }
});

/**
 * Build request context for audit trail
 */
function buildContext(req) {
  return {
    correlationId: req.correlationId,
    clientIp: req.ip || req.connection?.remoteAddress
  };
}

/**
 * POST /api/entities/:entity - Create record
 */
router.post('/:entity', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const data = req.body;

    const created = service.createEntity(entity, data, buildContext(req));

    // Run ONCHANGE calculations (async, don't block response)
    setImmediate(() => {
      calculationService.runOnChangeServerCalculations(entity, created);
    });

    // Set ETag for OCC
    if (created._version !== undefined) {
      res.set('ETag', buildETag(entity, created.id, created._version));
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/entities/:entity/:id - Update record
 * Supports OCC via If-Match header or _version in body
 */
router.put('/:entity/:id', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const data = req.body;

    // Get expected version from If-Match header or body._version
    const ifMatchVersion = parseIfMatch(req.get('If-Match'));
    const bodyVersion = data._version !== undefined ? parseInt(data._version, 10) : null;
    const expectedVersion = ifMatchVersion ?? bodyVersion;

    // Remove _version from data (it's a system column, not user-settable)
    delete data._version;

    const updated = service.updateEntity(entity, parseInt(id, 10), data, expectedVersion, buildContext(req));

    // Run ONCHANGE calculations (async, don't block response)
    setImmediate(() => {
      calculationService.runOnChangeServerCalculations(entity, updated);
    });

    // Set ETag for OCC
    if (updated._version !== undefined) {
      res.set('ETag', buildETag(entity, updated.id, updated._version));
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/entities/:entity/:id - Delete record
 */
router.delete('/:entity/:id', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;

    // Get record BEFORE delete to extract partition keys for calculation
    const recordBeforeDelete = service.getEntity(entity, parseInt(id, 10));

    const deleted = service.deleteEntity(entity, parseInt(id, 10), buildContext(req));

    // Run ONCHANGE calculations (async, don't block response)
    // Use the deleted record's data for partition key extraction
    if (recordBeforeDelete) {
      setImmediate(() => {
        calculationService.runOnChangeServerCalculations(entity, recordBeforeDelete);
      });
    }

    res.json({
      message: `${entity} with ID ${id} deleted`,
      deleted
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
