/**
 * SystemEntityRegistry - Central registry for system entity schemas
 *
 * System entities (like AuditTrail) are not defined in DataModel.md but need
 * their schemas available in /api/meta for the UI to render them.
 *
 * Usage:
 *   const registry = require('./utils/SystemEntityRegistry');
 *   registry.register('AuditTrail', { name: 'AuditTrail', ... });
 *
 * In /api/meta:
 *   Object.assign(schemas, registry.getAll());
 */

const schemas = new Map();

module.exports = {
  /**
   * Register a system entity schema
   * @param {string} name - Entity name (e.g. 'AuditTrail')
   * @param {Object} schema - Extended schema object
   */
  register(name, schema) {
    schemas.set(name, schema);
  },

  /**
   * Get all registered system entity schemas
   * @returns {Object} Map of name → schema
   */
  getAll() {
    return Object.fromEntries(schemas);
  },

  /**
   * Get a single system entity schema
   * @param {string} name
   * @returns {Object|undefined}
   */
  get(name) {
    return schemas.get(name);
  }
};
