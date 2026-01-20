/**
 * Request Logger Middleware
 * Logs API requests only (skips static files)
 */
const logger = require('../utils/logger');

// Skip logging for static files
const SKIP_EXTENSIONS = ['.js', '.css', '.html', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];

function shouldSkipLogging(path) {
  // Skip static file extensions
  if (SKIP_EXTENSIONS.some(ext => path.endsWith(ext))) {
    return true;
  }

  // Skip common static paths
  if (path.startsWith('/static/')) {
    return true;
  }

  if (path.startsWith('/help/') || path.startsWith('/about/') || path.startsWith('/docs-assets/')) {
    return true;
  }

  return false;
}

function requestLogger(req, res, next) {
  // Skip logging for static files
  if (shouldSkipLogging(req.path)) {
    return next();
  }

  const startTime = Date.now();

  // Log request (only API and important routes)
  logger.info('Incoming request', {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
  });

  // Capture response
  const originalSend = res.send;
  res.send = function(data) {
    res.send = originalSend;

    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log response
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[logLevel]('Request completed', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode,
      duration: `${duration}ms`,
    });

    return res.send(data);
  };

  next();
}

module.exports = requestLogger;
