/**
 * ConflictError - For resource conflicts (HTTP 409)
 */
const AppError = require('./AppError');

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'ConflictError');
  }
}

/**
 * ForeignKeyConstraintError - When FK constraint is violated
 * - On DELETE: blocked by referencing records
 * - On INSERT/UPDATE: referenced record does not exist
 */
class ForeignKeyConstraintError extends ConflictError {
  constructor(entityType, id, referencingEntity, countOrMessage) {
    let message;
    if (typeof countOrMessage === 'number') {
      message = `Cannot delete ${entityType} with ID '${id}': ${countOrMessage} ${referencingEntity} record(s) reference it`;
    } else {
      message = `Cannot create/update ${entityType}: ${countOrMessage}`;
    }
    super(message);
    this.entityType = entityType;
    this.id = id;
    this.referencingEntity = referencingEntity;
  }
}

/**
 * UniqueConstraintError - When insert/update violates unique constraint
 */
class UniqueConstraintError extends ConflictError {
  constructor(entityType, field, value) {
    super(`${entityType} with ${field} '${value}' already exists`);
    this.entityType = entityType;
    this.field = field;
    this.value = value;
  }
}

/**
 * VersionConflictError - When OCC version check fails (concurrent modification)
 * Used to return the current record state so client can show diff or retry
 */
class VersionConflictError extends ConflictError {
  constructor(entityType, id, expectedVersion, currentRecord) {
    super(`${entityType} #${id} was modified by another user (expected version ${expectedVersion}, current ${currentRecord.version})`);
    this.entityType = entityType;
    this.id = id;
    this.expectedVersion = expectedVersion;
    this.currentRecord = currentRecord;
  }
}

module.exports = { ConflictError, ForeignKeyConstraintError, UniqueConstraintError, VersionConflictError };
