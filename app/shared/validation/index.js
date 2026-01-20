/**
 * Validation Module Exports
 * Central export file for easy imports
 */

const ObjectValidator = require('./ObjectValidator.js');
const ValidationError = require('./ValidationError.js');

module.exports = {
  ObjectValidator,
  ValidationError
};
