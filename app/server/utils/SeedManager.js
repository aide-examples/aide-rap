/**
 * SeedManager - Facade for seed data management
 *
 * This module is the ONLY file with access to global state (database singleton,
 * EventBus, module-level SEED_DIR/mediaService). All sub-modules in seed/
 * receive dependencies as explicit parameters — no hidden singleton imports.
 *
 * Public API is unchanged: all 24 exported functions keep their original signatures.
 */

const fs = require('fs');
const path = require('path');
const eventBus = require('./EventBus');
const LabelResolver = require('./seed/LabelResolver');
const FKResolver = require('./seed/FKResolver');
const ImportValidator = require('./seed/ImportValidator');
const DataLoader = require('./seed/DataLoader');
const BackupManager = require('./seed/BackupManager');
const RefreshManager = require('./seed/RefreshManager');

// Module-level seed directory (configured via init())
let SEED_DIR = null;

// Module-level MediaService instance (for resolving media URLs during seeding)
let mediaService = null;

// --- Global state accessors ---

/**
 * Initialize SeedManager with a specific seed directory
 * @param {string} seedDir - Path to the seed directory
 * @param {Object} [options] - Optional configuration
 * @param {Object} [options.mediaService] - MediaService instance for URL-based media seeding
 */
function init(seedDir, options = {}) {
  SEED_DIR = seedDir;
  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }
  if (options.mediaService) {
    mediaService = options.mediaService;
  }
}

/**
 * Set MediaService instance (can be called after init if MediaService is created later)
 * @param {Object} service - MediaService instance
 */
function setMediaService(service) {
  mediaService = service;
}

function getSeedDir() {
  if (!SEED_DIR) {
    throw new Error('SeedManager not initialized. Call init(seedDir) first.');
  }
  return SEED_DIR;
}

function getBackupDir() {
  return path.join(path.dirname(getSeedDir()), 'backup');
}

function getImportDir() {
  return path.join(path.dirname(getSeedDir()), 'import');
}

function getDbAndSchema() {
  const { getDatabase, getSchema } = require('../config/database');
  return { db: getDatabase(), schema: getSchema() };
}

/** Get TypeRegistry instance (lazy, cached) */
function getTypeRegistry() {
  const { getTypeRegistry: getTR } = require('../../shared/types/TypeRegistry');
  return getTR();
}

/** Common options bundle for sub-module calls */
function getLoaderOptions(extra = {}) {
  return { mediaService, typeRegistry: getTypeRegistry(), ...extra };
}

// --- Facade delegation functions ---

function getStatus() {
  const { db, schema } = getDbAndSchema();
  return ImportValidator.getStatus(db, schema, getSeedDir(), getBackupDir(), getImportDir());
}

function validateImport(entityName, records) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    return { valid: false, warnings: [{ message: `Entity ${entityName} not found` }], recordCount: 0, validCount: 0, invalidRows: [], conflicts: [] };
  }
  return ImportValidator.validateImport(db, entity, schema, records, getSeedDir());
}

async function loadEntity(entityName, lookups = null, options = {}) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  // Resolve source directory from option string
  const { sourceDir = 'seed', ...restOptions } = options;
  let resolvedSourceDir;
  if (sourceDir === 'import') resolvedSourceDir = getImportDir();
  else if (sourceDir === 'backup') resolvedSourceDir = getBackupDir();
  else resolvedSourceDir = getSeedDir();

  // Emit before event
  const seedFile = path.join(resolvedSourceDir, `${entityName}.json`);
  if (fs.existsSync(seedFile)) {
    try {
      const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
      eventBus.emit('seed:load:before', entityName, Array.isArray(records) ? records.length : 0);
    } catch {
      eventBus.emit('seed:load:before', entityName, 0);
    }
  }

  const result = await DataLoader.loadEntity(db, entity, schema, resolvedSourceDir, getSeedDir(), lookups,
    getLoaderOptions(restOptions));

  // Emit after events
  eventBus.emit('seed:load:after', entityName, result);
  eventBus.emit('entity:changed', entityName);

  return result;
}

function clearEntity(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }
  return DataLoader.clearEntity(db, entity, schema);
}

async function loadAll() {
  const { db, schema } = getDbAndSchema();
  const seedDir = getSeedDir();

  // Collect entities with seed files for the before event
  const entitiesToLoad = schema.orderedEntities
    .filter(e => fs.existsSync(path.join(seedDir, `${e.className}.json`)))
    .map(e => e.className);
  eventBus.emit('seed:loadAll:before', entitiesToLoad);

  const results = await DataLoader.loadAll(db, schema, seedDir, getLoaderOptions());

  // Emit per-entity events
  for (const entityName of Object.keys(results)) {
    if (!results[entityName].error) {
      eventBus.emit('entity:changed', entityName);
    }
  }
  eventBus.emit('seed:loadAll:after', results);

  return results;
}

async function importAll() {
  const { db, schema } = getDbAndSchema();
  const importDir = getImportDir();
  const seedDir = getSeedDir();

  // Collect entities for the before event
  const entitiesToLoad = schema.orderedEntities
    .filter(e =>
      fs.existsSync(path.join(importDir, `${e.className}.json`)) ||
      fs.existsSync(path.join(seedDir, `${e.className}.json`))
    )
    .map(e => e.className);
  eventBus.emit('seed:importAll:before', entitiesToLoad);

  const results = await DataLoader.importAll(db, schema, importDir, seedDir, getLoaderOptions());

  // Emit per-entity events
  for (const entityName of Object.keys(results)) {
    if (!results[entityName].error) {
      eventBus.emit('entity:changed', entityName);
    }
  }
  eventBus.emit('seed:importAll:after', results);

  return results;
}

function clearAll() {
  const { db, schema } = getDbAndSchema();
  const results = DataLoader.clearAll(db, schema);

  eventBus.emit('seed:clearAll:after', results);
  return results;
}

async function resetAll() {
  const clearResults = clearAll();
  const loadResults = await loadAll();
  return { cleared: clearResults, loaded: loadResults };
}

function uploadEntity(entityName, jsonData) {
  const { schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }
  return BackupManager.uploadEntity(entity, getSeedDir(), jsonData);
}

function buildLabelLookup(entityName) {
  const { db, schema } = getDbAndSchema();
  return LabelResolver.buildLabelLookup(db, schema.entities[entityName]);
}

function resolveConceptualFKs(entityName, record, lookups) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) return { resolved: record, fkWarnings: [], fuzzyMatches: [] };

  // Create findByUniqueFn that resolves entity names to schema objects
  const findByUniqueFn = (targetEntityName, value) => {
    const targetEntity = schema.entities[targetEntityName];
    return targetEntity ? FKResolver.findByUniqueField(db, targetEntity, value) : null;
  };

  const result = FKResolver.resolveConceptualFKs(entity, record, lookups, schema, findByUniqueFn);

  // Emit warnings for unresolved FKs (moved from FKResolver)
  for (const fkWarn of result.fkWarnings) {
    console.warn(`  Warning: Could not resolve ${fkWarn.field}="${fkWarn.value}" for ${entityName}`);
    eventBus.emit('seed:resolve:warning', { entityName, field: fkWarn.field, value: fkWarn.value, targetEntity: fkWarn.targetEntity });
  }

  return result;
}

function countSeedConflicts(entityName, sourceDir = 'seed') {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) return { dbRowCount: 0, conflictCount: 0 };

  // Resolve source directory
  let resolvedDir;
  if (sourceDir === 'import') resolvedDir = getImportDir();
  else if (sourceDir === 'backup') resolvedDir = getBackupDir();
  else resolvedDir = getSeedDir();

  return ImportValidator.countSeedConflicts(db, entity, schema, resolvedDir, getSeedDir());
}

function backupAll() {
  const { db, schema } = getDbAndSchema();
  const result = BackupManager.backupAll(db, schema, getBackupDir());

  eventBus.emit('seed:backup:after', { backupDir: result.backupDir, results: result.entities });
  return result;
}

async function restoreEntity(entityName) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  const backupDir = getBackupDir();
  eventBus.emit('seed:restore:entity:before', { entityName, backupDir });

  const result = await BackupManager.restoreEntity(db, entity, schema, backupDir, getSeedDir(), getLoaderOptions());

  eventBus.emit('entity:changed', entityName);
  return result;
}

async function restoreBackup() {
  const { db, schema } = getDbAndSchema();
  const backupDir = getBackupDir();

  eventBus.emit('seed:restore:before', { backupDir });

  const results = await BackupManager.restoreBackup(db, schema, backupDir, getSeedDir(), getLoaderOptions());

  // Emit per-entity events
  for (const entityName of Object.keys(results)) {
    if (!results[entityName].error) {
      eventBus.emit('entity:changed', entityName);
    }
  }
  return results;
}

function refreshEntity(entityName, apiRecords, matchConfig, options = {}) {
  const { db, schema } = getDbAndSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }
  return RefreshManager.refreshEntity(db, entity, schema, apiRecords, matchConfig, options);
}

module.exports = {
  init,
  setMediaService,
  getSeedDir,
  getBackupDir,
  getImportDir,
  getStatus,
  validateImport,
  loadEntity,
  clearEntity,
  loadAll,
  importAll,
  clearAll,
  resetAll,
  uploadEntity,
  buildLabelLookup,
  resolveConceptualFKs,
  countSeedConflicts,
  backupAll,
  restoreEntity,
  restoreBackup,
  refreshEntity,
  // Export getter for path (for testing and external access)
  get SEED_DIR() { return getSeedDir(); }
};
