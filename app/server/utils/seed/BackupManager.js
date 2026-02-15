/**
 * BackupManager - Backup, restore, and upload operations
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

const fs = require('fs');
const path = require('path');
const { buildLabelLookup } = require('./LabelResolver');
const DataLoader = require('./DataLoader');

/**
 * Upload/save data for an entity (saves to seed directory).
 * Data is always saved as JSON, regardless of original format.
 *
 * @param {object} entity - Entity schema object
 * @param {string} seedDir - Path to seed directory
 * @param {*} jsonData - JSON string or array of records
 * @returns {object} - { uploaded, file }
 */
function uploadEntity(entity, seedDir, jsonData) {
  if (!entity) {
    throw new Error('Entity not found in schema');
  }

  let records;
  if (typeof jsonData === 'string') {
    records = JSON.parse(jsonData);
  } else {
    records = jsonData;
  }

  if (!Array.isArray(records)) {
    throw new Error('Data must be an array of records');
  }

  const filePath = path.join(seedDir, `${entity.className}.json`);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));

  return { uploaded: records.length, file: `${entity.className}.json` };
}

/**
 * Backup all entity data to JSON files in the backup directory.
 * Exports current DB content (using conceptual FK names for portability).
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} backupDir - Path to backup directory
 * @returns {object} - { entities: { name: count }, backupDir }
 */
function backupAll(db, schema, backupDir) {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const results = {};

  for (const entity of schema.orderedEntities) {
    const rows = db.prepare(`SELECT * FROM ${entity.tableName} WHERE _ql = 0`).all();

    if (rows.length === 0) {
      const backupPath = path.join(backupDir, `${entity.className}.json`);
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      results[entity.className] = 0;
      continue;
    }

    // Convert FK IDs to label values for portability
    const exportRows = rows.map(row => {
      const exported = { ...row };
      delete exported.id;

      for (const fk of entity.foreignKeys) {
        const idValue = row[fk.column];
        if (idValue === null || idValue === undefined) continue;

        const refEntity = schema.entities[fk.references.entity];
        if (!refEntity) continue;

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

      // Nest aggregate fields
      const aggregateSources = new Map();
      for (const col of entity.columns) {
        if (col.aggregateSource && col.aggregateField) {
          const source = col.aggregateSource;
          if (!aggregateSources.has(source)) {
            aggregateSources.set(source, {});
          }
          if (exported[col.name] !== undefined) {
            aggregateSources.get(source)[col.aggregateField] = exported[col.name];
            delete exported[col.name];
          }
        }
      }
      for (const [source, nested] of aggregateSources) {
        if (Object.keys(nested).length > 0) {
          exported[source] = nested;
        }
      }

      return exported;
    });

    const backupPath = path.join(backupDir, `${entity.className}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(exportRows, null, 2));
    results[entity.className] = exportRows.length;
  }

  return { entities: results, backupDir };
}

/**
 * Restore a single entity from backup JSON file.
 *
 * @param {object} db - Database instance
 * @param {object} entity - Entity schema object
 * @param {object} schema - Full schema
 * @param {string} backupDir - Path to backup directory
 * @param {string} seedDir - Seed directory (for FK fallback lookups)
 * @param {object} options - { mediaService, typeRegistry }
 * @returns {Promise<object>} - Load result
 */
async function restoreEntity(db, entity, schema, backupDir, seedDir, options = {}) {
  if (!entity) {
    throw new Error('Entity not found in schema');
  }

  const backupFile = path.join(backupDir, `${entity.className}.json`);
  if (!fs.existsSync(backupFile)) {
    throw new Error(`No backup file found for ${entity.className}`);
  }

  // Clear entity data first
  try {
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM ${entity.tableName}`).run();
    db.pragma('foreign_keys = ON');
  } catch (err) {
    // Ignore errors during clear
  }

  // Load from backup dir (not seed dir)
  const result = await DataLoader.loadEntity(db, entity, schema, backupDir, seedDir, null, {
    ...options, mode: 'replace', preserveSystemColumns: true
  });
  return result;
}

/**
 * Restore all entity data from backup JSON files.
 *
 * @param {object} db - Database instance
 * @param {object} schema - Full schema
 * @param {string} backupDir - Path to backup directory
 * @param {string} seedDir - Seed directory (for FK fallback lookups)
 * @param {object} options - { mediaService, typeRegistry }
 * @returns {Promise<object>} - Results per entity
 */
async function restoreBackup(db, schema, backupDir, seedDir, options = {}) {
  if (!fs.existsSync(backupDir)) {
    throw new Error('No backup directory found');
  }

  // Clear all entity data
  db.pragma('foreign_keys = OFF');
  for (const entity of [...schema.orderedEntities].reverse()) {
    try {
      db.prepare(`DELETE FROM ${entity.tableName}`).run();
    } catch (err) {
      // Ignore errors
    }
  }
  db.pragma('foreign_keys = ON');

  const results = {};
  const lookups = {};

  for (const entity of schema.orderedEntities) {
    const backupFile = path.join(backupDir, `${entity.className}.json`);
    if (fs.existsSync(backupFile)) {
      try {
        const result = await DataLoader.loadEntity(db, entity, schema, backupDir, seedDir, lookups, {
          ...options, mode: 'replace', preserveSystemColumns: true
        });
        results[entity.className] = result;
        lookups[entity.className] = buildLabelLookup(db, entity);
      } catch (err) {
        results[entity.className] = { error: err.message };
      }
    }
  }

  return results;
}

module.exports = {
  uploadEntity,
  backupAll,
  restoreEntity,
  restoreBackup
};
