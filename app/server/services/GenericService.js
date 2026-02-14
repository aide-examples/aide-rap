/**
 * GenericService - Business logic layer for entity operations
 *
 * Provides transaction control and additional business logic
 * on top of GenericRepository.
 *
 * Emits events via EventBus for extensibility:
 *   entity:create:before (entityName, data)
 *   entity:create:after  (entityName, record)
 *   entity:update:before (entityName, id, data)
 *   entity:update:after  (entityName, record)
 *   entity:delete:before (entityName, id)
 *   entity:delete:after  (entityName, id)
 */

const { getDatabase } = require('../config/database');
const repository = require('../repositories/GenericRepository');
const logger = require('../utils/logger');
const eventBus = require('../utils/EventBus');

/**
 * Run operations within a transaction
 * @param {Function} fn - Function to execute within transaction
 */
function runInTransaction(fn) {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    return fn();
  });

  return transaction();
}

/**
 * List all entities with optional filtering and pagination
 */
function listEntities(entityName, options = {}, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Listing ${entityName}`, { options });

  return repository.findAll(entityName, options);
}

/**
 * Get filtered FK options based on PAIRS dependencies
 */
function getFilteredFkOptions(entityName, targetField, sourceField, sourceValue, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;
  log.debug(`FK filter: ${entityName}.${targetField} where ${sourceField}=${sourceValue}`);
  return repository.findFilteredFkOptions(entityName, targetField, sourceField, sourceValue);
}

/**
 * Get a single entity by ID
 */
function getEntity(entityName, id, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Getting ${entityName}`, { id });

  return repository.findById(entityName, id);
}

/**
 * Create a new entity
 * Emits: entity:create:before, entity:create:after
 * @param {string} entityName - Entity name
 * @param {Object} data - Record data
 * @param {Object} context - Request context { correlationId, clientIp }
 */
function createEntity(entityName, data, context = {}) {
  // Support legacy correlationId parameter
  if (typeof context === 'string') {
    context = { correlationId: context };
  }
  const log = context.correlationId ? logger.withCorrelation(context.correlationId) : logger;

  log.debug(`Creating ${entityName}`, { data });

  // Before hook (can throw to abort)
  eventBus.emit('entity:create:before', entityName, data, context);

  const result = runInTransaction(() => {
    return repository.create(entityName, data);
  });

  // After hook (informational, includes context for audit)
  eventBus.emit('entity:create:after', entityName, result, context);

  return result;
}

/**
 * Update an existing entity
 * Emits: entity:update:before, entity:update:after
 * @param {string} entityName - Entity name
 * @param {number} id - Record ID
 * @param {Object} data - Update data
 * @param {number|null} expectedVersion - Expected version for OCC (null = skip check)
 * @param {Object} context - Request context { correlationId, clientIp }
 */
function updateEntity(entityName, id, data, expectedVersion = null, context = {}) {
  // Support legacy correlationId parameter
  if (typeof context === 'string') {
    context = { correlationId: context };
  }
  const log = context.correlationId ? logger.withCorrelation(context.correlationId) : logger;

  log.debug(`Updating ${entityName}`, { id, data, expectedVersion });

  // Before hook (can throw to abort, includes context for audit)
  eventBus.emit('entity:update:before', entityName, id, data, context);

  const result = runInTransaction(() => {
    return repository.update(entityName, id, data, expectedVersion);
  });

  // After hook (informational, includes context for audit)
  eventBus.emit('entity:update:after', entityName, result, context);

  return result;
}

/**
 * Delete an entity
 * Emits: entity:delete:before, entity:delete:after
 * @param {string} entityName - Entity name
 * @param {number} id - Record ID
 * @param {Object} context - Request context { correlationId, clientIp }
 */
function deleteEntity(entityName, id, context = {}) {
  // Support legacy correlationId parameter
  if (typeof context === 'string') {
    context = { correlationId: context };
  }
  const log = context.correlationId ? logger.withCorrelation(context.correlationId) : logger;

  log.debug(`Deleting ${entityName}`, { id });

  // Before hook (can throw to abort, includes context for audit)
  eventBus.emit('entity:delete:before', entityName, id, context);

  const result = runInTransaction(() => {
    return repository.remove(entityName, id);
  });

  // After hook (informational, includes context for audit)
  eventBus.emit('entity:delete:after', entityName, id, context);

  return result;
}

/**
 * Get schema information for an entity
 */
function getSchema(entityName) {
  return repository.getSchemaInfo(entityName);
}

/**
 * Get extended schema with UI metadata for an entity
 */
function getExtendedSchema(entityName) {
  return repository.getExtendedSchemaInfo(entityName);
}

/**
 * Get list of all enabled entities
 */
function getEnabledEntities() {
  return repository.getEnabledEntities();
}

/**
 * Get back-references to a specific record
 */
function getBackReferences(entityName, id, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Getting back-references for ${entityName}`, { id });

  return repository.getBackReferences(entityName, id);
}

/**
 * Batch create multiple records (within transaction)
 * Emits: entity:batch:before, entity:batch:after
 */
function batchCreate(entityName, records, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Batch creating ${records.length} ${entityName} records`);

  // Before hook (can throw to abort)
  eventBus.emit('entity:batch:before', entityName, records);

  const result = runInTransaction(() => {
    const created = [];
    for (const data of records) {
      created.push(repository.create(entityName, data));
    }
    return created;
  });

  // After hook (informational)
  eventBus.emit('entity:batch:after', entityName, result);

  return result;
}

/**
 * Get list of all enabled entities with area information
 */
function getEnabledEntitiesWithAreas() {
  return repository.getEnabledEntitiesWithAreas();
}

/**
 * Get distinct values for a column (for prefilter dropdowns)
 * @param {string} entityName - Entity name
 * @param {string} columnPath - Column path
 * @param {string} extractType - 'select' (default), 'year', or 'month'
 */
function getDistinctValues(entityName, columnPath, extractType = 'select') {
  return repository.getDistinctValues(entityName, columnPath, extractType);
}

module.exports = {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  getSchema,
  getExtendedSchema,
  getEnabledEntities,
  getEnabledEntitiesWithAreas,
  getBackReferences,
  batchCreate,
  runInTransaction,
  getDistinctValues,
  getFilteredFkOptions
};
