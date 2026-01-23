/**
 * SchemaMetadata - Tracks schema changes in a database table
 *
 * Stores entity schemas and global types in _schema_metadata table.
 * On startup, compares current schema (from Markdown) with stored schema
 * to detect and log changes.
 */

const crypto = require('crypto');

class SchemaMetadata {
  constructor(db) {
    this.db = db;
    this.ensureTable();
  }

  /**
   * Create the metadata table if it doesn't exist
   */
  ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_metadata (
        id INTEGER PRIMARY KEY,
        entity_name TEXT NOT NULL UNIQUE,
        columns_json TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Compute MD5 hash of normalized entity schema
   */
  computeHash(entity) {
    const normalized = entity.columns.map(c => ({
      name: c.name,
      type: c.type,
      sqlType: c.sqlType,
      required: c.required,
      foreignKey: c.foreignKey?.references || null,
      defaultValue: c.defaultValue,
      description: c.description || null
    }));
    return crypto.createHash('md5')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  /**
   * Get stored schema for an entity
   */
  getStored(entityName) {
    return this.db.prepare(
      'SELECT columns_json, schema_hash FROM _schema_metadata WHERE entity_name = ?'
    ).get(entityName);
  }

  /**
   * Get all stored entity names (excluding '_types')
   */
  getAllStoredEntities() {
    const rows = this.db.prepare(
      "SELECT entity_name FROM _schema_metadata WHERE entity_name != '_types'"
    ).all();
    return rows.map(r => r.entity_name);
  }

  /**
   * Delete metadata for an entity
   */
  delete(entityName) {
    this.db.prepare('DELETE FROM _schema_metadata WHERE entity_name = ?').run(entityName);
  }

  /**
   * Save entity schema to metadata table
   */
  save(entityName, entity) {
    const columnsJson = JSON.stringify(entity.columns.map(c => ({
      name: c.name,
      type: c.type,
      sqlType: c.sqlType,
      required: c.required,
      foreignKey: c.foreignKey?.references || null,
      defaultValue: c.defaultValue,
      description: c.description || null
    })));
    const hash = this.computeHash(entity);

    this.db.prepare(`
      INSERT INTO _schema_metadata (entity_name, columns_json, schema_hash, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(entity_name) DO UPDATE SET
        columns_json = excluded.columns_json,
        schema_hash = excluded.schema_hash,
        updated_at = CURRENT_TIMESTAMP
    `).run(entityName, columnsJson, hash);
  }

  /**
   * Compare current entity schema with stored schema
   * Returns { isNew, changes[] }
   */
  compareSchemas(entityName, newEntity) {
    const stored = this.getStored(entityName);
    if (!stored) {
      return { isNew: true, changes: [] };
    }

    const newHash = this.computeHash(newEntity);
    if (stored.schema_hash === newHash) {
      return { isNew: false, changes: [] };
    }

    // Detail comparison
    const oldCols = JSON.parse(stored.columns_json);
    const newCols = newEntity.columns.map(c => ({
      name: c.name,
      type: c.type,
      sqlType: c.sqlType,
      required: c.required,
      foreignKey: c.foreignKey?.references || null,
      defaultValue: c.defaultValue,
      description: c.description || null
    }));

    const changes = [];
    const oldNames = new Set(oldCols.map(c => c.name));
    const newNames = new Set(newCols.map(c => c.name));

    // New columns
    for (const col of newCols) {
      if (!oldNames.has(col.name)) {
        changes.push({ type: 'ADD_COLUMN', column: col });
      }
    }

    // Removed columns
    for (const col of oldCols) {
      if (!newNames.has(col.name)) {
        changes.push({ type: 'REMOVE_COLUMN', column: col });
      }
    }

    // Changed columns
    for (const newCol of newCols) {
      const oldCol = oldCols.find(c => c.name === newCol.name);
      if (oldCol) {
        if (oldCol.type !== newCol.type || oldCol.sqlType !== newCol.sqlType) {
          changes.push({ type: 'TYPE_CHANGE', column: newCol, oldType: oldCol.type });
        }
        if (JSON.stringify(oldCol.defaultValue) !== JSON.stringify(newCol.defaultValue)) {
          changes.push({ type: 'DEFAULT_CHANGE', column: newCol, oldDefault: oldCol.defaultValue });
        }
        // Required changed (optional <-> required)
        if (oldCol.required !== newCol.required) {
          changes.push({
            type: 'REQUIRED_CHANGE',
            column: newCol,
            wasRequired: oldCol.required,
            isRequired: newCol.required
          });
        }
        // FK reference changed (points to different entity)
        if (oldCol.foreignKey !== newCol.foreignKey) {
          changes.push({
            type: 'FK_CHANGE',
            column: newCol,
            oldFK: oldCol.foreignKey,
            newFK: newCol.foreignKey
          });
        }
      }
    }

    // Rename heuristic: prioritize description match, fall back to type match
    const added = changes.filter(c => c.type === 'ADD_COLUMN');
    const removed = changes.filter(c => c.type === 'REMOVE_COLUMN');
    const matchedAdds = new Set();
    const matchedRems = new Set();

    // First pass: match by description (strongest signal)
    for (const add of added) {
      if (matchedAdds.has(add.column.name)) continue;
      const addDesc = add.column.description;
      if (!addDesc) continue;  // Need description for this heuristic

      for (const rem of removed) {
        if (matchedRems.has(rem.column.name)) continue;
        const remDesc = rem.column.description;
        if (addDesc === remDesc) {
          changes.push({
            type: 'POSSIBLE_RENAME',
            oldName: rem.column.name,
            newName: add.column.name,
            confidence: 'high',
            reason: 'description match'
          });
          matchedAdds.add(add.column.name);
          matchedRems.add(rem.column.name);
          break;
        }
      }
    }

    // Second pass: match by type only (weaker signal) for unmatched columns
    for (const add of added) {
      if (matchedAdds.has(add.column.name)) continue;
      for (const rem of removed) {
        if (matchedRems.has(rem.column.name)) continue;
        if (add.column.type === rem.column.type) {
          changes.push({
            type: 'POSSIBLE_RENAME',
            oldName: rem.column.name,
            newName: add.column.name,
            confidence: 'low',
            reason: 'type match only'
          });
          matchedAdds.add(add.column.name);
          matchedRems.add(rem.column.name);
          break;
        }
      }
    }

    return { isNew: false, changes };
  }

  // ========== Types Tracking ==========

  /**
   * Normalize types from TypeRegistry format to storage format
   * Only stores global types (entity-local types are part of entity schema)
   */
  normalizeTypes(allTypes) {
    const patterns = {};
    const enums = {};

    for (const [name, def] of Object.entries(allTypes)) {
      if (def.scope !== 'global') continue;  // Skip entity-local types

      if (def.kind === 'pattern') {
        patterns[name] = def.pattern;
      } else if (def.kind === 'enum') {
        // Store as { internal: external } map for comparison
        enums[name] = Object.fromEntries(
          (def.values || []).map(v => [v.internal, v.external])
        );
      }
    }
    return { patterns, enums };
  }

  /**
   * Save global types to metadata table
   */
  saveTypes(allTypes) {
    const normalized = this.normalizeTypes(allTypes);
    const typesJson = JSON.stringify(normalized);
    const hash = crypto.createHash('md5').update(typesJson).digest('hex');

    this.db.prepare(`
      INSERT INTO _schema_metadata (entity_name, columns_json, schema_hash, updated_at)
      VALUES ('_types', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(entity_name) DO UPDATE SET
        columns_json = excluded.columns_json,
        schema_hash = excluded.schema_hash,
        updated_at = CURRENT_TIMESTAMP
    `).run(typesJson, hash);
  }

  /**
   * Compare current types with stored types
   * Returns { isNew, changes[] }
   */
  compareTypes(allTypes) {
    const stored = this.getStored('_types');
    const normalized = this.normalizeTypes(allTypes);
    const typesJson = JSON.stringify(normalized);
    const newHash = crypto.createHash('md5').update(typesJson).digest('hex');

    if (!stored) {
      return { isNew: true, changes: [] };
    }
    if (stored.schema_hash === newHash) {
      return { isNew: false, changes: [] };
    }

    const oldTypes = JSON.parse(stored.columns_json);
    const newTypes = normalized;
    const changes = [];

    // Pattern changes
    const oldPatterns = new Set(Object.keys(oldTypes.patterns || {}));
    const newPatterns = new Set(Object.keys(newTypes.patterns || {}));
    for (const name of newPatterns) {
      if (!oldPatterns.has(name)) {
        changes.push({ type: 'ADD_PATTERN', name });
      } else if (oldTypes.patterns[name] !== newTypes.patterns[name]) {
        changes.push({ type: 'CHANGE_PATTERN', name, oldValue: oldTypes.patterns[name] });
      }
    }
    for (const name of oldPatterns) {
      if (!newPatterns.has(name)) {
        changes.push({ type: 'REMOVE_PATTERN', name });
      }
    }

    // Enum changes
    const oldEnums = new Set(Object.keys(oldTypes.enums || {}));
    const newEnums = new Set(Object.keys(newTypes.enums || {}));
    for (const name of newEnums) {
      if (!oldEnums.has(name)) {
        changes.push({ type: 'ADD_ENUM', name });
      } else if (JSON.stringify(oldTypes.enums[name]) !== JSON.stringify(newTypes.enums[name])) {
        changes.push({ type: 'CHANGE_ENUM', name });
      }
    }
    for (const name of oldEnums) {
      if (!newEnums.has(name)) {
        changes.push({ type: 'REMOVE_ENUM', name });
      }
    }

    return { isNew: false, changes };
  }
}

module.exports = SchemaMetadata;
