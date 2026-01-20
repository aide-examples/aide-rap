/**
 * Correlation ID Middleware
 * Generates a unique ID for each request to track it through all services
 */
const { v4: uuidv4 } = require('uuid');

function correlationId(req, res, next) {
  // Use existing correlation ID from header, or generate new one
  const correlationId = req.headers['x-correlation-id'] || uuidv4();

  // Attach to request object
  req.correlationId = correlationId;

  // Add to response headers
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}

module.exports = correlationId;
