/**
 * Central export for all middleware
 */
const errorHandler = require('./errorHandler');
const requestLogger = require('./requestLogger');
const correlationId = require('./correlationId');

module.exports = {
  errorHandler,
  requestLogger,
  correlationId,
};
