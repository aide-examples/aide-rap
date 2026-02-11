/**
 * AuditService - Records all entity changes for audit trail
 *
 * Listens to entity events and stores before/after snapshots in _audit_trail table.
 * The audit table is a system table, not defined in DataModel.md.
 */

const { getDatabase } = require('../config/database');
const eventBus = require('../utils/EventBus');
const logger = require('../utils/logger');
const systemEntityRegistry = require('../utils/SystemEntityRegistry');

// In-memory store for "before" records (keyed by correlationId + entityName + id)
const pendingUpdates = new Map();
const pendingDeletes = new Map();

/**
 * Initialize the audit trail table (system table)
 */
function initAuditTable() {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _audit_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_name TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE')),
      before_data TEXT,
      after_data TEXT,
      changed_by TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      correlation_id TEXT
    )
  `);

  // Create index for efficient querying
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON _audit_trail(entity_name, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON _audit_trail(changed_at);
  `);

  logger.info('Audit trail table initialized');
}

/**
 * Build a unique key for pending operations
 */
function buildKey(correlationId, entityName, id) {
  return `${correlationId || 'no-corr'}:${entityName}:${id}`;
}

/**
 * Write an audit entry
 */
function writeAuditEntry(entry) {
  const db = getDatabase();

  const sql = `
    INSERT INTO _audit_trail (entity_name, entity_id, action, before_data, after_data, changed_by, changed_at, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `;

  db.prepare(sql).run(
    entry.entityName,
    entry.entityId,
    entry.action,
    entry.beforeData ? JSON.stringify(entry.beforeData) : null,
    entry.afterData ? JSON.stringify(entry.afterData) : null,
    entry.changedBy || null,
    entry.correlationId || null
  );

  logger.debug('Audit entry written', {
    entity: entry.entityName,
    id: entry.entityId,
    action: entry.action
  });
}

/**
 * Register event listeners for entity operations
 */
function registerListeners() {
  // CREATE: No before, just after
  eventBus.on('entity:create:after', (entityName, record, context = {}) => {
    // Skip audit for system tables
    if (entityName.startsWith('_')) return;

    writeAuditEntry({
      entityName,
      entityId: record.id,
      action: 'CREATE',
      beforeData: null,
      afterData: record,
      changedBy: context.changedBy || context.clientIp || null,
      correlationId: context.correlationId || null
    });
  });

  // UPDATE: Capture before in :before, write in :after
  eventBus.on('entity:update:before', (entityName, id, data, context = {}) => {
    // Skip audit for system tables
    if (entityName.startsWith('_')) return;

    try {
      // Fetch current record before it's updated
      const repository = require('../repositories/GenericRepository');
      const beforeRecord = repository.findById(entityName, id, false);

      const key = buildKey(context.correlationId, entityName, id);
      pendingUpdates.set(key, {
        beforeRecord,
        context
      });
    } catch (err) {
      logger.warn('Audit: Could not fetch record before update', { entityName, id, error: err.message });
    }
  });

  eventBus.on('entity:update:after', (entityName, record, context = {}) => {
    // Skip audit for system tables
    if (entityName.startsWith('_')) return;

    const key = buildKey(context.correlationId, entityName, record.id);
    const pending = pendingUpdates.get(key);
    pendingUpdates.delete(key);

    writeAuditEntry({
      entityName,
      entityId: record.id,
      action: 'UPDATE',
      beforeData: pending?.beforeRecord || null,
      afterData: record,
      changedBy: context.changedBy || context.clientIp || pending?.context?.changedBy || pending?.context?.clientIp || null,
      correlationId: context.correlationId || null
    });
  });

  // DELETE: Capture before in :before, write in :after
  eventBus.on('entity:delete:before', (entityName, id, context = {}) => {
    // Skip audit for system tables
    if (entityName.startsWith('_')) return;

    try {
      // Fetch current record before it's deleted
      const repository = require('../repositories/GenericRepository');
      const beforeRecord = repository.findById(entityName, id, false);

      const key = buildKey(context.correlationId, entityName, id);
      pendingDeletes.set(key, {
        beforeRecord,
        context
      });
    } catch (err) {
      logger.warn('Audit: Could not fetch record before delete', { entityName, id, error: err.message });
    }
  });

  eventBus.on('entity:delete:after', (entityName, id, context = {}) => {
    // Skip audit for system tables
    if (entityName.startsWith('_')) return;

    const key = buildKey(context.correlationId, entityName, id);
    const pending = pendingDeletes.get(key);
    pendingDeletes.delete(key);

    writeAuditEntry({
      entityName,
      entityId: id,
      action: 'DELETE',
      beforeData: pending?.beforeRecord || null,
      afterData: null,
      changedBy: context.changedBy || context.clientIp || pending?.context?.changedBy || pending?.context?.clientIp || null,
      correlationId: context.correlationId || null
    });
  });

  logger.info('Audit service listeners registered');
}

/**
 * Query audit trail entries
 * @param {Object} options - Query options
 * @param {string} options.entityName - Filter by entity name
 * @param {number} options.entityId - Filter by entity ID
 * @param {string} options.action - Filter by action (CREATE, UPDATE, DELETE)
 * @param {number} options.limit - Max records to return
 * @param {number} options.offset - Skip records
 */
function queryAuditTrail(options = {}) {
  const db = getDatabase();

  let sql = 'SELECT * FROM _audit_trail WHERE 1=1';
  const params = [];

  if (options.entityName) {
    sql += ' AND entity_name = ?';
    params.push(options.entityName);
  }

  if (options.entityId) {
    sql += ' AND entity_id = ?';
    params.push(options.entityId);
  }

  if (options.action) {
    sql += ' AND action = ?';
    params.push(options.action);
  }

  sql += ' ORDER BY changed_at DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);

    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  return db.prepare(sql).all(...params);
}

/**
 * Static schema definition for the AuditTrail system entity.
 */
function getAuditSchema() {
  return {
    name: 'AuditTrail',
    tableName: '_audit_trail',
    readonly: true,
    system: true,
    columns: [
      { name: 'id', type: 'number', required: true, ui: { readonly: true } },
      { name: 'entity_name', type: 'string', required: true, ui: { readonly: true } },
      { name: 'entity_id', type: 'number', required: true, ui: { readonly: true } },
      { name: 'action', type: 'string', required: true, enumValues: [
        { value: 'CREATE', label: 'Create' },
        { value: 'UPDATE', label: 'Update' },
        { value: 'DELETE', label: 'Delete' }
      ], ui: { readonly: true } },
      { name: 'before_data', type: 'string', customType: 'json', required: false, ui: { readonly: true } },
      { name: 'after_data', type: 'string', customType: 'json', required: false, ui: { readonly: true } },
      { name: 'changed_by', type: 'string', required: false, ui: { readonly: true } },
      { name: 'changed_at', type: 'string', required: true, ui: { readonly: true } },
      { name: 'correlation_id', type: 'string', required: false, ui: { readonly: true } }
    ],
    ui: {
      labelFields: ['entity_name', 'action'],
      readonly: true
    }
  };
}

/**
 * Initialize the audit service
 */
function init() {
  initAuditTable();
  registerListeners();
  systemEntityRegistry.register('AuditTrail', getAuditSchema());
}

module.exports = {
  init,
  queryAuditTrail,
  writeAuditEntry
};
