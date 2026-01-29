/**
 * ComputedFieldService - Evaluates computed field rules (DAILY, etc.)
 *
 * Handles scheduled computation of redundant fields like:
 * - Engine.current_aircraft (from EngineMount)
 * - Aircraft.current_operator (from Registration)
 *
 * Rule syntax: [DAILY=SourceEntity[condition].field]
 * Example: [DAILY=EngineMount[removed_date=null OR removed_date>TODAY].aircraft]
 */

const { getDatabase, getSchema } = require('../config/database');
const { toSnakeCase } = require('../utils/SchemaGenerator');
const logger = require('../utils/logger');
const eventBus = require('../utils/EventBus');

// Scheduler state
let scheduledTimeout = null;

/**
 * Collect all computed fields from schema
 * @returns {Array} Array of { entity, column, rule }
 */
function collectComputedFields() {
  const schema = getSchema();
  const fields = [];

  for (const entity of schema.orderedEntities) {
    for (const col of entity.columns) {
      if (col.computed) {
        fields.push({
          entity,
          column: col,
          rule: col.computed
        });
      }
    }
  }

  return fields;
}

/**
 * Convert condition string to SQL WHERE clause
 * Handles: field=null, field>TODAY, field=value, OR/AND
 * @param {string} condition - e.g., "removed_date=null OR removed_date>TODAY"
 * @param {string} alias - Table alias for prefixing
 * @returns {string} SQL WHERE clause
 */
function conditionToSQL(condition, alias = '') {
  const prefix = alias ? `${alias}.` : '';

  // Step 1: Replace special values (null, TODAY) without adding prefix yet
  let sql = condition
    // Handle null comparisons: field=null -> field IS NULL
    .replace(/(\w+)\s*=\s*null/gi, '$1 IS NULL')
    // Handle TODAY placeholder: field>TODAY -> field > date('now')
    .replace(/(\w+)\s*>\s*TODAY/gi, "$1 > date('now')")
    .replace(/(\w+)\s*>=\s*TODAY/gi, "$1 >= date('now')")
    .replace(/(\w+)\s*<\s*TODAY/gi, "$1 < date('now')")
    .replace(/(\w+)\s*<=\s*TODAY/gi, "$1 <= date('now')")
    .replace(/(\w+)\s*=\s*TODAY/gi, "$1 = date('now')");

  // Step 2: Prefix all field names (words followed by space and operator, or before IS NULL)
  // Match: word at start of string or after space/open-paren, followed by comparison
  if (prefix) {
    sql = sql
      .replace(/(?<=^|\s|\()(\w+)(?=\s+(IS|=|<>|!=|<|>|<=|>=))/gi, `${prefix}$1`);
  }

  return sql;
}

/**
 * Build SQL UPDATE statement for a computed field
 * Only updates rows where the value actually changes (avoids false "updated" counts)
 *
 * Supports two modes:
 * 1. Condition mode: [exit_date=null OR exit_date>TODAY] → WHERE clause
 * 2. Aggregate mode: [MAX(end_date)] → ORDER BY clause (NULL = highest priority)
 *
 * @param {Object} field - { entity, column, rule }
 * @returns {string} SQL UPDATE statement
 */
function buildUpdateSQL(field) {
  const { entity, column, rule } = field;
  const targetTable = entity.tableName;
  const targetColumn = column.name;

  // Parse rule: sourceEntity, condition, targetField
  const sourceTable = toSnakeCase(rule.sourceEntity);
  const sourceField = rule.targetField + '_id'; // aircraft -> aircraft_id
  const linkField = toSnakeCase(entity.className) + '_id'; // Engine -> engine_id

  let whereClause;
  let orderByClause;

  if (rule.aggregate) {
    // Aggregate mode: MAX(field) or MIN(field)
    // Implicit NOT NULL filter on target field (derived from FK type)
    whereClause = `src.${linkField} = ${targetTable}.id
      AND src.${sourceField} IS NOT NULL`;

    if (rule.aggregate === 'MAX') {
      // MAX: NULL values have highest priority (= current/active), then descending
      orderByClause = `CASE WHEN src.${rule.aggregateField} IS NULL THEN 1 ELSE 0 END DESC,
      src.${rule.aggregateField} DESC`;
    } else {
      // MIN: Non-NULL values first, then ascending
      orderByClause = `CASE WHEN src.${rule.aggregateField} IS NULL THEN 1 ELSE 0 END ASC,
      src.${rule.aggregateField} ASC`;
    }
  } else {
    // Condition mode: boolean expression
    const conditionSQL = conditionToSQL(rule.condition, 'src');
    whereClause = `src.${linkField} = ${targetTable}.id
      AND (${conditionSQL})`;
    orderByClause = 'src.id DESC';
  }

  // Subquery to compute the new value
  const subquery = `(
    SELECT src.${sourceField}
    FROM ${sourceTable} src
    WHERE ${whereClause}
    ORDER BY ${orderByClause}
    LIMIT 1
  )`;

  // Build the UPDATE statement with WHERE clause to only update changed values
  // Uses IS NOT to properly handle NULL comparisons
  const sql = `
UPDATE ${targetTable}
SET ${targetColumn} = ${subquery}
WHERE ${targetColumn} IS NOT ${subquery}`;

  return sql.trim();
}

/**
 * Run all DAILY computed field updates
 * @returns {Object} Result with counts
 */
function runAll() {
  const db = getDatabase();
  const fields = collectComputedFields();

  // Filter to only DAILY fields (for now)
  const dailyFields = fields.filter(f => f.rule.schedule === 'DAILY');

  if (dailyFields.length === 0) {
    logger.debug('No DAILY computed fields to process');
    return { processed: 0, updated: 0 };
  }

  logger.info(`Running DAILY computation for ${dailyFields.length} fields`);

  let totalUpdated = 0;

  for (const field of dailyFields) {
    try {
      const sql = buildUpdateSQL(field);
      logger.debug(`Executing: ${sql}`);

      const result = db.prepare(sql).run();
      totalUpdated += result.changes;

      logger.info(`Computed ${field.entity.className}.${field.column.name}`, {
        rowsUpdated: result.changes
      });
    } catch (err) {
      logger.error(`Failed to compute ${field.entity.className}.${field.column.name}`, {
        error: err.message,
        rule: field.rule
      });
    }
  }

  const result = {
    processed: dailyFields.length,
    updated: totalUpdated
  };

  // Emit event for monitoring/dashboards
  eventBus.emit('computed:run:after', result);

  return result;
}

/**
 * Schedule daily run at midnight
 * Uses internal timer (no external dependencies)
 */
function scheduleDailyRun() {
  // Clear any existing schedule
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
  }

  const scheduleNext = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    const msUntilMidnight = midnight - now;

    logger.info(`Scheduled next DAILY computation`, {
      nextRun: midnight.toISOString(),
      inMs: msUntilMidnight
    });

    // Emit event for scheduling info
    eventBus.emit('computed:scheduled', { nextRun: midnight, inMs: msUntilMidnight });

    scheduledTimeout = setTimeout(() => {
      logger.info('Running scheduled DAILY computation');
      runAll();
      scheduleNext(); // Schedule next day
    }, msUntilMidnight);
  };

  scheduleNext();
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
    logger.info('DAILY computation scheduler stopped');
  }
}

/**
 * Get status of computed fields
 * @returns {Object} Status info
 */
function getStatus() {
  const fields = collectComputedFields();
  return {
    totalFields: fields.length,
    dailyFields: fields.filter(f => f.rule.schedule === 'DAILY').length,
    schedulerActive: scheduledTimeout !== null,
    fields: fields.map(f => ({
      entity: f.entity.className,
      column: f.column.name,
      schedule: f.rule.schedule,
      rule: `${f.rule.sourceEntity}[${f.rule.condition}].${f.rule.targetField}`
    }))
  };
}

/**
 * Collect columns with explicit DEFAULT values from schema
 * Only includes columns with [DEFAULT=x] annotation, not type-level defaults
 * @returns {Array} Array of { entity, column, defaultValue }
 */
function collectDefaultColumns() {
  const schema = getSchema();
  const columns = [];

  for (const entity of schema.orderedEntities) {
    for (const col of entity.columns) {
      // Only EXPLICIT defaults from [DEFAULT=x] annotation
      // NOT type-level defaults (like CURRENT_DATE for date fields)
      // Skip computed columns (they have their own update logic)
      if (col.explicitDefault !== null && col.explicitDefault !== undefined && !col.computed) {
        columns.push({
          entity,
          column: col,
          defaultValue: col.defaultValue // Use resolved defaultValue (handles enum mapping)
        });
      }
    }
  }

  return columns;
}

/**
 * Apply DEFAULT values to NULL fields at startup
 * Only updates rows where the column is NULL and a default is defined
 * @returns {Object} Result with counts
 */
function applyDefaults() {
  const db = getDatabase();
  const columns = collectDefaultColumns();

  if (columns.length === 0) {
    logger.debug('No columns with DEFAULT values');
    return { processed: 0, updated: 0 };
  }

  logger.info(`Checking DEFAULT values for ${columns.length} columns`);

  let totalUpdated = 0;

  for (const { entity, column, defaultValue } of columns) {
    try {
      // Format the default value for SQL
      let sqlValue;
      if (typeof defaultValue === 'string') {
        sqlValue = `'${defaultValue.replace(/'/g, "''")}'`;
      } else if (typeof defaultValue === 'boolean') {
        sqlValue = defaultValue ? '1' : '0';
      } else {
        sqlValue = String(defaultValue);
      }

      const sql = `UPDATE ${entity.tableName} SET ${column.name} = ${sqlValue} WHERE ${column.name} IS NULL`;
      const result = db.prepare(sql).run();

      if (result.changes > 0) {
        totalUpdated += result.changes;
        logger.info(`Applied DEFAULT for ${entity.className}.${column.name}`, {
          defaultValue,
          rowsUpdated: result.changes
        });
      }
    } catch (err) {
      logger.error(`Failed to apply DEFAULT for ${entity.className}.${column.name}`, {
        error: err.message,
        defaultValue
      });
    }
  }

  const result = {
    processed: columns.length,
    updated: totalUpdated
  };

  // Emit event for monitoring
  eventBus.emit('computed:defaults:after', result);

  return result;
}

module.exports = {
  runAll,
  applyDefaults,
  scheduleDailyRun,
  stopScheduler,
  getStatus,
  collectComputedFields,
  collectDefaultColumns,
  buildUpdateSQL
};
