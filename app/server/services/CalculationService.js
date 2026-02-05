/**
 * CalculationService - Executes Server Calculations (## Server Calculations)
 *
 * Handles execution of user-defined SERVER calculation logic.
 * Server calculations are:
 *   - Persisted to the database
 *   - Triggered after every create/update (ONCHANGE) or on-demand
 *   - Automatically READONLY in the UI
 *
 * For display-only calculations, use ## Client Calculations (runs in browser).
 */

const { getDatabase, getSchema } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Find all server-calculated fields with a specific trigger
 * @param {string} entityName - Entity class name
 * @param {string} trigger - Trigger type (ONCHANGE, ON_DEMAND, or null for all)
 * @returns {Array} Array of { columnName, serverCalculated: { code, depends, sort, trigger } }
 */
function getServerCalculatedFields(entityName, trigger = null) {
  const schema = getSchema();
  const entity = schema.entities[entityName];
  if (!entity) return [];

  return entity.columns
    .filter(col => col.serverCalculated && (trigger === null || col.serverCalculated.trigger === trigger))
    .map(col => ({
      columnName: col.name,
      serverCalculated: col.serverCalculated
    }));
}

/**
 * Execute a server calculation for a specific field
 * Values are persisted to the database
 *
 * @param {string} entityName - Entity class name (e.g., 'Reading')
 * @param {string} fieldName - Column name (e.g., 'usage')
 * @param {Object} options - Optional: { partitionKey, partitionValue } to limit scope
 * @returns {Object} { rowsUpdated, error? }
 */
function runServerCalculation(entityName, fieldName, options = {}) {
  const schema = getSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    return { rowsUpdated: 0, error: `Entity ${entityName} not found` };
  }

  const column = entity.columns.find(c => c.name === fieldName);
  if (!column?.serverCalculated) {
    return { rowsUpdated: 0, error: `Column ${fieldName} has no server calculation defined` };
  }

  const { code, sort, depends } = column.serverCalculated;
  if (!code) {
    return { rowsUpdated: 0, error: `No calculation code for ${fieldName}` };
  }

  const db = getDatabase();
  const tableName = entity.tableName;

  try {
    // Build query to fetch data
    let sql = `SELECT id, ${[...new Set([...depends, fieldName])].join(', ')} FROM ${tableName}`;
    const params = [];

    // Optional partition filter (e.g., only records for a specific meter_id)
    if (options.partitionKey && options.partitionValue !== undefined) {
      sql += ` WHERE ${options.partitionKey} = ?`;
      params.push(options.partitionValue);
    }

    // Apply sort order from calculation definition
    if (sort && sort.length > 0) {
      sql += ` ORDER BY ${sort.join(', ')}`;
    }

    const data = db.prepare(sql).all(...params);

    if (data.length === 0) {
      return { rowsUpdated: 0 };
    }

    // Execute the calculation code
    // The code expects a `data` array and modifies rows in place
    const calcFunction = new Function('data', code);
    calcFunction(data);

    // Update the database with computed values
    const updateStmt = db.prepare(`UPDATE ${tableName} SET ${fieldName} = ? WHERE id = ?`);
    let rowsUpdated = 0;

    const updateTransaction = db.transaction(() => {
      for (const row of data) {
        const result = updateStmt.run(row[fieldName], row.id);
        rowsUpdated += result.changes;
      }
    });

    updateTransaction();

    logger.info(`Server calculation ${entityName}.${fieldName} completed`, {
      rowsProcessed: data.length,
      rowsUpdated,
      partitioned: !!options.partitionKey
    });

    return { rowsUpdated };

  } catch (err) {
    logger.error(`Server calculation ${entityName}.${fieldName} failed`, {
      error: err.message,
      code: code.substring(0, 100)
    });
    return { rowsUpdated: 0, error: err.message };
  }
}

/**
 * Run all ONCHANGE server calculations for an entity after a record is saved
 *
 * @param {string} entityName - Entity class name
 * @param {Object} savedRecord - The record that was just created/updated
 * @returns {Object} { fieldsProcessed, totalRowsUpdated }
 */
function runOnChangeServerCalculations(entityName, savedRecord) {
  const fields = getServerCalculatedFields(entityName, 'ONCHANGE');

  if (fields.length === 0) {
    return { fieldsProcessed: 0, totalRowsUpdated: 0 };
  }

  let totalRowsUpdated = 0;

  for (const { columnName, serverCalculated } of fields) {
    // Determine partition key from sort/depends (first FK-like field)
    // For Reading.usage: sort is [meter_id, reading_at], so partition by meter_id
    const partitionKey = serverCalculated.sort?.find(s => s.endsWith('_id'));
    const partitionValue = partitionKey ? savedRecord[partitionKey] : undefined;

    const result = runServerCalculation(entityName, columnName, {
      partitionKey,
      partitionValue
    });

    totalRowsUpdated += result.rowsUpdated || 0;
  }

  return {
    fieldsProcessed: fields.length,
    totalRowsUpdated
  };
}

/**
 * Run all server calculations for an entity (rebuild mode)
 *
 * @param {string} entityName - Entity class name
 * @returns {Object} { fieldsProcessed, totalRowsUpdated }
 */
function rebuildServerCalculations(entityName) {
  const schema = getSchema();
  const entity = schema.entities[entityName];
  if (!entity) {
    return { fieldsProcessed: 0, totalRowsUpdated: 0, error: `Entity ${entityName} not found` };
  }

  const fields = entity.columns.filter(c => c.serverCalculated);
  let totalRowsUpdated = 0;

  for (const col of fields) {
    const result = runServerCalculation(entityName, col.name);
    totalRowsUpdated += result.rowsUpdated || 0;
  }

  return {
    fieldsProcessed: fields.length,
    totalRowsUpdated
  };
}

module.exports = {
  getServerCalculatedFields,
  runServerCalculation,
  runOnChangeServerCalculations,
  rebuildServerCalculations
};
