/**
 * Central export for all middleware
 */
const errorHandler = require('./errorHandler');
const requestLogger = require('./requestLogger');
const correlationId = require('./correlationId');
const { authMiddleware, optionalAuth, requireRole } = require('./auth');

module.exports = {
  errorHandler,
  requestLogger,
  correlationId,
  authMiddleware,
  optionalAuth,
  requireRole,
};
