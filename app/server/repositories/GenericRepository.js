/**
 * GenericRepository - Generic CRUD operations for any entity
 *
 * Provides:
 * - findAll, findById, create, update, delete
 * - Validation using ObjectValidator
 * - FK constraint error handling
 */

const { getDatabase, getSchema } = require('../config/database');
const { ObjectValidator } = require('../../shared/validation');
const { getTypeRegistry } = require('../../shared/types/TypeRegistry');
const ColumnUtils = require('../../static/rap/utils/ColumnUtils');
const { EntityNotFoundError } = require('../errors/NotFoundError');
const { ForeignKeyConstraintError, UniqueConstraintError } = require('../errors/ConflictError');
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
  let sql = `SELECT * FROM ${viewName}`;
  const params = [];

  // Filter: supports two formats:
  // 1. "column:value" - exact match on a specific column (e.g., "type_id:5")
  // 2. "text" - LIKE search across all string columns
  if (options.filter) {
    const colonMatch = options.filter.match(/^(\w+):(.+)$/);

    if (colonMatch) {
      // Exact match on specific column
      const [, columnName, value] = colonMatch;
      const validColumn = entity.columns.find(c => c.name === columnName);

      if (validColumn) {
        sql += ` WHERE ${columnName} = ?`;
        // Convert to number if it's an int column
        const paramValue = validColumn.jsType === 'number' ? parseInt(value, 10) : value;
        params.push(paramValue);
      }
    } else {
      // LIKE search across string columns
      const stringColumns = entity.columns
        .filter(c => c.jsType === 'string' && c.name !== 'id')
        .map(c => c.name);

      if (stringColumns.length > 0) {
        const filterConditions = stringColumns.map(col => `${col} LIKE ?`);
        sql += ` WHERE (${filterConditions.join(' OR ')})`;
        const filterValue = `%${options.filter}%`;
        params.push(...stringColumns.map(() => filterValue));
      }
    }
  }

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

  // Pagination
  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params);

  // Enrich with enum display values
  const enrichedRows = enrichRecords(entityName, rows);

  // Get total count
  let countSql = `SELECT COUNT(*) as count FROM ${entity.tableName}`;
  if (options.filter) {
    const stringColumns = entity.columns
      .filter(c => c.jsType === 'string' && c.name !== 'id')
      .map(c => c.name);

    if (stringColumns.length > 0) {
      const filterConditions = stringColumns.map(col => `${col} LIKE ?`);
      countSql += ` WHERE (${filterConditions.join(' OR ')})`;
    }
  }

  const filterValue = options.filter ? `%${options.filter}%` : null;
  const countParams = options.filter
    ? entity.columns.filter(c => c.jsType === 'string' && c.name !== 'id').map(() => filterValue)
    : [];

  const { count } = db.prepare(countSql).get(...countParams);

  return {
    data: enrichedRows,
    total: count,
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
 */
function create(entityName, data) {
  const entity = ensureValidationRules(entityName);
  const db = getDatabase();

  // Validate and transform
  const validated = validator.validate(entityName, data);
  convertBooleansForSql(entity, validated);

  // Build INSERT statement
  const columns = entity.columns
    .filter(c => c.name !== 'id' && validated[c.name] !== undefined)
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
 */
function update(entityName, id, data) {
  const entity = ensureValidationRules(entityName);
  const db = getDatabase();

  // First check if exists (without enrichment for internal use)
  findById(entityName, id, false); // Throws if not found

  // Validate and transform
  const validated = validator.validate(entityName, data);
  convertBooleansForSql(entity, validated);

  // Build UPDATE statement
  const columns = entity.columns
    .filter(c => c.name !== 'id' && validated[c.name] !== undefined)
    .map(c => c.name);

  const setClause = columns.map(col => `${col} = ?`).join(', ');
  const values = columns.map(col => validated[col]);
  values.push(id);

  const sql = `UPDATE ${entity.tableName} SET ${setClause} WHERE id = ?`;

  try {
    db.prepare(sql).run(...values);
    logger.info(`Updated ${entityName}`, { id });

    return findById(entityName, id);
  } catch (err) {
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
        ui: col.ui || null
      };

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

      return colInfo;
    }),
    ui: {
      labelFields: labelFields.length > 0 ? labelFields : null,
      readonlyFields,
      hiddenFields: hiddenFields.length > 0 ? hiddenFields : null
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
    enumFields: entity.enumFields || {}
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
 */
function getEnabledEntitiesWithAreas() {
  const schema = getSchema();
  const counts = getEntityCounts();
  const entities = [];

  // Use enabledEntities order from config (preserves user-defined order)
  const orderedNames = schema.enabledEntities || Object.keys(schema.entities);

  for (const name of orderedNames) {
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

  return { entities, areas: schema.areas };
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
  getEntityMeta,
  getValidator,
  ensureValidationRules,
  enrichRecord,
  enrichRecords
};
