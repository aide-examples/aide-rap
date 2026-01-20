/**
 * Base Error Class for all application errors
 * Provides consistent error handling with HTTP status codes
 */
class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {string} type - Error type identifier
   * @param {any} details - Additional error details
   */
  constructor(message, statusCode = 500, type = 'AppError', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.type = type;
    this.details = details;
    this.isOperational = true; // Operational errors are expected

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON response format
   */
  toJSON() {
    return {
      type: this.type,
      message: this.message,
      ...(this.details && { details: this.details })
    };
  }
}

module.exports = AppError;
