/**
 * Backend Server Module
 *
 * Initializes database, middleware, and routes
 * Called from main rap.js
 */

const path = require('path');
const express = require('express');
const { initDatabase, closeDatabase } = require('./config/database');
const { correlationId, requestLogger, errorHandler } = require('./middleware');
const GenericCrudRouter = require('./routers/GenericCrudRouter');
const ComputedFieldService = require('./services/ComputedFieldService');
const logger = require('./utils/logger');

/**
 * Initialize the backend
 * @param {Express} app - Express application instance
 * @param {Object} config - Configuration object
 * @param {string} config.appDir - Application directory
 * @param {string[]} config.enabledEntities - List of enabled entity names
 * @param {Object} config.paths - System-specific paths
 * @param {string} config.paths.data - Data directory
 * @param {string} config.paths.docs - Docs/requirements directory
 * @param {string} config.paths.database - Database filename
 */
function init(app, config) {
  const { appDir, enabledEntities, paths } = config;

  // Paths (use config paths if provided, fallback to legacy paths)
  const dbPath = paths ? path.join(paths.data, paths.database) : path.join(appDir, 'data', 'rap.sqlite');
  const dataModelPath = paths ? path.join(paths.docs, 'DataModel.md') : path.join(appDir, 'docs', 'requirements', 'DataModel.md');

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

  // Apply DEFAULT values to NULL fields at startup
  try {
    const defaultResult = ComputedFieldService.applyDefaults();
    if (defaultResult.updated > 0) {
      logger.info('DEFAULT values applied at startup', defaultResult);
    }
  } catch (err) {
    logger.error('Failed to apply DEFAULT values', { error: err.message });
  }

  // Run computed field updates (DAILY fields) at startup
  try {
    const result = ComputedFieldService.runAll();
    if (result.processed > 0) {
      logger.info('Computed fields updated at startup', result);
    }
  } catch (err) {
    logger.error('Failed to run computed field updates', { error: err.message });
  }

  // Schedule daily computation at midnight
  ComputedFieldService.scheduleDailyRun();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, closing database');
    ComputedFieldService.stopScheduler();
    closeDatabase();
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, closing database');
    ComputedFieldService.stopScheduler();
    closeDatabase();
  });

  return {
    closeDatabase
  };
}

module.exports = {
  init
};
