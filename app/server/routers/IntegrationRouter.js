/**
 * IntegrationRouter - REST API for external workflow tools
 *
 * Provides FK-resolving CRUD endpoints so external tools (HCL Leap, Power Automate)
 * can send human-readable labels instead of internal IDs.
 *
 * Endpoints:
 * GET    /api/integrate/:entity/options   - Picklist: id + label for dropdowns
 * GET    /api/integrate/:entity/lookup    - Lookup records by field value
 * POST   /api/integrate/:entity           - Create record with FK label resolution
 * PUT    /api/integrate/:entity/:id       - Update record with FK label resolution
 */

const express = require('express');
const service = require('../services/GenericService');
const { buildLabelLookup, resolveConceptualFKs } = require('../utils/SeedManager');
const calculationService = require('../services/CalculationService');
const { getSchema, getDatabase } = require('../config/database');
const { EntityNotFoundError } = require('../errors/NotFoundError');

const router = express.Router();

/**
 * Validate entity name middleware (same logic as GenericCrudRouter)
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
 * Build request context for audit trail
 * Includes user identity from Trusted Subsystem (X-User-Id header)
 */
function buildContext(req) {
  const changedBy = req.user?.userId
    ? `${req.user.userId} (via ${req.user.apiKey})`
    : req.user?.apiKey || req.ip || req.connection?.remoteAddress;

  return {
    correlationId: req.correlationId,
    clientIp: req.ip || req.connection?.remoteAddress,
    changedBy
  };
}

/**
 * Build ETag string from entity, id, and version
 */
function buildETag(entity, id, version) {
  return `"${entity}:${id}:${version}"`;
}

/**
 * Parse If-Match header to extract version
 */
function parseIfMatch(header) {
  if (!header) return null;
  const match = header.match(/"(\w+):(\d+):(\d+)"/);
  return match ? parseInt(match[3], 10) : null;
}

/**
 * Resolve FK labels in a data object for a given entity.
 * E.g. { "engine": "CF34-10-12345" } → { "engine_id": 42 }
 */
function resolveLabels(entityName, data) {
  const schema = getSchema();
  const entity = schema.entities[entityName];
  if (!entity) return { resolved: data, fkWarnings: [], fuzzyMatches: [] };

  // Build label lookups for all FK target entities
  const lookups = {};
  for (const fk of (entity.foreignKeys || [])) {
    const targetEntity = fk.references?.entity || entityName;
    if (!lookups[targetEntity]) {
      lookups[targetEntity] = buildLabelLookup(targetEntity);
    }
  }

  return resolveConceptualFKs(entityName, data, lookups);
}

// ---------------------------------------------------------------------------
// GET /api/integrate/:entity/options[?field=X&value=Y]
//
// Returns compact picklist: [{ id, label, label2? }] for dropdown binding.
// Uses LABEL/LABEL2 annotations or labelExpression from entity schema.
// Supports optional ?field=&value= filter (e.g., ?field=is_leaf&value=1).
// ---------------------------------------------------------------------------

router.get('/:entity/options', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const { field, value } = req.query;
    const schema = getSchema();
    const entityMeta = schema.entities[entity];
    const db = getDatabase();

    const viewName = entityMeta.tableName + '_view';
    const hasComputedLabel = !!entityMeta.labelExpression;

    // Determine label column(s)
    let selectCols, labelKey, label2Key;

    if (hasComputedLabel) {
      // Entity has [LABEL=concat(...)]: view provides _label
      selectCols = 'id, _label as label';
      labelKey = 'label';
    } else {
      // Use [LABEL] and [LABEL2] annotated columns
      const labelCol = entityMeta.columns.find(c => c.ui?.label);
      const label2Col = entityMeta.columns.find(c => c.ui?.label2);

      if (!labelCol) {
        return res.status(400).json({
          error: { code: 'NO_LABEL', message: `Entity '${entity}' has no [LABEL] column` }
        });
      }

      selectCols = `id, "${labelCol.name}" as label`;
      labelKey = 'label';
      if (label2Col) {
        selectCols += `, "${label2Col.name}" as label2`;
        label2Key = 'label2';
      }
    }

    // Build optional filter
    let whereClause = '';
    const params = [];

    if (field && value !== undefined) {
      const col = entityMeta.columns.find(c => c.name === field);
      if (col) {
        whereClause = ` WHERE _ql = 0 AND "${field}" = ?`;
        params.push(col.jsType === 'number' ? parseInt(value, 10) : value);
      }
    }

    if (!whereClause) {
      whereClause = ' WHERE _ql = 0';
    }

    const sql = `SELECT ${selectCols} FROM ${viewName}${whereClause} ORDER BY label`;
    const rows = db.prepare(sql).all(...params);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrate/:entity/lookup?field=serial_number&value=GE-123456
//
// Supports FK label resolution: if "field" is a FK name (e.g. "type"),
// "value" is resolved via label lookup against the referenced entity.
// Example: ?field=type&value=CFM56-7B27 → filters by type_id=<resolved id>
// ---------------------------------------------------------------------------

router.get('/:entity/lookup', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const { field, value } = req.query;

    if (!field || value === undefined || value === '') {
      return res.status(400).json({
        error: { code: 'MISSING_PARAMS', message: 'Query params "field" and "value" are required' }
      });
    }

    // Check if field is a FK column (e.g. "type" → "type_id" exists)
    const schema = getSchema();
    const entityMeta = schema.entities[entity];
    const fkColumn = entityMeta?.columns.find(c => c.name === field + '_id' && c.foreignKey);

    let filterString;

    if (fkColumn) {
      // FK field: resolve label to ID via target entity lookup
      const targetEntity = fkColumn.foreignKey.entity;
      const lookup = buildLabelLookup(targetEntity);
      const resolvedId = lookup[value];

      if (resolvedId === undefined) {
        return res.status(404).json({
          error: {
            code: 'FK_NOT_FOUND',
            message: `No ${targetEntity} found with label '${value}'`,
            correlationId: req.correlationId
          }
        });
      }

      filterString = `${fkColumn.name}:${resolvedId}`;
    } else {
      // Direct column match (existing behavior)
      filterString = `${field}:${value}`;
    }

    const result = service.listEntities(entity, {
      filter: filterString,
      limit: 50
    }, req.correlationId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/integrate/:entity - Create with FK label resolution
// ---------------------------------------------------------------------------

router.post('/:entity', validateEntity, (req, res, next) => {
  try {
    const { entity } = req.params;
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object' }
      });
    }

    // Resolve conceptual FK names to IDs
    const { resolved, fkWarnings, fuzzyMatches } = resolveLabels(entity, data);

    if (fkWarnings.length > 0) {
      return res.status(422).json({
        error: {
          code: 'FK_RESOLUTION_FAILED',
          message: 'Could not resolve some foreign key references',
          details: fkWarnings
        }
      });
    }

    const created = service.createEntity(entity, resolved, buildContext(req));

    // Run ONCHANGE calculations (async, don't block response)
    setImmediate(() => {
      calculationService.runOnChangeServerCalculations(entity, created);
    });

    // Set ETag for OCC
    if (created._version !== undefined) {
      res.set('ETag', buildETag(entity, created.id, created._version));
    }

    const response = { ...created };
    if (fuzzyMatches.length > 0) {
      response._fuzzyMatches = fuzzyMatches;
    }

    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/integrate/:entity/:id - Update with FK label resolution
// ---------------------------------------------------------------------------

router.put('/:entity/:id', validateEntity, (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object' }
      });
    }

    // Get expected version from If-Match header or body._version
    const ifMatchVersion = parseIfMatch(req.get('If-Match'));
    const bodyVersion = data._version !== undefined ? parseInt(data._version, 10) : null;
    const expectedVersion = ifMatchVersion ?? bodyVersion;
    delete data._version;

    // Resolve conceptual FK names to IDs
    const { resolved, fkWarnings, fuzzyMatches } = resolveLabels(entity, data);

    if (fkWarnings.length > 0) {
      return res.status(422).json({
        error: {
          code: 'FK_RESOLUTION_FAILED',
          message: 'Could not resolve some foreign key references',
          details: fkWarnings
        }
      });
    }

    const updated = service.updateEntity(entity, parseInt(id, 10), resolved, expectedVersion, buildContext(req));

    // Run ONCHANGE calculations (async, don't block response)
    setImmediate(() => {
      calculationService.runOnChangeServerCalculations(entity, updated);
    });

    // Set ETag for OCC
    if (updated._version !== undefined) {
      res.set('ETag', buildETag(entity, updated.id, updated._version));
    }

    const response = { ...updated };
    if (fuzzyMatches.length > 0) {
      response._fuzzyMatches = fuzzyMatches;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
