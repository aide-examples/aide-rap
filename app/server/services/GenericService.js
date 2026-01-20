/**
 * GenericService - Business logic layer for entity operations
 *
 * Provides transaction control and additional business logic
 * on top of GenericRepository
 */

const { getDatabase } = require('../config/database');
const repository = require('../repositories/GenericRepository');
const logger = require('../utils/logger');

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
 * Get a single entity by ID
 */
function getEntity(entityName, id, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Getting ${entityName}`, { id });

  return repository.findById(entityName, id);
}

/**
 * Create a new entity
 */
function createEntity(entityName, data, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Creating ${entityName}`, { data });

  return runInTransaction(() => {
    return repository.create(entityName, data);
  });
}

/**
 * Update an existing entity
 */
function updateEntity(entityName, id, data, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Updating ${entityName}`, { id, data });

  return runInTransaction(() => {
    return repository.update(entityName, id, data);
  });
}

/**
 * Delete an entity
 */
function deleteEntity(entityName, id, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Deleting ${entityName}`, { id });

  return runInTransaction(() => {
    return repository.remove(entityName, id);
  });
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
 */
function batchCreate(entityName, records, correlationId = null) {
  const log = correlationId ? logger.withCorrelation(correlationId) : logger;

  log.debug(`Batch creating ${records.length} ${entityName} records`);

  return runInTransaction(() => {
    const created = [];
    for (const data of records) {
      created.push(repository.create(entityName, data));
    }
    return created;
  });
}

/**
 * Get list of all enabled entities with area information
 */
function getEnabledEntitiesWithAreas() {
  return repository.getEnabledEntitiesWithAreas();
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
  runInTransaction
};
