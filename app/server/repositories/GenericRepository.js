/**
 * GenericRepository - Generic CRUD operations for any entity
 *
 * Provides:
 * - findAll, findById, create, update, delete
 * - Validation using ObjectValidator
 * - FK constraint error handling
 */

const { getDatabase, getSchema, getEntityPrefilters, getRequiredFilters, getTableOptions } = require('../config/database');
const { ObjectValidator } = require('../../shared/validation');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const ColumnUtils = require('../../static/rap/utils/ColumnUtils');
const { EntityNotFoundError } = require('../errors/NotFoundError');
const { ForeignKeyConstraintError, UniqueConstraintError } = require('../errors/ConflictError');
const { parseFilter, buildWhereClause } = require('../utils/FilterParser');
const { COLUMN_BREAK } = require('../utils/UISpecLoader');
const logger = require('../utils/logger');

// Shared validator instance
const validator = new ObjectValidator();

/**
 * Initialize validation rules for an entity
 */
function ensureValidationRules(entityName) {
  const schema = getSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  if (!validator.hasRules(entityName)) {
    validator.defineRules(entityName, entity.validationRules);
    logger.debug(`Defined validation rules for ${entityName}`);
  }

  return entity;
}

/**
 * Get entity metadata from schema
 */
function getEntityMeta(entityName) {
  const schema = getSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    throw new Error(`Entity ${entityName} not found in schema`);
  }

  return entity;
}

/**
 * Enrich a record: convert SQLite types (boolean 0/1 → true/false)
 * and add _display fields for enum types.
 * @param {string} entityName - Entity name
 * @param {Object} record - Database record
 * @returns {Object} - Enriched record
 */
function enrichRecord(entityName, record) {
  const entity = getEntityMeta(entityName);
  const enriched = { ...record };

  // Convert boolean columns from SQLite INTEGER (0/1) to JS boolean
  for (const col of entity.columns) {
    if (col.jsType === 'boolean' && enriched[col.name] !== null && enriched[col.name] !== undefined) {
      enriched[col.name] = enriched[col.name] !== 0;
    }
  }

  // Add _display fields for enum types
  if (entity.enumFields && Object.keys(entity.enumFields).length > 0) {
    const typeRegistry = getTypeRegistry();
    for (const [fieldName, enumInfo] of Object.entries(entity.enumFields)) {
      const value = record[fieldName];
      if (value !== null && value !== undefined) {
        enriched[`${fieldName}_display`] = typeRegistry.toExternal(enumInfo.typeName, value, entityName);
      }
    }
  }

  return enriched;
}

/**
 * Enrich multiple records with _display fields
 * @param {string} entityName - Entity name
 * @param {Array} records - Array of database records
 * @returns {Array} - Enriched records
 */
function enrichRecords(entityName, records) {
  return records.map(record => enrichRecord(entityName, record));
}

/**
 * Convert boolean values to SQLite INTEGER (0/1) in-place.
 * better-sqlite3 cannot bind JS booleans directly.
 */
function convertBooleansForSql(entity, data) {
  for (const col of entity.columns) {
    if (col.jsType === 'boolean' && data[col.name] !== undefined && data[col.name] !== null) {
      data[col.name] = data[col.name] ? 1 : 0;
    }
  }
}

/**
 * Handle SQLite errors and convert to appropriate error types
 */
function handleSqliteError(err, entityName, operation, data = {}) {
  const message = err.message || '';

  // UNIQUE constraint violation
  if (message.includes('UNIQUE constraint failed')) {
    const match = message.match(/UNIQUE constraint failed: \w+\.(\w+)/);
    const field = match ? match[1] : 'unknown';
    throw new UniqueConstraintError(entityName, field, data[field]);
  }

  // FOREIGN KEY constraint violation (on insert/update)
  if (message.includes('FOREIGN KEY constraint failed')) {
    throw new ForeignKeyConstraintError(
      entityName,
      'unknown',
      null,
      `Referenced record does not exist`
    );
  }

  // Re-throw unknown errors
  throw err;
}

/**
 * Find all records of an entity
 * Uses the View (with FK labels) for reading
 * @param {string} entityName - Entity name (e.g., 'Aircraft')
 * @param {Object} options - { sort, order, filter, limit, offset }
 */
function findAll(entityName, options = {}) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();

  // Read from View (includes _label fields for FKs)
  const viewName = entity.tableName + '_view';

  // Parse filter using shared FilterParser
  const { conditions, params } = parseFilter(options.filter, {
    // For ~, =, @Y, @M: use column name directly (view has all columns)
    resolveColumn: (colName) => ({ sqlName: colName, jsType: 'string' }),
    // For plain "column:value": validate against entity schema
    validateEntityColumn: (colName) => {
      // Handle implicit id column (always present but not in entity.columns)
      if (colName === 'id') {
        return { sqlName: 'id', jsType: 'number' };
      }
      const col = entity.columns.find(c => c.name === colName);
      return col ? { sqlName: col.name, jsType: col.jsType } : null;
    },
    // For global text search: use entity's string columns
    getStringColumns: () => entity.columns
      .filter(c => c.jsType === 'string' && c.name !== 'id')
      .map(c => c.name)
  });

  const whereClause = buildWhereClause(conditions);

  // Build data query with WHERE, ORDER BY, and pagination
  let sql = `SELECT * FROM ${viewName}${whereClause}`;

  // Sorting
  if (options.sort) {
    const validColumn = entity.columns.find(c => c.name === options.sort);
    if (validColumn) {
      const order = options.order === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${options.sort} ${order}`;
    }
  } else {
    sql += ' ORDER BY id ASC';
  }

  // Pagination params (separate from filter params)
  const queryParams = [...params];
  if (options.limit) {
    sql += ' LIMIT ?';
    queryParams.push(options.limit);
  }
  if (options.offset) {
    sql += ' OFFSET ?';
    queryParams.push(options.offset);
  }

  const rows = db.prepare(sql).all(...queryParams);

  // Enrich with enum display values
  const enrichedRows = enrichRecords(entityName, rows);

  // Get total count using the SAME WHERE clause (without LIMIT/OFFSET)
  const countSql = `SELECT COUNT(*) as count FROM ${viewName}${whereClause}`;
  const { count: totalCount } = db.prepare(countSql).get(...params);

  return {
    data: enrichedRows,
    totalCount,
    limit: options.limit || null,
    offset: options.offset || 0
  };
}

/**
 * Find a single record by ID
 * Uses the View (with FK labels) for reading unless enrich=false (internal use)
 */
function findById(entityName, id, enrich = true) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();

  // Read from View (includes _label fields for FKs) unless enrich=false
  const source = enrich ? entity.tableName + '_view' : entity.tableName;
  const row = db.prepare(`SELECT * FROM ${source} WHERE id = ?`).get(id);

  if (!row) {
    throw new EntityNotFoundError(entityName, id);
  }

  // Enrich with enum display values (unless disabled for internal use)
  return enrich ? enrichRecord(entityName, row) : row;
}

/**
 * Create a new record
 * System columns (_created_at, _updated_at, _version) use SQLite DEFAULTs
 */
function create(entityName, data) {
  const entity = ensureValidationRules(entityName);
  const db = getDatabase();

  // Validate and transform
  const validated = validator.validate(entityName, data);
  convertBooleansForSql(entity, validated);

  // Build INSERT statement (system columns use SQLite DEFAULTs)
  const columns = entity.columns
    .filter(c => c.name !== 'id' && !c.system && validated[c.name] !== undefined)
    .map(c => c.name);

  const placeholders = columns.map(() => '?');
  const values = columns.map(col => validated[col]);

  const sql = `INSERT INTO ${entity.tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

  try {
    const result = db.prepare(sql).run(...values);
    const id = result.lastInsertRowid;

    logger.info(`Created ${entityName}`, { id });

    return findById(entityName, id);
  } catch (err) {
    handleSqliteError(err, entityName, 'create', validated);
  }
}

/**
 * Update an existing record
 * @param {string} entityName - Entity name
 * @param {number} id - Record ID
 * @param {Object} data - Update data
 * @param {number|null} expectedVersion - Expected version for OCC (null = skip check)
 */
function update(entityName, id, data, expectedVersion = null) {
  const entity = ensureValidationRules(entityName);
  const db = getDatabase();
  const { VersionConflictError } = require('../errors/ConflictError');

  // First check if exists (without enrichment for internal use)
  const existing = findById(entityName, id, false); // Throws if not found

  // OCC: Check version if provided
  if (expectedVersion !== null && existing._version !== expectedVersion) {
    // Version mismatch - get enriched record for client to show diff
    const currentRecord = findById(entityName, id, true);
    throw new VersionConflictError(entityName, id, expectedVersion, currentRecord);
  }

  // Validate and transform
  const validated = validator.validate(entityName, data);
  convertBooleansForSql(entity, validated);

  // Set system columns (update timestamp)
  validated._updated_at = new Date().toISOString();

  // Build UPDATE statement (exclude system columns that shouldn't be user-settable)
  const columns = entity.columns
    .filter(c => c.name !== 'id' && c.name !== '_created_at' && c.name !== '_version' && validated[c.name] !== undefined)
    .map(c => c.name);

  const setClause = columns.map(col => `${col} = ?`).join(', ');
  const values = columns.map(col => validated[col]);

  // OCC: Atomic version increment with WHERE check
  const sql = `UPDATE ${entity.tableName} SET ${setClause}, _version = _version + 1 WHERE id = ? AND _version = ?`;
  values.push(id, existing._version);

  try {
    const result = db.prepare(sql).run(...values);

    // OCC: Check if update was applied (no concurrent modification)
    if (result.changes === 0) {
      // Concurrent modification happened between our check and update
      const currentRecord = findById(entityName, id, true);
      throw new VersionConflictError(entityName, id, existing._version, currentRecord);
    }

    logger.info(`Updated ${entityName}`, { id, newVersion: existing._version + 1 });

    return findById(entityName, id);
  } catch (err) {
    if (err instanceof VersionConflictError) throw err;
    handleSqliteError(err, entityName, 'update', validated);
  }
}

/**
 * Delete a record
 */
function remove(entityName, id) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();
  const schema = getSchema();

  // First check if exists (without enrichment for internal use)
  const existing = findById(entityName, id, false); // Throws if not found

  // Check for referencing records
  const inverseRels = schema.inverseRelationships[entityName] || [];

  for (const rel of inverseRels) {
    const refEntity = schema.entities[rel.entity];
    if (!refEntity) continue;

    const countSql = `SELECT COUNT(*) as count FROM ${refEntity.tableName} WHERE ${rel.column} = ?`;
    const { count } = db.prepare(countSql).get(id);

    if (count > 0) {
      throw new ForeignKeyConstraintError(entityName, id, rel.entity, count);
    }
  }

  // Delete
  const sql = `DELETE FROM ${entity.tableName} WHERE id = ?`;
  db.prepare(sql).run(id);

  logger.info(`Deleted ${entityName}`, { id });

  return existing;
}

/**
 * Count records
 */
function count(entityName, filter = null) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();

  let sql = `SELECT COUNT(*) as count FROM ${entity.tableName}`;
  const params = [];

  if (filter) {
    const stringColumns = entity.columns
      .filter(c => c.jsType === 'string' && c.name !== 'id')
      .map(c => c.name);

    if (stringColumns.length > 0) {
      const filterConditions = stringColumns.map(col => `${col} LIKE ?`);
      sql += ` WHERE (${filterConditions.join(' OR ')})`;
      const filterValue = `%${filter}%`;
      params.push(...stringColumns.map(() => filterValue));
    }
  }

  const { count: total } = db.prepare(sql).get(...params);
  return total;
}

/**
 * Get schema info for an entity (for API)
 */
function getSchemaInfo(entityName) {
  const entity = getEntityMeta(entityName);

  return {
    entityName: entity.className,
    tableName: entity.tableName,
    description: entity.description,
    columns: entity.columns.map(col => ({
      name: col.name,
      type: col.jsType,
      required: col.required,
      foreignKey: col.foreignKey ? {
        entity: col.foreignKey.entity,
        table: col.foreignKey.table
      } : null
    })),
    validationRules: entity.validationRules
  };
}

/**
 * Get extended schema info with UI metadata
 *
 * Tag meanings:
 * - [LABEL], [LABEL2]: Fields used for display label (title/subtitle)
 * - [HIDDEN]: Never visible in UI
 * - [READONLY]: Not editable
 */
function getExtendedSchemaInfo(entityName) {
  const entity = getEntityMeta(entityName);
  const schema = getSchema();

  // Collect UI annotation fields using shared ColumnUtils
  const labelFields = ColumnUtils.buildLabelFields(entity.columns);
  const readonlyFields = ['id']; // id is always readonly
  const hiddenFields = [];

  for (const col of entity.columns) {
    if (col.ui?.readonly && col.name !== 'id') readonlyFields.push(col.name);
    if (col.ui?.hidden) hiddenFields.push(col.name);
  }

  // Get back-references (entities that reference this one)
  const inverseRels = schema.inverseRelationships[entityName] || [];

  // Get area info with color
  const areaKey = entity.area || 'unknown';
  const areaInfo = schema.areas[areaKey] || { name: 'Unknown', color: '#f5f5f5' };

  return {
    entityName: entity.className,
    tableName: entity.tableName,
    description: entity.description,
    area: areaKey,
    areaName: areaInfo.name,
    areaColor: areaInfo.color,
    columns: entity.columns.map(col => {
      // For FK columns, get the area color of the target entity
      let fkInfo = null;
      if (col.foreignKey) {
        const targetEntity = schema.entities[col.foreignKey.entity];
        const targetAreaKey = targetEntity?.area || 'unknown';
        const targetAreaInfo = schema.areas[targetAreaKey] || { name: 'Unknown', color: '#f5f5f5' };
        fkInfo = {
          entity: col.foreignKey.entity,
          table: col.foreignKey.table,
          areaColor: targetAreaInfo.color
        };
      }

      const colInfo = {
        name: col.name,
        type: col.jsType,
        required: col.required,
        foreignKey: fkInfo,
        ui: col.ui || null,
        description: col.description || null
      };

      // Add displayName for FK columns (conceptual name for UI)
      if (col.displayName) {
        colInfo.displayName = col.displayName;
      }

      // Include default value if present (for form pre-population)
      if (col.defaultValue !== null && col.defaultValue !== undefined) {
        colInfo.defaultValue = col.defaultValue;
      }

      // Add custom type info if present
      if (col.customType) {
        colInfo.customType = col.customType;
      }

      // Add enum values if this is an enum field
      if (entity.enumFields && entity.enumFields[col.name]) {
        colInfo.enumValues = entity.enumFields[col.name].values;
      }

      // Add client calculation info (display-only, runs in browser)
      if (col.clientCalculated) {
        colInfo.clientCalculated = col.clientCalculated;
      }

      // Add server calculation info (persistent, runs after save)
      if (col.serverCalculated) {
        colInfo.serverCalculated = col.serverCalculated;
      }

      // Legacy: keep 'calculated' for backward compatibility
      if (col.calculated) {
        colInfo.calculated = col.calculated;
      }

      // Add aggregate type info (for grouping related fields)
      if (col.aggregateSource) {
        colInfo.aggregateSource = col.aggregateSource;
        colInfo.aggregateField = col.aggregateField;
        colInfo.aggregateType = col.aggregateType;
      }

      return colInfo;
    }),
    ui: {
      labelFields: labelFields.length > 0 ? labelFields : null,
      // Entity-level label expression (computed _label column in view)
      hasComputedLabel: !!entity.labelExpression,
      readonlyFields,
      hiddenFields: hiddenFields.length > 0 ? hiddenFields : null,
      tableOptions: getTableOptions()[entityName] || null
    },
    backReferences: inverseRels.map(rel => {
      // Get area color of the referencing entity
      const refEntity = schema.entities[rel.entity];
      const refAreaKey = refEntity?.area || 'unknown';
      const refAreaInfo = schema.areas[refAreaKey] || { name: 'Unknown', color: '#f5f5f5' };
      return {
        entity: rel.entity,
        column: rel.column,
        areaColor: refAreaInfo.color
      };
    }),
    validationRules: entity.validationRules,
    // Include enumFields for client-side value formatting
    enumFields: entity.enumFields || {},
    // Include prefilter fields for large dataset filtering
    prefilter: getEntityPrefilters()[entityName] || null,
    // Include required filter fields (always show dialog)
    requiredFilter: getRequiredFilters()[entityName] || null,
    // Self-referential FK column (for hierarchy view)
    selfRefFK: (entity.foreignKeys || []).find(
      fk => (fk.references?.entity || entityName) === entityName
    )?.column || null
  };
}

/**
 * Get list of all enabled entities
 */
function getEnabledEntities() {
  const schema = getSchema();
  return Object.keys(schema.entities);
}

// Cache for entity record counts
let entityCountsCache = null;
let entityCountsCacheTime = 0;
const COUNTS_CACHE_TTL = 30000; // 30 seconds

/**
 * Get record counts for all enabled entities (with caching)
 */
function getEntityCounts() {
  const now = Date.now();
  if (entityCountsCache && (now - entityCountsCacheTime) < COUNTS_CACHE_TTL) {
    return entityCountsCache;
  }

  const schema = getSchema();
  const db = getDatabase();
  const counts = {};

  const orderedNames = schema.enabledEntities || Object.keys(schema.entities);
  for (const name of orderedNames) {
    const entity = schema.entities[name];
    if (!entity) continue;

    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${entity.tableName}`).get();
      counts[name] = row.count;
    } catch (e) {
      counts[name] = 0;
    }
  }

  entityCountsCache = counts;
  entityCountsCacheTime = now;
  return counts;
}

/**
 * Get list of all enabled entities with area info and record counts
 * Preserves the order from config.json enabledEntities
 * Includes system entities (like AuditTrail) at the end
 */
function getEnabledEntitiesWithAreas() {
  const schema = getSchema();
  const db = getDatabase();
  const counts = getEntityCounts();
  const entities = [];

  // Use enabledEntities order from config (preserves user-defined order)
  const orderedNames = schema.enabledEntities || Object.keys(schema.entities);

  for (const name of orderedNames) {
    if (name === COLUMN_BREAK) {
      entities.push({ type: 'column_break' });
      continue;
    }
    const entity = schema.entities[name];
    if (!entity) continue;

    const areaKey = entity.area || 'unknown';
    const areaInfo = schema.areas[areaKey] || { name: 'Unknown', color: '#f5f5f5' };

    entities.push({
      name,
      area: areaKey,
      areaName: areaInfo.name,
      areaColor: areaInfo.color,
      count: counts[name] || 0
    });
  }

  // Add system entities (AuditTrail)
  try {
    const auditCount = db.prepare('SELECT COUNT(*) as count FROM _audit_trail').get();
    entities.push({
      name: 'AuditTrail',
      area: 'system',
      areaName: 'System',
      areaColor: '#9ca3af',
      count: auditCount?.count || 0,
      system: true,
      readonly: true
    });
  } catch (err) {
    // _audit_trail table may not exist yet
  }

  // Include system area in areas
  const areas = {
    ...schema.areas,
    system: { name: 'System', color: '#9ca3af' }
  };

  return { entities, areas };
}

/**
 * Get back-references to a specific record (other records that reference this one)
 */
function getBackReferences(entityName, id) {
  const schema = getSchema();
  const db = getDatabase();

  // First check if the record exists
  findById(entityName, id); // Throws if not found

  const inverseRels = schema.inverseRelationships[entityName] || [];
  const references = {};

  for (const rel of inverseRels) {
    const refEntity = schema.entities[rel.entity];
    if (!refEntity) continue;

    // Get referencing records from View (includes _label fields)
    const viewName = refEntity.tableName + '_view';
    const sql = `SELECT * FROM ${viewName} WHERE ${rel.column} = ? ORDER BY id ASC`;
    const rows = db.prepare(sql).all(id);

    if (rows.length > 0) {
      // Enrich with enum display values
      const enrichedRows = enrichRecords(rel.entity, rows);
      references[rel.entity] = {
        column: rel.column,
        count: rows.length,
        records: enrichedRows
      };
    }
  }

  return references;
}

/**
 * Get distinct values for a column (for prefilter dropdowns)
 * Supports:
 *   - Simple FK field: "meter" → uses "meter_label" from view
 *   - Regular column: "status" → uses "status" from view
 *   - Nested FK path: "meter.building" → uses "meter_building" (not fully supported)
 *   - Date extraction: type='year' → extracts distinct years, type='month' → distinct year-months
 */
function getDistinctValues(entityName, columnPath, extractType = 'select') {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();
  const viewName = entity.tableName + '_view';

  // Determine the view column name
  let column;

  // Check if this is an FK field (has _id column in entity)
  const fkColumn = entity.columns.find(c => c.name === columnPath + '_id');

  if (fkColumn) {
    // FK field like "meter" → view has "meter_label"
    column = columnPath + '_label';
  } else if (columnPath.includes('.')) {
    // Nested path like "meter.building" → try "meter_building"
    column = columnPath.replace(/\./g, '_');
  } else {
    // Regular column
    column = columnPath;
  }

  try {
    let sql, valueKey;
    if (extractType === 'year') {
      // Extract distinct years from date column
      sql = `SELECT DISTINCT strftime('%Y', "${column}") as year FROM ${viewName} WHERE "${column}" IS NOT NULL ORDER BY year DESC`;
      valueKey = 'year';
    } else if (extractType === 'month') {
      // Extract distinct year-months from date column
      sql = `SELECT DISTINCT strftime('%Y-%m', "${column}") as month FROM ${viewName} WHERE "${column}" IS NOT NULL ORDER BY month DESC`;
      valueKey = 'month';
    } else {
      // Default: distinct values
      sql = `SELECT DISTINCT "${column}" FROM ${viewName} WHERE "${column}" IS NOT NULL ORDER BY "${column}"`;
      valueKey = column;
    }

    const rows = db.prepare(sql).all();
    return rows.map(r => r[valueKey]);
  } catch (e) {
    // Fallback: try without _label suffix
    try {
      let sql, valueKey;
      if (extractType === 'year') {
        sql = `SELECT DISTINCT strftime('%Y', "${columnPath}") as year FROM ${viewName} WHERE "${columnPath}" IS NOT NULL ORDER BY year DESC`;
        valueKey = 'year';
      } else if (extractType === 'month') {
        sql = `SELECT DISTINCT strftime('%Y-%m', "${columnPath}") as month FROM ${viewName} WHERE "${columnPath}" IS NOT NULL ORDER BY month DESC`;
        valueKey = 'month';
      } else {
        sql = `SELECT DISTINCT "${columnPath}" FROM ${viewName} WHERE "${columnPath}" IS NOT NULL ORDER BY "${columnPath}"`;
        valueKey = columnPath;
      }
      const rows = db.prepare(sql).all();
      return rows.map(r => r[valueKey]);
    } catch (e2) {
      console.error(`Failed to get distinct values for ${entityName}.${columnPath}:`, e2.message);
      return [];
    }
  }
}

/**
 * Get validator instance (for service layer)
 */
function getValidator() {
  return validator;
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
  count,
  getSchemaInfo,
  getExtendedSchemaInfo,
  getEnabledEntities,
  getEnabledEntitiesWithAreas,
  getBackReferences,
  getDistinctValues,
  getEntityMeta,
  getValidator,
  ensureValidationRules,
  enrichRecord,
  enrichRecords
};
