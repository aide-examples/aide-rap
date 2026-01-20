#!/usr/bin/env node
/**
 * Seed Database Tool
 *
 * Usage:
 *   node tools/seed-database.js                   # Load all seed data
 *   node tools/seed-database.js Aircraft          # Load specific entities
 *   node tools/seed-database.js --reset Aircraft  # Reset table and reload
 *   node tools/seed-database.js --clear           # Clear all tables
 */

const path = require('path');
const fs = require('fs');

const SCRIPT_DIR = path.join(__dirname, '..', 'app');
const SEED_DIR = path.join(SCRIPT_DIR, 'data', 'seed');
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
const entities = [];

for (const arg of args) {
  if (arg === '--reset') {
    resetMode = true;
  } else if (arg === '--clear') {
    clearMode = true;
  } else if (!arg.startsWith('-')) {
    entities.push(arg);
  }
}

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
 * Insert seed records
 */
function insertRecords(entityName, records) {
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
    const values = columns.map(col => record[col] ?? null);
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
  console.log('\nLoading seed data...');

  for (const name of toSeed) {
    const records = loadSeedData(name);
    if (records.length > 0) {
      const count = insertRecords(name, records);
      console.log(`  ${name}: ${count} records`);
    }
  }

  console.log('\nDone.');
  closeDatabase();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
