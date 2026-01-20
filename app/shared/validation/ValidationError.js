/**
 * ValidationError - Structured validation errors
 * Can represent single or multiple errors
 */

class ValidationError extends Error {
  /**
   * @param {Array<Object>|Object} errors - Single error or array of errors
   */
  constructor(errors) {
    // Normalize to array
    const errorArray = Array.isArray(errors) ? errors : [errors];

    // Create error message
    const message = errorArray.length === 1
      ? errorArray[0].message
      : `${errorArray.length} validation errors`;

    super(message);

    this.name = 'ValidationError';
    this.errors = errorArray;
    this.isValidationError = true;

    // For better stack traces
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }

  /**
   * Creates ValidationError from single field error
   * @param {string} field - Field name
   * @param {string} code - Error code (e.g. 'REQUIRED', 'PATTERN_MISMATCH')
   * @param {string} message - Error message
   * @param {*} value - Current value
   * @returns {ValidationError}
   */
  static createFieldError(field, code, message, value = undefined) {
    return new ValidationError({
      field,
      code,
      message,
      value
    });
  }

  /**
   * Returns all field names with errors
   * @returns {Array<string>}
   */
  getFields() {
    return [...new Set(this.errors.map(e => e.field))];
  }

  /**
   * Returns all errors for a specific field
   * @param {string} field - Field name
   * @returns {Array<Object>}
   */
  getErrorsForField(field) {
    return this.errors.filter(e => e.field === field);
  }

  /**
   * Checks if a specific field has errors
   * @param {string} field - Field name
   * @returns {boolean}
   */
  hasErrorForField(field) {
    return this.errors.some(e => e.field === field);
  }

  /**
   * Converts to JSON (for API responses)
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      errors: this.errors
    };
  }
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ValidationError;
} else if (typeof window !== 'undefined') {
  window.ValidationError = ValidationError;
}
