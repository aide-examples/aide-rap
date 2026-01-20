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
 * @param {string} entityName - Entity name (e.g., 'Aircraft')
 * @param {Object} options - { sort, order, filter, limit, offset }
 */
function findAll(entityName, options = {}) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();

  let sql = `SELECT * FROM ${entity.tableName}`;
  const params = [];

  // Simple filter (search across string columns)
  if (options.filter) {
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
    data: rows,
    total: count,
    limit: options.limit || null,
    offset: options.offset || 0
  };
}

/**
 * Find a single record by ID
 */
function findById(entityName, id) {
  const entity = getEntityMeta(entityName);
  const db = getDatabase();

  const row = db.prepare(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(id);

  if (!row) {
    throw new EntityNotFoundError(entityName, id);
  }

  return row;
}

/**
 * Create a new record
 */
function create(entityName, data) {
  const entity = ensureValidationRules(entityName);
  const db = getDatabase();

  // Validate and transform
  const validated = validator.validate(entityName, data);

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

  // First check if exists
  findById(entityName, id); // Throws if not found

  // Validate and transform
  const validated = validator.validate(entityName, data);

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

  // First check if exists
  const existing = findById(entityName, id); // Throws if not found

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
 * - [LABEL], [LABEL2]: Fields used for display label AND basic view (Grundansicht)
 * - [DETAIL]: Additional fields to show in basic view (Grundansicht)
 * - [HOVER]: (legacy) Explicit hover-only
 * - [HIDDEN]: Never visible
 * - [READONLY]: Not editable
 *
 * Field visibility logic:
 * - detailFields: Fields marked [LABEL], [LABEL2], or [DETAIL] - always visible when expanded
 * - hoverFields: All other fields (except hidden) - only visible on hover/focus
 * - hiddenFields: Fields marked [HIDDEN] - never visible
 */
function getExtendedSchemaInfo(entityName) {
  const entity = getEntityMeta(entityName);
  const schema = getSchema();

  // Collect UI annotation fields
  const labelFields = [];
  const detailFields = [];
  const hoverFields = [];
  const readonlyFields = ['id']; // id is always readonly
  const hiddenFields = [];

  for (const col of entity.columns) {
    const isLabel = col.ui?.label || col.ui?.label2;
    const isDetail = col.ui?.detail;
    const isHidden = col.ui?.hidden;

    // labelFields are for display purposes (title/subtitle)
    if (col.ui?.label) labelFields.push(col.name);
    if (col.ui?.label2) labelFields.push(col.name);
    if (col.ui?.readonly && col.name !== 'id') readonlyFields.push(col.name);

    if (isHidden) {
      hiddenFields.push(col.name);
    } else if (isLabel || isDetail) {
      // LABEL, LABEL2, DETAIL fields are always visible in Grundansicht
      detailFields.push(col.name);
    } else {
      // All other fields are hover-only
      hoverFields.push(col.name);
    }
  }

  // Get back-references (entities that reference this one)
  const inverseRels = schema.inverseRelationships[entityName] || [];

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
      } : null,
      ui: col.ui || null
    })),
    ui: {
      labelFields: labelFields.length > 0 ? labelFields : null,
      detailFields: detailFields.length > 0 ? detailFields : null,
      hoverFields: hoverFields.length > 0 ? hoverFields : null,
      readonlyFields,
      hiddenFields: hiddenFields.length > 0 ? hiddenFields : null
    },
    backReferences: inverseRels.map(rel => ({
      entity: rel.entity,
      column: rel.column
    })),
    validationRules: entity.validationRules
  };
}

/**
 * Get list of all enabled entities
 */
function getEnabledEntities() {
  const schema = getSchema();
  return Object.keys(schema.entities);
}

/**
 * Get list of all enabled entities with area info
 */
function getEnabledEntitiesWithAreas() {
  const schema = getSchema();
  const entities = [];

  for (const [name, entity] of Object.entries(schema.entities)) {
    const areaKey = entity.area || 'unknown';
    const areaInfo = schema.areas[areaKey] || { name: 'Unknown', color: '#f5f5f5' };

    entities.push({
      name,
      area: areaKey,
      areaName: areaInfo.name,
      areaColor: areaInfo.color
    });
  }

  // Sort by area, then by name
  entities.sort((a, b) => {
    if (a.areaName !== b.areaName) {
      return a.areaName.localeCompare(b.areaName);
    }
    return a.name.localeCompare(b.name);
  });

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

    // Get referencing records
    const sql = `SELECT * FROM ${refEntity.tableName} WHERE ${rel.column} = ? ORDER BY id ASC`;
    const rows = db.prepare(sql).all(id);

    if (rows.length > 0) {
      references[rel.entity] = {
        column: rel.column,
        count: rows.length,
        records: rows
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
  ensureValidationRules
};
