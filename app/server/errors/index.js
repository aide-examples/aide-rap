/**
 * Central export for all error classes
 */
const AppError = require('./AppError');
const { ValidationError, InvalidInputError, SchemaValidationError } = require('./ValidationError');
const { NotFoundError, EntityNotFoundError } = require('./NotFoundError');
const { ConflictError, ForeignKeyConstraintError, UniqueConstraintError } = require('./ConflictError');

module.exports = {
  // Base
  AppError,

  // Validation (400)
  ValidationError,
  InvalidInputError,
  SchemaValidationError,

  // Not Found (404)
  NotFoundError,
  EntityNotFoundError,

  // Conflict (409)
  ConflictError,
  ForeignKeyConstraintError,
  UniqueConstraintError
};
