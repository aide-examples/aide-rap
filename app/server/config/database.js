/**
 * Database Configuration and Initialization
 *
 * Simplified approach for development:
 * - Compare overall schema hash
 * - If changed: drop all tables and recreate
 * - No complex migration logic
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const eventBus = require('../utils/EventBus');
const { generateSchema, generateCreateTableSQL, generateViewSQL, generatePairsSQL } = require('../utils/SchemaGenerator');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const { parseAllUserViews, generateUserViewSQL } = require('../utils/UserViewGenerator');

let db = null;
let schema = null;
let storedViewsConfig = null;
let storedDbPath = null;
let storedDataModelPath = null;
let storedEnabledEntities = null;
let storedEntityPrefilters = null;
let storedRequiredFilters = null;
let storedTableOptions = null;
let metaVersion = 1;

/**
 * Check if table exists
 */
function tableExists(tableName) {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  return !!result;
}

/**
 * Check if view exists
 */
function viewExists(viewName) {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name=?"
  ).get(viewName);
  return !!result;
}

/**
 * Create or recreate a view for an entity
 * @param {Object} entity - Entity definition
 * @param {Object} schemaOverride - Optional schema override (defaults to module-level schema)
 */
function createOrReplaceView(entity, schemaOverride = null) {
  const viewName = entity.tableName + '_view';
  const effectiveSchema = schemaOverride || schema;
  const viewSQL = generateViewSQL(entity, effectiveSchema);

  if (viewExists(viewName)) {
    db.exec(`DROP VIEW IF EXISTS ${viewName}`);
  }

  db.exec(viewSQL);
  return viewName;
}

/**
 * Compute a hash for the entire schema (all entities + types)
 */
function computeSchemaHash(schema) {
  const data = {
    entities: {},
    types: {}
  };

  // Hash entity structures (columns + constraints)
  // Exclude system columns (_created_at, _updated_at, _version) from hash
  // to prevent unnecessary schema rebuilds when adding system columns
  for (const entity of schema.orderedEntities) {
    data.entities[entity.className] = {
      columns: entity.columns
        .filter(c => !c.system)  // Exclude system columns
        .map(c => ({
          name: c.name,
          type: c.type,
          sqlType: c.sqlType,
          required: c.required,
          unique: c.unique || false,
          foreignKey: c.foreignKey?.references || null,
          defaultValue: c.defaultValue
        })),
      uniqueKeys: entity.uniqueKeys || {},
      indexes: entity.indexes || {}
    };
  }

  // Hash types
  const allTypes = getTypeRegistry().getAllTypes();
  for (const [name, def] of Object.entries(allTypes)) {
    if (def.scope === 'global') {
      if (def.kind === 'pattern') {
        data.types[name] = { kind: 'pattern', pattern: def.pattern };
      } else if (def.kind === 'enum') {
        data.types[name] = { kind: 'enum', values: def.values };
      }
    }
  }

  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

/**
 * Get stored schema hash from _schema_hash table
 */
function getStoredSchemaHash() {
  try {
    const result = db.prepare(
      "SELECT hash FROM _schema_hash WHERE id = 1"
    ).get();
    return result?.hash || null;
  } catch {
    return null; // Table doesn't exist yet
  }
}

/**
 * Save schema hash
 */
function saveSchemaHash(hash) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_hash (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare(`
    INSERT INTO _schema_hash (id, hash, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, updated_at = CURRENT_TIMESTAMP
  `).run(hash);
}

/**
 * Auto-backup all entity data before dropping tables on schema change.
 * Converts FK IDs to label values for portability across schema rebuilds.
 * Only runs when there is existing data and schema has changed.
 * Emits: db:backup:before, db:backup:after
 */
function autoBackupBeforeDrop(orderedEntities) {
  const backupDir = path.join(path.dirname(storedDbPath), 'backup');

  // Emit before event
  eventBus.emit('db:backup:before', { path: backupDir, reason: 'schema-change' });

  let totalRecords = 0;
  const entityData = {};

  // Collect data from existing tables (with FK label resolution)
  for (const entity of orderedEntities) {
    if (!tableExists(entity.tableName)) continue;

    try {
      // Exclude null reference records (_ql=256 at id=1) from backup
      // Use try/catch for _ql column in case of legacy DB without data quality columns
      let rows;
      try {
        rows = db.prepare(`SELECT * FROM ${entity.tableName} WHERE id != 1 OR _ql != 256`).all();
      } catch {
        rows = db.prepare(`SELECT * FROM ${entity.tableName}`).all();
      }
      if (rows.length === 0) continue;

      const exportRows = rows.map(row => {
        const exported = { ...row };
        delete exported.id;

        // Convert FK IDs to label values
        for (const fk of entity.foreignKeys) {
          const idValue = row[fk.column];
          if (idValue === null || idValue === undefined) continue;

          const refEntity = schema.entities[fk.references.entity];
          if (!refEntity || !tableExists(refEntity.tableName)) continue;

          const labelCol = refEntity.columns.find(c => c.ui?.label);
          if (!labelCol) continue;

          try {
            const refRow = db.prepare(
              `SELECT ${labelCol.name} FROM ${refEntity.tableName} WHERE id = ?`
            ).get(idValue);

            if (refRow && refRow[labelCol.name]) {
              exported[fk.displayName] = refRow[labelCol.name];
              delete exported[fk.column];
            }
          } catch {
            // Keep numeric ID if lookup fails
          }
        }

        // Remove computed columns
        for (const col of entity.columns) {
          if (col.computed && !col.foreignKey) {
            delete exported[col.name];
          }
        }

        return exported;
      });

      entityData[entity.className] = exportRows;
      totalRecords += exportRows.length;
    } catch (err) {
      logger.warn(`Auto-backup: could not read ${entity.tableName}`, { error: err.message });
    }
  }

  if (totalRecords === 0) {
    logger.info('Auto-backup: no data to backup');
    return;
  }

  // Write backup files
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const [className, records] of Object.entries(entityData)) {
    const filePath = path.join(backupDir, `${className}.json`);
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  }

  // Clean up backup files for entities with no data
  for (const entity of orderedEntities) {
    if (!entityData[entity.className]) {
      const filePath = path.join(backupDir, `${entity.className}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  logger.info(`Auto-backup: saved ${totalRecords} records from ${Object.keys(entityData).length} entities before schema drop`);

  // Emit after event
  eventBus.emit('db:backup:after', {
    path: backupDir,
    totalRecords,
    entityCount: Object.keys(entityData).length
  });
}

/**
 * Drop all entity tables and views (in reverse dependency order)
 */
function dropAllTables(orderedEntities) {
  // Drop user views (uv_*) first
  const uvViews = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'uv_%'"
  ).all();
  for (const { name } of uvViews) {
    db.exec(`DROP VIEW IF EXISTS ${name}`);
  }

  // Drop entity views
  for (const entity of orderedEntities) {
    const viewName = entity.tableName + '_view';
    if (viewExists(viewName)) {
      db.exec(`DROP VIEW IF EXISTS ${viewName}`);
    }
  }

  // Drop tables in reverse order (to respect FK constraints)
  const reversed = [...orderedEntities].reverse();
  for (const entity of reversed) {
    if (tableExists(entity.tableName)) {
      db.exec(`DROP TABLE IF EXISTS ${entity.tableName}`);
      logger.debug(`Dropped table ${entity.tableName}`);
    }
  }

  // Also drop old metadata table if exists
  db.exec('DROP TABLE IF EXISTS _schema_metadata');
}

/**
 * Migrate system columns (_created_at, _updated_at, _version) for existing tables.
 * - Migrates old unprefixed columns (created_at, updated_at, version) to new prefixed names
 * - Adds columns if missing
 * - Sets default values for existing records with NULL
 * Called: after initDatabase, after restore, after seed load
 */
function migrateSystemColumns(orderedEntities) {
  const now = new Date().toISOString();

  // Old-to-new column name mapping for migration from unprefixed to prefixed
  const oldToNew = {
    'created_at': { newName: '_created_at', sqlType: 'TEXT' },
    'updated_at': { newName: '_updated_at', sqlType: 'TEXT' },
    'version':    { newName: '_version',    sqlType: 'INTEGER DEFAULT 1' }
  };

  for (const entity of orderedEntities) {
    if (!tableExists(entity.tableName)) continue;

    // Check which columns exist
    const columns = db.prepare(`PRAGMA table_info(${entity.tableName})`).all();
    const colNames = columns.map(c => c.name);

    // Migration: copy data from old unprefixed columns to new prefixed columns
    for (const [oldName, { newName, sqlType }] of Object.entries(oldToNew)) {
      if (colNames.includes(oldName) && !colNames.includes(newName)) {
        db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN ${newName} ${sqlType}`);
        db.exec(`UPDATE ${entity.tableName} SET ${newName} = ${oldName}`);
        logger.info(`Migrated ${oldName} → ${newName} in ${entity.tableName}`);
      }
    }

    // Re-check columns after potential migration
    const columnsAfter = db.prepare(`PRAGMA table_info(${entity.tableName})`).all();
    const colNamesAfter = columnsAfter.map(c => c.name);

    // Add missing new-style columns
    if (!colNamesAfter.includes('_created_at')) {
      db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN _created_at TEXT`);
      logger.debug(`Added _created_at to ${entity.tableName}`);
    }
    if (!colNamesAfter.includes('_updated_at')) {
      db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN _updated_at TEXT`);
      logger.debug(`Added _updated_at to ${entity.tableName}`);
    }
    if (!colNamesAfter.includes('_version')) {
      db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN _version INTEGER DEFAULT 1`);
      logger.debug(`Added _version to ${entity.tableName}`);
    }

    // Data quality columns
    if (!colNamesAfter.includes('_ql')) {
      db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN _ql INTEGER DEFAULT 0`);
      logger.debug(`Added _ql to ${entity.tableName}`);
    }
    if (!colNamesAfter.includes('_qd')) {
      db.exec(`ALTER TABLE ${entity.tableName} ADD COLUMN _qd TEXT`);
      logger.debug(`Added _qd to ${entity.tableName}`);
    }

    // Index on _ql for efficient quality filtering
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${entity.tableName}_ql ON ${entity.tableName}(_ql)`);

    // Set default values for existing records with NULL
    const result = db.prepare(`
      UPDATE ${entity.tableName}
      SET _created_at = COALESCE(_created_at, ?),
          _updated_at = COALESCE(_updated_at, ?),
          _version = COALESCE(_version, 1)
      WHERE _created_at IS NULL OR _updated_at IS NULL OR _version IS NULL
    `).run(now, now);

    if (result.changes > 0) {
      logger.info(`Migrated ${result.changes} records in ${entity.tableName} with system columns`);
    }
  }
}

/**
 * Ensure null reference records exist at id=1 for every entity.
 * These are system records with _ql=256, filled with neutral values.
 * Must be called after migrateSystemColumns(), with foreign_keys OFF.
 * Inserts in dependency order (entities without FKs first).
 */
function ensureNullRecords(orderedEntities) {
  const { buildNullRecord } = require('../utils/NeutralValues');

  for (const entity of orderedEntities) {
    // Skip system entities (AuditTrail etc.)
    if (entity.system) continue;
    if (!tableExists(entity.tableName)) continue;

    // Check if id=1 exists and has _ql=256
    const existing = db.prepare(
      `SELECT id, _ql FROM ${entity.tableName} WHERE id = 1`
    ).get();

    if (existing && existing._ql === 256) continue;  // Already correct

    if (existing) {
      // id=1 exists but is a real record → can't insert null record
      logger.warn(`Cannot create null record: id=1 already occupied in ${entity.tableName} (migration needed)`);
      continue;
    }

    // Build null record with neutral values
    const record = buildNullRecord(entity);
    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?');
    const values = columns.map(c => record[c]);

    try {
      db.prepare(
        `INSERT INTO ${entity.tableName} (id, ${columns.join(', ')}) VALUES (1, ${placeholders.join(', ')})`
      ).run(...values);
      logger.debug(`Created null record in ${entity.tableName}`);
    } catch (err) {
      logger.error(`Failed to create null record in ${entity.tableName}: ${err.message}`);
    }
  }
}

/**
 * Create all tables
 */
function createAllTables(orderedEntities) {
  for (const entity of orderedEntities) {
    const { createTable, createIndexes } = generateCreateTableSQL(entity);

    db.exec(createTable);
    logger.debug(`Created table ${entity.tableName}`);

    for (const indexSql of createIndexes) {
      db.exec(indexSql);
    }
  }
}

/**
 * Create all views
 */
function createAllViews(orderedEntities) {
  for (const entity of orderedEntities) {
    createOrReplaceView(entity);
  }
  logger.debug(`Created ${orderedEntities.length} views`);
}

/**
 * Create user-defined views (uv_*) from config
 */
function createUserViews(viewsConfig) {
  if (!viewsConfig || viewsConfig.length === 0) return;

  // Drop existing user views first
  const uvViews = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'uv_%'"
  ).all();
  for (const { name } of uvViews) {
    db.exec(`DROP VIEW IF EXISTS ${name}`);
  }

  const { views, groups } = parseAllUserViews(viewsConfig, schema);

  for (const view of views) {
    if (view.detail) continue;  // Detail views are template-based, no SQL view
    try {
      const sql = generateUserViewSQL(view);
      db.exec(sql);
      logger.debug(`Created user view ${view.sqlName}`);
    } catch (err) {
      logger.error(`Failed to create user view "${view.name}"`, { error: err.message });
    }
  }

  // Store on schema for API access
  schema.userViews = views;
  schema.userViewGroups = groups;

  if (views.length > 0) {
    logger.info(`Created ${views.length} user view(s)`);
  }
}

/**
 * Initialize media tables (system tables for file storage)
 * Called after entity tables are created
 */
function initMediaTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _media (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      extension TEXT,
      width INTEGER,
      height INTEGER,
      has_thumbnail INTEGER DEFAULT 0,
      uploaded_by TEXT,
      source_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _media_refs (
      media_id TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (media_id, entity_name, entity_id, field_name),
      FOREIGN KEY (media_id) REFERENCES _media(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_created ON _media(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_refs_entity ON _media_refs(entity_name, entity_id)`);

  // Migration: add source_url column if missing (for existing databases)
  const columns = db.prepare('PRAGMA table_info(_media)').all();
  const hasSourceUrl = columns.some(c => c.name === 'source_url');
  if (!hasSourceUrl) {
    db.exec('ALTER TABLE _media ADD COLUMN source_url TEXT');
    logger.info('Migration: added source_url column to _media table');
  }

  logger.debug('Media tables initialized');
}

/**
 * Initialize database
 * @param {string} dbPath - Path to SQLite database file
 * @param {string} dataModelPath - Path to DataModel.md
 * @param {string[]} enabledEntities - List of entity names to enable
 * @param {Array} [viewsConfig] - Optional user view definitions
 * @param {Object} [entityPrefilters] - Prefilter fields per entity { entityName: ['field1', 'field2'] }
 * @param {Object} [requiredFilters] - Required filter fields per entity { entityName: ['field1'] }
 * @param {Object} [tableOptions] - Table display options per entity { entityName: { mediaRowHeight: 100 } }
 * @param {boolean} [forceReinit] - Force drop+recreate all tables (--reinit flag)
 */
function initDatabase(dbPath, dataModelPath, enabledEntities, viewsConfig, entityPrefilters, requiredFilters, tableOptions, forceReinit) {
  // Store params for reinitialize()
  storedDbPath = dbPath;
  storedDataModelPath = dataModelPath;
  storedEnabledEntities = enabledEntities;
  storedViewsConfig = viewsConfig || [];
  storedEntityPrefilters = entityPrefilters || {};
  storedRequiredFilters = requiredFilters || {};
  storedTableOptions = tableOptions || {};

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open database
  db = new Database(dbPath);
  db.pragma('foreign_keys = OFF'); // Disable during setup
  db.pragma('journal_mode = WAL'); // Enable WAL for better concurrency

  logger.info('Database opened', { path: dbPath });

  // Generate schema from DataModel.md
  schema = generateSchema(dataModelPath, enabledEntities);

  logger.info('Schema generated', {
    enabledEntities: enabledEntities,
    totalEntities: Object.keys(schema.entities).length
  });

  // Compute current schema hash
  const currentHash = computeSchemaHash(schema);
  const storedHash = getStoredSchemaHash();

  if (forceReinit) {
    logger.info('Force reinitialization requested (--reinit)');
    // Auto-backup existing data before dropping tables
    autoBackupBeforeDrop(schema.orderedEntities);

    // Drop and recreate everything
    dropAllTables(schema.orderedEntities);
    createAllTables(schema.orderedEntities);
    createAllViews(schema.orderedEntities);
    createUserViews(viewsConfig);
    saveSchemaHash(currentHash);

    logger.info('Schema reinitialized (forced)', {
      tables: schema.orderedEntities.length,
      hash: currentHash.substring(0, 8) + '...'
    });
  } else if (storedHash !== currentHash) {
    if (storedHash) {
      logger.info('Schema changed - recreating all tables');
      // Auto-backup existing data before dropping tables
      autoBackupBeforeDrop(schema.orderedEntities);
    } else {
      logger.info('Initial schema setup');
    }

    // Drop and recreate everything
    dropAllTables(schema.orderedEntities);
    createAllTables(schema.orderedEntities);
    createAllViews(schema.orderedEntities);
    createUserViews(viewsConfig);
    saveSchemaHash(currentHash);

    logger.info('Schema initialized', {
      tables: schema.orderedEntities.length,
      hash: currentHash.substring(0, 8) + '...'
    });
  } else {
    logger.info('Schema unchanged', { hash: currentHash.substring(0, 8) + '...' });

    // Still recreate views (they might reference label columns that changed)
    createAllViews(schema.orderedEntities);
    createUserViews(viewsConfig);
  }

  // Migrate: ensure system columns exist and have values
  migrateSystemColumns(schema.orderedEntities);

  // Ensure null reference records exist at id=1 (data quality system)
  ensureNullRecords(schema.orderedEntities);

  // Initialize media storage tables
  initMediaTables();

  // Enable foreign keys for runtime
  db.pragma('foreign_keys = ON');

  return { db, schema };
}

/**
 * Get database instance
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

/**
 * Get schema
 */
function getSchema() {
  if (!schema) {
    throw new Error('Schema not loaded. Call initDatabase first.');
  }
  return schema;
}

/**
 * Get entity prefilters
 * @returns {Object} Map of entity name to prefilter field array
 */
function getEntityPrefilters() {
  return storedEntityPrefilters || {};
}

/**
 * Get required filters (always show filter dialog)
 * @returns {Object} Map of entity name to required filter field array
 */
function getRequiredFilters() {
  return storedRequiredFilters || {};
}

/**
 * Get table display options (from Crud.md)
 * @returns {Object} Map of entity name to table options { entityName: { mediaRowHeight: 100 } }
 */
function getTableOptions() {
  return storedTableOptions || {};
}

/**
 * Close database connection
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    schema = null;
    logger.info('Database closed');
  }
}

/**
 * Force schema rebuild (for CLI --reset)
 */
function forceRebuild() {
  if (!db || !schema) {
    throw new Error('Database not initialized');
  }

  db.pragma('foreign_keys = OFF');

  dropAllTables(schema.orderedEntities);
  createAllTables(schema.orderedEntities);
  createAllViews(schema.orderedEntities);
  createUserViews(storedViewsConfig);

  const hash = computeSchemaHash(schema);
  saveSchemaHash(hash);

  db.pragma('foreign_keys = ON');

  logger.info('Schema rebuilt', { tables: schema.orderedEntities.length });
}

/**
 * Reinitialize views from markdown.
 * Re-reads Views.md and recreates all views (entity + user views).
 * Preserves all table data — does NOT touch tables or schema.
 * For DataModel.md / Types.md changes, use forceRebuild() or restart the server.
 */
function reinitialize() {
  if (!db || !schema || !storedDataModelPath) {
    throw new Error('Cannot reinitialize: database was never initialized');
  }

  db.pragma('foreign_keys = OFF');

  // Re-read DataModel.md and regenerate schema (picks up new entities/columns)
  schema = generateSchema(storedDataModelPath, storedEnabledEntities);

  // Create any new tables (IF NOT EXISTS — safe for existing data)
  createAllTables(schema.orderedEntities);

  // Ensure system columns (_ql, _qd, etc.) exist
  migrateSystemColumns(schema.orderedEntities);

  // Ensure null reference records at id=1 (in canonical dependency order)
  ensureNullRecords(schema.orderedEntities);

  // Re-read views from Views.md (so view changes take effect without restart)
  const requirementsDir = path.dirname(storedDataModelPath);
  const UISpecLoader = require('../utils/UISpecLoader');
  const mdViews = UISpecLoader.loadViewsConfig(requirementsDir);
  if (mdViews) {
    storedViewsConfig = mdViews;
    logger.info('Views reloaded from markdown');
  }

  // Refresh views
  createAllViews(schema.orderedEntities);
  createUserViews(storedViewsConfig);

  db.pragma('foreign_keys = ON');

  logger.info('Database reinitialized', { entities: schema.orderedEntities.length });
  return { success: true, entities: schema.orderedEntities.length };
}

/**
 * Get the current schema hash.
 * Used by Layout-Editor to detect changes.
 */
function getSchemaHash() {
  if (!schema) {
    throw new Error('Schema not loaded');
  }
  return computeSchemaHash(schema);
}

/**
 * Check if the markdown files have changed since last schema load.
 * Parses markdown fresh and compares hashes.
 * @returns {{ changed: boolean, currentHash: string, freshHash: string }}
 */
function checkSchemaChanged() {
  if (!schema || !storedDataModelPath) {
    throw new Error('Schema not loaded');
  }

  const currentHash = computeSchemaHash(schema);

  // Parse markdown fresh (without affecting cached schema)
  const freshSchema = generateSchema(storedDataModelPath, storedEnabledEntities);
  const freshHash = computeSchemaHash(freshSchema);

  return {
    changed: currentHash !== freshHash,
    currentHash,
    freshHash
  };
}

/**
 * Reload schema from markdown files.
 * Updates the cached schema without rebuilding database tables.
 * Note: This only updates the in-memory schema. Table structure is NOT changed.
 * Use forceRebuild() if you need to apply schema changes to the database.
 * Emits: schema:reload:before, schema:reload:after
 * @returns {{ success: boolean, hash: string, warning?: string }}
 */
function reloadSchema() {
  if (!db || !storedDataModelPath) {
    throw new Error('Cannot reload schema: database was never initialized');
  }

  const oldHash = computeSchemaHash(schema);

  // Before hook (can throw to abort)
  eventBus.emit('schema:reload:before', schema);

  // Re-parse markdown
  schema = generateSchema(storedDataModelPath, storedEnabledEntities);
  const newHash = computeSchemaHash(schema);

  // Also reload views
  const requirementsDir = path.dirname(storedDataModelPath);
  const UISpecLoader = require('../utils/UISpecLoader');
  const mdViews = UISpecLoader.loadViewsConfig(requirementsDir);
  if (mdViews) {
    storedViewsConfig = mdViews;
  }

  // Refresh views with new schema
  createAllViews(schema.orderedEntities);
  createUserViews(storedViewsConfig);

  metaVersion++;
  logger.info('Schema reloaded from markdown', { oldHash, newHash, metaVersion });

  // Warn if schema changed (table structure might be out of sync)
  const warning = oldHash !== newHash
    ? 'Schema changed. Restart server or use forceRebuild() to apply changes to database tables.'
    : undefined;

  // After hook (informational)
  eventBus.emit('schema:reload:after', schema, { oldHash, newHash, changed: oldHash !== newHash });

  return { success: true, hash: newHash, warning };
}

/**
 * Reload only user views (without full schema reload)
 * More efficient for Views.md changes
 */
function reloadUserViews() {
  if (!db || !storedDataModelPath) {
    throw new Error('Cannot reload views: database was never initialized');
  }

  const requirementsDir = path.dirname(storedDataModelPath);
  const UISpecLoader = require('../utils/UISpecLoader');
  const mdViews = UISpecLoader.loadViewsConfig(requirementsDir);

  if (mdViews) {
    storedViewsConfig = mdViews;
    createUserViews(storedViewsConfig);
    metaVersion++;
    logger.info('User views reloaded from views/', { metaVersion });
    eventBus.emit('views:reload:after', schema.userViews);
  }

  return { success: true, viewCount: schema.userViews?.length || 0 };
}

/**
 * Watch views directory for changes and auto-reload
 * Uses debounce to avoid multiple reloads on rapid saves
 */
let viewsWatcher = null;
let viewsReloadTimeout = null;

function watchViewsFile() {
  if (!storedDataModelPath) return;

  const requirementsDir = path.dirname(storedDataModelPath);
  const viewsDir = path.join(requirementsDir, 'views');

  if (!fs.existsSync(viewsDir)) {
    logger.debug('views/ directory not found, skipping file watch');
    return;
  }

  // Close existing watcher if any
  if (viewsWatcher) {
    viewsWatcher.close();
  }

  // Watch views directory recursively (includes all Area subdirectories)
  viewsWatcher = fs.watch(viewsDir, { persistent: false, recursive: true }, (eventType, filename) => {
    // Only react to .md file changes
    if (!filename || !filename.endsWith('.md')) return;

    // Debounce: wait 500ms before reloading (IDEs often save multiple times)
    if (viewsReloadTimeout) {
      clearTimeout(viewsReloadTimeout);
    }
    viewsReloadTimeout = setTimeout(() => {
      try {
        reloadUserViews();
      } catch (err) {
        logger.error('Failed to reload views on file change', { error: err.message });
      }
    }, 500);
  });

  logger.info('Watching views/ directory for changes');
}

function unwatchViewsFile() {
  if (viewsWatcher) {
    viewsWatcher.close();
    viewsWatcher = null;
  }
  if (viewsReloadTimeout) {
    clearTimeout(viewsReloadTimeout);
    viewsReloadTimeout = null;
  }
}

/**
 * Populate computed entities (PAIRS annotation).
 * Clears and repopulates each computed table from its source SQL.
 * Safe to call multiple times (idempotent).
 */
function populateComputedEntities() {
  if (!db || !schema) return { populated: 0 };

  const entities = schema.entities;
  let populated = 0;

  for (const entity of Object.values(entities)) {
    if (!entity.pairs) continue;

    const sql = generatePairsSQL(entity, entities);
    if (!sql) {
      logger.warn(`[PAIRS] Could not generate SQL for ${entity.className}`);
      continue;
    }

    try {
      db.exec(`DELETE FROM ${entity.tableName} WHERE id != 1`);
      const result = db.exec(sql);
      const count = db.prepare(`SELECT COUNT(*) AS cnt FROM ${entity.tableName}`).get();
      logger.info(`[PAIRS] Populated ${entity.className}`, { rows: count.cnt });
      populated++;
    } catch (err) {
      logger.error(`[PAIRS] Failed to populate ${entity.className}`, { error: err.message });
    }
  }

  return { populated };
}

module.exports = {
  initDatabase,
  getDatabase,
  getSchema,
  getSchemaHash,
  checkSchemaChanged,
  reloadSchema,
  reloadUserViews,
  watchViewsFile,
  unwatchViewsFile,
  getEntityPrefilters,
  getRequiredFilters,
  getTableOptions,
  closeDatabase,
  forceRebuild,
  reinitialize,
  tableExists,
  viewExists,
  migrateSystemColumns,
  populateComputedEntities,
  getMetaVersion: () => metaVersion,
  getDatabasePath: () => storedDbPath
};
