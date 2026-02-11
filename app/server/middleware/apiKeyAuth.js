/**
 * API Key Authentication Middleware
 *
 * Authenticates external service-to-service calls (e.g. from HCL Leap, Power Automate)
 * using an X-API-Key header. Keys are stored as SHA-256 hashes in config.json.
 *
 * Also handles:
 * - X-User-Id header passthrough (Trusted Subsystem pattern for audit trail)
 * - Per-key CORS origin whitelisting
 * - Per-key entity scope restriction
 */

const crypto = require('crypto');

/**
 * Create API key authentication middleware
 * @param {Array} apiKeysConfig - Array of { name, key (sha256 hash), role, entities, cors }
 * @returns {Function} Express middleware
 */
function apiKeyAuth(apiKeysConfig) {
  // Build hash lookup map: sha256(key) → config entry
  const keyMap = new Map();
  for (const entry of (apiKeysConfig || [])) {
    if (entry.key) {
      keyMap.set(entry.key, entry);
    }
  }

  return function(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return next(); // No API key → fall through to session auth

    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const config = keyMap.get(hash);

    if (!config) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Set req.user (same contract as session auth)
    req.user = {
      role: config.role || 'user',
      apiKey: config.name,
      allowedEntities: config.entities || null
    };

    // Pass through user identity from workflow tool (Trusted Subsystem)
    const userId = req.headers['x-user-id'];
    if (userId) {
      req.user.userId = userId;
    }

    // Set CORS headers for this API key's allowed origins
    const origin = req.headers.origin;
    if (origin && config.cors && config.cors.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-User-Id, If-Match, X-Correlation-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Correlation-ID');
      res.setHeader('Vary', 'Origin');
    }

    next();
  };
}

/**
 * Entity scope check middleware
 * Restricts API key access to configured entities (if allowedEntities is set)
 */
function checkEntityScope(req, res, next) {
  if (req.user?.allowedEntities) {
    const entity = req.params.entity;
    if (entity && !req.user.allowedEntities.includes(entity)) {
      return res.status(403).json({ error: `API key does not have access to entity '${entity}'` });
    }
  }
  next();
}

module.exports = { apiKeyAuth, checkEntityScope };
