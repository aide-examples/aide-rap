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

const router = express.Router();

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
 * GET /api/entities - List all entity types with area info
 */
router.get('/', (req, res, next) => {
  try {
    const { entities, areas } = service.getEnabledEntitiesWithAreas();

    res.json({
      areas,
      entities: entities.map(e => ({
        name: e.name,
        area: e.area,
        areaName: e.areaName,
        areaColor: e.areaColor,
        count: e.count,
        schema: `/api/entities/${e.name}/schema`,
        endpoint: `/api/entities/${e.name}`
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/schema - Get schema info
 */
router.get('/:entity/schema', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const schema = service.getSchema(entity);

    res.json(schema);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/:entity/schema/extended - Get extended schema with UI metadata
 */
router.get('/:entity/schema/extended', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const schema = service.getExtendedSchema(entity);

    res.json(schema);
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
 * GET /api/entities/:entity - List all records
 */
router.get('/:entity', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const { sort, order, filter, limit, offset } = req.query;

    const options = {};
    if (sort) options.sort = sort;
    if (order) options.order = order;
    if (filter) options.filter = filter;
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

    res.json(record);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entities/:entity - Create record
 */
router.post('/:entity', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const data = req.body;

    const created = service.createEntity(entity, data, req.correlationId);

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/entities/:entity/:id - Update record
 */
router.put('/:entity/:id', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const data = req.body;

    const updated = service.updateEntity(entity, parseInt(id, 10), data, req.correlationId);

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

    const deleted = service.deleteEntity(entity, parseInt(id, 10), req.correlationId);

    res.json({
      message: `${entity} with ID ${id} deleted`,
      deleted
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
