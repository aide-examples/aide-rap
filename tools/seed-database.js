#!/usr/bin/env node
/**
 * Seed Database Tool
 *
 * Usage:
 *   node tools/seed-database.js                   # Load all seed data (from generated)
 *   node tools/seed-database.js --source imported # Load from imported source
 *   node tools/seed-database.js Aircraft          # Load specific entities
 *   node tools/seed-database.js --reset Aircraft  # Reset table and reload
 *   node tools/seed-database.js --clear           # Clear all tables
 */

const path = require('path');
const fs = require('fs');

const SCRIPT_DIR = path.join(__dirname, '..', 'app');
const SEED_GENERATED_DIR = path.join(SCRIPT_DIR, 'data', 'seed_generated');
const SEED_IMPORTED_DIR = path.join(SCRIPT_DIR, 'data', 'seed_imported');
const CONFIG_PATH = path.join(SCRIPT_DIR, 'config.json');
const DATA_MODEL_PATH = path.join(SCRIPT_DIR, 'docs', 'requirements', 'DataModel.md');
const DB_PATH = path.join(SCRIPT_DIR, 'data', 'irma.sqlite');

// Load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const enabledEntities = config.crud?.enabledEntities || [];

// Initialize database
const { initDatabase, getDatabase, resetTable, closeDatabase } = require(path.join(SCRIPT_DIR, 'server', 'config', 'database'));
const { getSchema } = require(path.join(SCRIPT_DIR, 'server', 'config', 'database'));

// Parse arguments
const args = process.argv.slice(2);
let resetMode = false;
let clearMode = false;
let source = 'generated'; // default source
const entities = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--reset') {
    resetMode = true;
  } else if (arg === '--clear') {
    clearMode = true;
  } else if (arg === '--source' && args[i + 1]) {
    source = args[++i];
  } else if (!arg.startsWith('-')) {
    entities.push(arg);
  }
}

// Determine seed directory based on source
const SEED_DIR = source === 'imported' ? SEED_IMPORTED_DIR : SEED_GENERATED_DIR;

/**
 * Load seed data for an entity
 */
function loadSeedData(entityName) {
  const seedFile = path.join(SEED_DIR, `${entityName}.json`);

  if (!fs.existsSync(seedFile)) {
    console.log(`  No seed file for ${entityName}`);
    return [];
  }

  return JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
}

/**
 * Build a lookup map for an entity: LABEL value -> id
 * Used to resolve conceptual FK references (e.g., "manufacturer": "Airbus" -> manufacturer_id: 1)
 */
function buildLabelLookup(entityName) {
  const db = getDatabase();
  const schema = getSchema();
  const entity = schema.entities[entityName];

  if (!entity) return {};

  // Find the LABEL column (primary display field)
  const labelCol = entity.columns.find(c => c.ui?.label);
  if (!labelCol) return {};

  const sql = `SELECT id, ${labelCol.name} FROM ${entity.tableName}`;
  const rows = db.prepare(sql).all();

  const lookup = {};
  for (const row of rows) {
    lookup[row[labelCol.name]] = row.id;
  }

  return lookup;
}

/**
 * Resolve conceptual FK references in a record.
 * Converts { "manufacturer": "Airbus" } to { "manufacturer_id": 1 }
 *
 * @param {string} entityName - The entity being seeded
 * @param {object} record - The seed record (may have conceptual or technical FK names)
 * @param {object} lookups - Pre-built lookup maps for all entities
 * @returns {object} - Record with resolved FK IDs
 */
function resolveConceptualFKs(entityName, record, lookups) {
  const schema = getSchema();
  const entity = schema.entities[entityName];

  if (!entity) return record;

  const resolved = { ...record };

  for (const fk of entity.foreignKeys) {
    const conceptualName = fk.displayName;  // e.g., "manufacturer"
    const technicalName = fk.column;        // e.g., "manufacturer_id"
    const targetEntity = fk.references.entity; // e.g., "AircraftManufacturer"

    // Check if record uses conceptual name (e.g., "manufacturer": "Airbus")
    if (conceptualName && conceptualName in record && typeof record[conceptualName] === 'string') {
      const labelValue = record[conceptualName];
      const lookup = lookups[targetEntity] || {};
      const resolvedId = lookup[labelValue];

      if (resolvedId !== undefined) {
        // Replace conceptual name with technical name and resolved ID
        resolved[technicalName] = resolvedId;
        delete resolved[conceptualName];
      } else {
        console.warn(`  Warning: Could not resolve ${conceptualName}="${labelValue}" for ${entityName}`);
      }
    }
  }

  return resolved;
}

/**
 * Insert seed records
 * @param {string} entityName - Entity name
 * @param {Array} records - Seed records (may use conceptual FK names)
 * @param {object} lookups - Pre-built lookup maps for FK resolution
 */
function insertRecords(entityName, records, lookups = {}) {
  const db = getDatabase();
  const schema = getSchema();
  const entity = schema.entities[entityName];

  if (!entity) {
    console.log(`  Entity ${entityName} not in schema`);
    return 0;
  }

  const columns = entity.columns.map(c => c.name);
  const placeholders = columns.map(() => '?').join(', ');

  const insertSql = `INSERT OR REPLACE INTO ${entity.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
  const insert = db.prepare(insertSql);

  let count = 0;
  for (const record of records) {
    // Resolve conceptual FK references (e.g., "manufacturer": "Airbus" -> "manufacturer_id": 1)
    const resolved = resolveConceptualFKs(entityName, record, lookups);
    const values = columns.map(col => resolved[col] ?? null);
    try {
      insert.run(...values);
      count++;
    } catch (err) {
      console.error(`  Error inserting ${entityName}: ${err.message}`);
    }
  }

  return count;
}

/**
 * Clear all data from enabled tables
 */
function clearAllTables() {
  const db = getDatabase();
  const schema = getSchema();

  // Disable foreign keys temporarily
  db.pragma('foreign_keys = OFF');

  // Clear in reverse dependency order
  const reversed = [...schema.orderedEntities].reverse();

  for (const entity of reversed) {
    db.exec(`DELETE FROM ${entity.tableName}`);
    console.log(`  Cleared ${entity.tableName}`);
  }

  db.pragma('foreign_keys = ON');
}

// Main
async function main() {
  console.log('Seed Database Tool');
  console.log('==================');
  console.log(`Source: ${source} (${SEED_DIR})`);

  // Initialize database
  initDatabase(DB_PATH, DATA_MODEL_PATH, enabledEntities);

  const schema = getSchema();

  if (clearMode) {
    console.log('\nClearing all tables...');
    clearAllTables();
    console.log('Done.');
    closeDatabase();
    return;
  }

  // Determine which entities to seed
  let toSeed = entities.length > 0
    ? entities
    : schema.orderedEntities.map(e => e.className);

  // Filter to only enabled entities
  toSeed = toSeed.filter(name => enabledEntities.includes(name));

  console.log(`\nEntities to seed: ${toSeed.join(', ')}`);

  // Reset tables if requested
  if (resetMode) {
    console.log('\nResetting tables...');
    for (const name of toSeed) {
      try {
        resetTable(name);
        console.log(`  Reset ${name}`);
      } catch (err) {
        console.error(`  Error resetting ${name}: ${err.message}`);
      }
    }
  }

  // Load and insert seed data
  // Build lookup maps incrementally as entities are seeded (for FK resolution)
  console.log('\nLoading seed data...');

  const lookups = {};

  for (const name of toSeed) {
    const records = loadSeedData(name);
    if (records.length > 0) {
      const count = insertRecords(name, records, lookups);
      console.log(`  ${name}: ${count} records`);

      // Update lookup for this entity (so subsequent entities can reference it)
      lookups[name] = buildLabelLookup(name);
    }
  }

  console.log('\nDone.');
  closeDatabase();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
