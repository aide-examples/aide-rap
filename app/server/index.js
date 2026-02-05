/**
 * Backend Server Module
 *
 * Initializes database, middleware, and routes
 * Called from main rap.js
 */

const path = require('path');
const express = require('express');
const { initDatabase, closeDatabase, watchViewsFile } = require('./config/database');
const { correlationId, requestLogger, errorHandler } = require('./middleware');
const GenericCrudRouter = require('./routers/GenericCrudRouter');
const AuditRouter = require('./routers/audit.router');
const mediaRouter = require('./routers/media.router');
const adminRouter = require('./routers/admin.router');
const ComputedFieldService = require('./services/ComputedFieldService');
const CalculationService = require('./services/CalculationService');
const AuditService = require('./services/AuditService');
const MediaService = require('./services/MediaService');
const SeedManager = require('./utils/SeedManager');
const logger = require('./utils/logger');

/**
 * Initialize the backend
 * @param {Express} app - Express application instance
 * @param {Object} config - Configuration object
 * @param {string} config.appDir - Application directory
 * @param {string[]} config.enabledEntities - List of enabled entity names
 * @param {Object} config.entityPrefilters - Prefilter fields per entity { entityName: ['field1', 'field2'] }
 * @param {Object} config.requiredFilters - Required filter fields per entity { entityName: ['field1'] }
 * @param {Object} config.paths - System-specific paths
 * @param {string} config.paths.data - Data directory
 * @param {string} config.paths.docs - Docs directory (contains DataModel.md, classes/, ui/, imports/)
 * @param {string} config.paths.database - Database filename
 */
function init(app, config) {
  const { appDir, enabledEntities, entityPrefilters, requiredFilters, entityTableOptions, paths, viewsConfig } = config;

  // Paths (use config paths if provided, fallback to legacy paths)
  const dbPath = paths ? path.join(paths.data, paths.database) : path.join(appDir, 'data', 'rap.sqlite');
  const dataModelPath = paths ? path.join(paths.docs, 'DataModel.md') : path.join(appDir, 'docs', 'DataModel.md');

  // Initialize database
  initDatabase(dbPath, dataModelPath, enabledEntities, viewsConfig, entityPrefilters, requiredFilters, entityTableOptions);

  // Watch Views.md for hot-reload (development convenience)
  watchViewsFile();

  // Initialize audit trail (after database)
  AuditService.init();

  // Initialize media service (after database)
  const mediaPath = paths?.media || path.join(paths?.data || path.join(appDir, 'data'), 'media');
  const mediaService = new MediaService(mediaPath, config);

  // Sync existing media files from disk to database
  // (handles case where files exist but DB was reset or table was missing)
  const syncResult = mediaService.rebuildIndex();
  if (syncResult.count > 0) {
    logger.info(`Synced ${syncResult.count} media files from disk to database`);
  }

  // Rebuild media references from entity data
  // (handles case where entities have media IDs but _media_refs is empty)
  const refsResult = mediaService.rebuildReferences();
  if (refsResult.count > 0) {
    logger.info(`Rebuilt ${refsResult.count} media references from entity data`);
  }

  // Register MediaService with SeedManager for URL-based media seeding
  SeedManager.setMediaService(mediaService);

  // Middleware (before routes)
  app.use(correlationId);
  app.use(requestLogger);

  // JSON body parser for API routes
  app.use('/api/entities', express.json());
  app.use('/api/audit', express.json());
  app.use('/api/media', express.json());

  // Mount CRUD router
  app.use('/api/entities', GenericCrudRouter);

  // Mount Audit router (readonly system entity)
  app.use('/api/audit', AuditRouter);

  // Mount Media router (file upload/management)
  app.use('/api/media', mediaRouter(mediaService, config));

  // Mount Admin router (development tools)
  app.use(adminRouter());

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

  // Rebuild server calculations where values are NULL (safety net)
  try {
    const calcResult = CalculationService.rebuildMissingCalculations();
    if (calcResult.totalRowsUpdated > 0) {
      logger.info('Server calculations rebuilt at startup', calcResult);
    }
  } catch (err) {
    logger.error('Failed to rebuild server calculations', { error: err.message });
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
