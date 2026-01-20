/**
 * NotFoundError - For resources that don't exist (HTTP 404)
 */
const AppError = require('./AppError');

class NotFoundError extends AppError {
  /**
   * @param {string} resource - Type of resource not found
   * @param {string} identifier - Resource identifier
   */
  constructor(resource, identifier = null) {
    const message = identifier
      ? `${resource} with ID '${identifier}' not found`
      : `${resource} not found`;

    super(message, 404, 'NotFoundError');
    this.resource = resource;
    this.identifier = identifier;
  }
}

/**
 * EntityNotFoundError - For entity records not found
 */
class EntityNotFoundError extends NotFoundError {
  constructor(entityType, id) {
    super(entityType, id);
  }
}

module.exports = { NotFoundError, EntityNotFoundError };
