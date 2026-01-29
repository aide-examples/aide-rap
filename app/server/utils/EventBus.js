/**
 * EventBus - Central event system for application-wide hooks
 *
 * Provides a publish/subscribe mechanism for decoupled communication
 * between components. Supports both synchronous and async event handling.
 *
 * Usage:
 *   const eventBus = require('./EventBus');
 *
 *   // Subscribe to events
 *   eventBus.on('entity:create:after', (entity, record) => {
 *     console.log(`Created ${entity} record:`, record.id);
 *   });
 *
 *   // Before-hooks can throw to abort operation
 *   eventBus.on('entity:create:before', (entity, data) => {
 *     if (data.name === 'forbidden') {
 *       throw new Error('Name not allowed');
 *     }
 *   });
 *
 * Event naming convention:
 *   {domain}:{action}:{timing}
 *   - domain: 'entity', 'schema', 'auth', etc.
 *   - action: 'create', 'update', 'delete', 'reload', etc.
 *   - timing: 'before', 'after'
 *
 * Standard events:
 *   entity:create:before  (entityName, data)
 *   entity:create:after   (entityName, record)
 *   entity:update:before  (entityName, id, data)
 *   entity:update:after   (entityName, record)
 *   entity:delete:before  (entityName, id)
 *   entity:delete:after   (entityName, id)
 *   schema:reload:before  ()
 *   schema:reload:after   (schema)
 */

const logger = require('./logger');

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to an event (fires once then auto-unsubscribes)
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   */
  once(event, callback) {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, []);
    }
    this.onceListeners.get(event).push(callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler to remove
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event synchronously (fire-and-forget)
   * Used for informational events (after-hooks)
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to handlers
   */
  emit(event, ...args) {
    const callbacks = this.listeners.get(event) || [];
    const onceCallbacks = this.onceListeners.get(event) || [];

    // Clear once listeners before executing
    if (onceCallbacks.length > 0) {
      this.onceListeners.set(event, []);
    }

    for (const callback of [...callbacks, ...onceCallbacks]) {
      try {
        callback(...args);
      } catch (err) {
        logger.error(`EventBus: Error in listener for "${event}"`, {
          error: err.message,
          stack: err.stack
        });
      }
    }
  }

  /**
   * Emit an event asynchronously with potential abort
   * Used for before-hooks that can prevent operations
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to handlers
   * @throws {Error} If any handler throws (operation should be aborted)
   */
  async emitAsync(event, ...args) {
    const callbacks = this.listeners.get(event) || [];
    const onceCallbacks = this.onceListeners.get(event) || [];

    // Clear once listeners before executing
    if (onceCallbacks.length > 0) {
      this.onceListeners.set(event, []);
    }

    for (const callback of [...callbacks, ...onceCallbacks]) {
      // Let errors propagate (for before-hooks that want to abort)
      await callback(...args);
    }
  }

  /**
   * Get count of listeners for an event
   * @param {string} event - Event name
   * @returns {number} Number of listeners
   */
  listenerCount(event) {
    const regular = this.listeners.get(event)?.length || 0;
    const once = this.onceListeners.get(event)?.length || 0;
    return regular + once;
  }

  /**
   * Get all registered event names
   * @returns {string[]} Array of event names
   */
  eventNames() {
    const names = new Set([
      ...this.listeners.keys(),
      ...this.onceListeners.keys()
    ]);
    return Array.from(names);
  }

  /**
   * Remove all listeners (useful for testing)
   */
  removeAllListeners() {
    this.listeners.clear();
    this.onceListeners.clear();
  }
}

// Export singleton instance
module.exports = new EventBus();
