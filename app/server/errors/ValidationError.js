/**
 * ValidationError - For invalid input data (HTTP 400)
 */
const AppError = require('./AppError');

class ValidationError extends AppError {
  /**
   * @param {string|string[]} details - Validation error details
   * @param {string} message - Optional custom message
   */
  constructor(details, message = 'Validation failed') {
    const detailsArray = Array.isArray(details) ? details : [details];
    super(message, 400, 'ValidationError', detailsArray);
  }
}

/**
 * InvalidInputError - For specific invalid input
 */
class InvalidInputError extends ValidationError {
  constructor(field, reason) {
    super(`${field}: ${reason}`, `Invalid input for field '${field}'`);
    this.field = field;
  }
}

/**
 * SchemaValidationError - For JSON schema validation failures
 */
class SchemaValidationError extends ValidationError {
  constructor(errors) {
    super(errors, 'Schema validation failed');
  }
}

module.exports = { ValidationError, InvalidInputError, SchemaValidationError };
