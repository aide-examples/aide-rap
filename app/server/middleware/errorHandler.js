/**
 * Central Error Handler Middleware
 * Handles all errors and sends appropriate responses
 */
const logger = require('../utils/logger');
const { AppError, VersionConflictError } = require('../errors');
const { ValidationError } = require('../../shared/validation');

function errorHandler(err, req, res, next) {
  const correlationId = req.correlationId || 'unknown';

  // Log error with full details
  logger.error('Error occurred', {
    correlationId,
    error: err.message,
    stack: err.stack,
    type: err.constructor.name,
    path: req.path,
    method: req.method,
    ...(err.details && { details: err.details }),
  });

  // Determine if this is an operational error
  const isOperational = err.isOperational || err instanceof AppError;

  // Default error response
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let errorMessage = 'An internal error occurred';
  let errorDetails = null;

  // Handle operational errors
  if (isOperational) {
    statusCode = err.statusCode;
    errorCode = err.type;
    errorMessage = err.message;
    errorDetails = err.details;
  }

  // Handle ValidationError specially
  if (err.isValidationError || err instanceof ValidationError) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    errorMessage = err.message;
    errorDetails = err.errors; // Array of field errors
  }

  // Handle VersionConflictError specially (OCC)
  if (err instanceof VersionConflictError) {
    statusCode = 409;
    errorCode = 'VERSION_CONFLICT';
    errorMessage = err.message;
    errorDetails = {
      entityType: err.entityType,
      id: err.id,
      expectedVersion: err.expectedVersion,
      currentRecord: err.currentRecord
    };
  }

  // Standardized error response format
  const response = {
    error: {
      code: errorCode,
      message: errorMessage,
      correlationId,
      ...(errorDetails && { details: errorDetails })
    }
  };

  // In development, include stack trace
  if (process.env.NODE_ENV !== 'production') {
    response.error.stack = err.stack;
  }

  // Send response
  res.status(statusCode).json(response);

  // For non-operational errors in production, consider alerting
  if (!isOperational && process.env.NODE_ENV === 'production') {
    logger.error('Non-operational error detected!', {
      correlationId,
      error: err.message,
      stack: err.stack,
    });
  }
}

module.exports = errorHandler;
