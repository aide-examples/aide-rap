/**
 * Audit Trail Router
 * Exposes _audit_trail as a readonly system entity
 */

const express = require('express');
const AuditService = require('../services/AuditService');
const { getDatabase } = require('../config/database');

const router = express.Router();

/**
 * GET /api/audit - List audit entries with filtering
 */
router.get('/', (req, res, next) => {
  try {
    const { entity, entityId, action, limit = 100, offset = 0 } = req.query;

    const entries = AuditService.queryAuditTrail({
      entityName: entity,
      entityId: entityId ? parseInt(entityId, 10) : undefined,
      action,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    // Parse JSON fields for response
    const data = entries.map(entry => ({
      ...entry,
      before_data: entry.before_data ? JSON.parse(entry.before_data) : null,
      after_data: entry.after_data ? JSON.parse(entry.after_data) : null
    }));

    // Get total count
    const db = getDatabase();
    let countSql = 'SELECT COUNT(*) as total FROM _audit_trail WHERE 1=1';
    const params = [];
    if (entity) {
      countSql += ' AND entity_name = ?';
      params.push(entity);
    }
    if (entityId) {
      countSql += ' AND entity_id = ?';
      params.push(parseInt(entityId, 10));
    }
    if (action) {
      countSql += ' AND action = ?';
      params.push(action);
    }
    const { total } = db.prepare(countSql).get(...params);

    res.json({
      data,
      totalCount: total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/:id - Get single audit entry
 */
router.get('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const entry = db.prepare('SELECT * FROM _audit_trail WHERE id = ?').get(parseInt(id, 10));

    if (!entry) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Audit entry #${id} not found` }
      });
    }

    res.json({
      ...entry,
      before_data: entry.before_data ? JSON.parse(entry.before_data) : null,
      after_data: entry.after_data ? JSON.parse(entry.after_data) : null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/schema - Get audit trail schema from SystemEntityRegistry
 */
router.get('/schema/extended', (req, res) => {
  const systemEntityRegistry = require('../utils/SystemEntityRegistry');
  const schema = systemEntityRegistry.get('AuditTrail');
  if (!schema) return res.status(404).json({ error: 'AuditTrail schema not registered' });
  res.json(schema);
});

/**
 * Block write operations - audit trail is readonly
 */
router.post('/', (req, res) => {
  res.status(405).json({
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Audit trail is readonly' }
  });
});

router.put('/:id', (req, res) => {
  res.status(405).json({
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Audit trail is readonly' }
  });
});

router.delete('/:id', (req, res) => {
  res.status(405).json({
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Audit trail is readonly' }
  });
});

module.exports = router;
