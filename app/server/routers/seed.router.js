/**
 * Seed Data Management Router
 * Routes: /api/seed/* (status, content, load, clear, validate, upload)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function(cfg) {
    const router = express.Router();
    const SeedManager = require('../utils/SeedManager');
    const { getSchema, getDatabase } = require('../config/database');

    // Initialize SeedManager with system-specific seed directory
    SeedManager.init(cfg.paths.seed);

    // JSON body parser for seed routes
    router.use(express.json());

    // Get status of all entities (row counts, seed file availability)
    router.get('/api/seed/status', (req, res) => {
        try {
            const status = SeedManager.getStatus();
            res.json(status);
        } catch (e) {
            console.error('Failed to get seed status:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // Get seed/import file content for preview/export (includes conflict detection)
    // Query params:
    //   sourceDir = 'seed' (default) | 'import' | 'backup'
    //   checkOnly = 'true' - only check if file exists and return count (no full content)
    router.get('/api/seed/content/:entity', (req, res) => {
        try {
            const sourceDir = req.query.sourceDir || 'seed';
            const checkOnly = req.query.checkOnly === 'true';

            // Determine source directory
            let sourceDirectory;
            if (sourceDir === 'import') {
                sourceDirectory = SeedManager.getImportDir();
            } else if (sourceDir === 'backup') {
                sourceDirectory = SeedManager.getBackupDir();
            } else {
                sourceDirectory = SeedManager.getSeedDir();
            }

            const seedFile = path.join(sourceDirectory, `${req.params.entity}.json`);
            const exists = fs.existsSync(seedFile);

            // checkOnly mode: just return existence and count
            if (checkOnly) {
                if (!exists) {
                    return res.json({ exists: false, count: 0 });
                }
                const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
                const count = Array.isArray(records) ? records.length : 0;
                return res.json({ exists: true, count });
            }

            if (!exists) {
                return res.status(404).json({ error: `No ${sourceDir} file found`, records: [] });
            }

            const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
            const recordsArray = Array.isArray(records) ? records : [];

            // Check for conflicts with existing DB data
            const { dbRowCount, conflictCount } = SeedManager.countSeedConflicts(req.params.entity, sourceDir);

            res.json({ records: recordsArray, dbRowCount, conflictCount });
        } catch (e) {
            console.error(`Failed to read seed file for ${req.params.entity}:`, e);
            res.status(500).json({ error: e.message, records: [] });
        }
    });

    // Load seed/import data for a specific entity
    // Options: { skipInvalid: boolean, mode: 'replace'|'merge'|'skip_conflicts', sourceDir: 'seed'|'import' }
    // - replace: INSERT OR REPLACE (default, may break FK refs if id changes)
    // - merge: UPDATE existing records (preserve id), INSERT new ones
    // - skip_conflicts: Skip records that conflict with existing ones
    // - sourceDir: 'seed' (default) or 'import'
    router.post('/api/seed/load/:entity', async (req, res) => {
        try {
            const options = {
                skipInvalid: req.body?.skipInvalid === true,
                mode: req.body?.mode || 'replace',
                sourceDir: req.body?.sourceDir || 'seed'
            };
            const result = await SeedManager.loadEntity(req.params.entity, null, options);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error(`Failed to load seed for ${req.params.entity}:`, e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    // Clear data for a specific entity
    router.post('/api/seed/clear/:entity', (req, res) => {
        try {
            const result = SeedManager.clearEntity(req.params.entity);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error(`Failed to clear ${req.params.entity}:`, e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    // Load all seed files
    router.post('/api/seed/load-all', async (req, res) => {
        try {
            const results = await SeedManager.loadAll();
            res.json({ success: true, results });
        } catch (e) {
            console.error('Failed to load all seeds:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Import all (prefers import/ over seed/)
    router.post('/api/seed/import-all', async (req, res) => {
        try {
            const results = await SeedManager.importAll();
            res.json({ success: true, results });
        } catch (e) {
            console.error('Failed to import all:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Clear all entity data
    router.post('/api/seed/clear-all', (req, res) => {
        try {
            const results = SeedManager.clearAll();
            res.json({ success: true, results });
        } catch (e) {
            console.error('Failed to clear all:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Reset all: clear then load
    router.post('/api/seed/reset-all', async (req, res) => {
        try {
            const results = await SeedManager.resetAll();
            res.json({ success: true, ...results });
        } catch (e) {
            console.error('Failed to reset all:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // DEBUG: Test FK label lookup for an entity
    router.get('/api/seed/debug-lookup/:entity', (req, res) => {
        try {
            const schema = getSchema();
            const db = getDatabase();
            const entityName = req.params.entity;
            const entity = schema.entities[entityName];

            if (!entity) {
                return res.status(404).json({ error: `Entity ${entityName} not found` });
            }

            // Find LABEL and LABEL2 columns
            const labelCol = entity.columns.find(c => c.ui?.label);
            const label2Col = entity.columns.find(c => c.ui?.label2);

            // Build lookup
            const selectCols = ['id'];
            if (labelCol) selectCols.push(labelCol.name);
            if (label2Col && label2Col.name !== labelCol?.name) selectCols.push(label2Col.name);

            const sql = `SELECT ${selectCols.join(', ')} FROM ${entity.tableName}`;
            const rows = db.prepare(sql).all();

            const lookup = {};
            for (const row of rows) {
                if (labelCol && row[labelCol.name]) {
                    lookup[row[labelCol.name]] = row.id;
                }
                if (label2Col && row[label2Col.name]) {
                    lookup[row[label2Col.name]] = row.id;
                }
            }

            res.json({
                entity: entityName,
                labelCol: labelCol?.name || null,
                label2Col: label2Col?.name || null,
                rowCount: rows.length,
                lookupKeys: Object.keys(lookup),
                lookup
            });
        } catch (e) {
            console.error(`Debug lookup error:`, e);
            res.status(500).json({ error: e.message });
        }
    });

    // Validate import data (check FK references)
    router.post('/api/seed/validate/:entity', (req, res) => {
        try {
            const { records } = req.body;
            if (!Array.isArray(records)) {
                return res.status(400).json({ valid: false, warnings: [{ message: 'records must be an array' }] });
            }
            const result = SeedManager.validateImport(req.params.entity, records);
            res.json(result);
        } catch (e) {
            console.error(`Failed to validate ${req.params.entity}:`, e);
            res.status(500).json({ valid: false, warnings: [{ message: e.message }] });
        }
    });

    // Upload/save data for an entity (saves to seed/)
    router.post('/api/seed/upload/:entity', (req, res) => {
        try {
            const result = SeedManager.uploadEntity(req.params.entity, req.body);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error(`Failed to upload ${req.params.entity}:`, e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    // Reinitialize: re-read DataModel.md, rebuild schema, tables, views
    router.post('/api/seed/reinitialize', (req, res) => {
        try {
            const { reinitialize } = require('../config/database');
            const ComputedFieldService = require('../services/ComputedFieldService');
            const { clearDiagramCache } = require('./schema.router');

            const result = reinitialize();

            // Re-run computed field setup
            ComputedFieldService.applyDefaults();
            ComputedFieldService.runAll();
            ComputedFieldService.stopScheduler();
            ComputedFieldService.scheduleDailyRun();

            // Re-initialize SeedManager with fresh schema
            SeedManager.init(cfg.paths.seed);

            // Clear diagram cache (schema changed)
            if (clearDiagramCache) clearDiagramCache();

            res.json({ success: true, message: `Reinitialized with ${result.entities} entities` });
        } catch (e) {
            console.error('Failed to reinitialize:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Backup all entity data to JSON files
    router.post('/api/seed/backup', (req, res) => {
        try {
            const result = SeedManager.backupAll();
            const totalRecords = Object.values(result.entities).reduce((sum, n) => sum + n, 0);
            res.json({ success: true, totalRecords, entities: result.entities });
        } catch (e) {
            console.error('Failed to create backup:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Restore all entity data from backup files
    router.post('/api/seed/restore-backup', async (req, res) => {
        try {
            const results = await SeedManager.restoreBackup();
            res.json({ success: true, results });
        } catch (e) {
            console.error('Failed to restore backup:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Restore a single entity from backup
    router.post('/api/seed/restore/:entity', async (req, res) => {
        try {
            const result = await SeedManager.restoreEntity(req.params.entity);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error(`Failed to restore ${req.params.entity}:`, e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    return router;
};
