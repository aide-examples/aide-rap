/**
 * Backend Server Module
 *
 * Initializes database, middleware, and routes
 * Called from main irma.js
 */

const path = require('path');
const express = require('express');
const { initDatabase, closeDatabase } = require('./config/database');
const { correlationId, requestLogger, errorHandler } = require('./middleware');
const GenericCrudRouter = require('./routers/GenericCrudRouter');
const logger = require('./utils/logger');

/**
 * Initialize the backend
 * @param {Express} app - Express application instance
 * @param {Object} config - Configuration object
 * @param {string} config.appDir - Application directory
 * @param {string[]} config.enabledEntities - List of enabled entity names
 */
function init(app, config) {
  const { appDir, enabledEntities } = config;

  // Paths
  const dbPath = path.join(appDir, 'data', 'irma.sqlite');
  const dataModelPath = path.join(appDir, 'docs', 'requirements', 'DataModel.md');

  // Initialize database
  initDatabase(dbPath, dataModelPath, enabledEntities);

  // Middleware (before routes)
  app.use(correlationId);
  app.use(requestLogger);

  // JSON body parser for API routes
  app.use('/api/entities', express.json());

  // Mount CRUD router
  app.use('/api/entities', GenericCrudRouter);

  // Error handler (after routes)
  app.use('/api', errorHandler);

  logger.info('Backend initialized', {
    enabledEntities,
    dbPath,
    dataModelPath
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, closing database');
    closeDatabase();
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, closing database');
    closeDatabase();
  });

  return {
    closeDatabase
  };
}

module.exports = {
  init
};
