/**
 * Prompt Builder Router
 * Routes: /api/entity/:name/generator-instruction, /api/seed/prompt, /api/seed/parse
 */

const express = require('express');
const fs = require('fs');

module.exports = function(cfg) {
    const router = express.Router();

    const promptBuilder = require('../services/prompt-builder');
    const instructionParser = require('../utils/instruction-parser');
    const {
        readEntityInstruction, writeEntityInstruction,
        readEntityCompleterInstruction, writeEntityCompleterInstruction,
        parseSeedContext, getEntityMdPath
    } = instructionParser;
    const SeedManager = require('../utils/SeedManager');
    const { getSchema, getDatabase } = require('../config/database');

    // Initialize instruction-parser with system-specific docs directory
    instructionParser.init(cfg.paths.docs);

    // JSON body parser
    router.use(express.json());

    // Get generator instruction from entity markdown
    router.get('/api/entity/:name/generator-instruction', (req, res) => {
        try {
            const result = readEntityInstruction(req.params.name);
            res.json(result);
        } catch (e) {
            console.error(`Failed to read instruction for ${req.params.name}:`, e);
            res.status(500).json({ error: e.message });
        }
    });

    // Save generator instruction to entity markdown
    router.put('/api/entity/:name/generator-instruction', (req, res) => {
        try {
            const { instruction } = req.body;
            if (!instruction) {
                return res.status(400).json({ success: false, error: 'instruction is required' });
            }
            const result = writeEntityInstruction(req.params.name, instruction);
            res.json(result);
        } catch (e) {
            console.error(`Failed to write instruction for ${req.params.name}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Get completer instruction from entity markdown
    router.get('/api/entity/:name/completer-instruction', (req, res) => {
        try {
            const result = readEntityCompleterInstruction(req.params.name);
            res.json(result);
        } catch (e) {
            console.error(`Failed to read completer instruction for ${req.params.name}:`, e);
            res.status(500).json({ error: e.message });
        }
    });

    // Save completer instruction to entity markdown
    router.put('/api/entity/:name/completer-instruction', (req, res) => {
        try {
            const { instruction } = req.body;
            if (!instruction) {
                return res.status(400).json({ success: false, error: 'instruction is required' });
            }
            const result = writeEntityCompleterInstruction(req.params.name, instruction);
            res.json(result);
        } catch (e) {
            console.error(`Failed to write completer instruction for ${req.params.name}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Build prompt without calling any API
    router.post('/api/seed/prompt/:entity', (req, res) => {
        try {
            const entityName = req.params.entity;
            const { instruction: overrideInstruction } = req.body;

            // Get schema for entity
            const schema = getSchema();
            const entity = schema.entities[entityName];
            if (!entity) {
                return res.status(404).json({
                    success: false,
                    error: `Entity ${entityName} not found`
                });
            }

            // Get instruction (from request body or markdown file)
            let instruction = overrideInstruction;
            if (!instruction) {
                const mdResult = readEntityInstruction(entityName);
                instruction = mdResult.instruction;
            }

            if (!instruction) {
                return res.status(400).json({
                    success: false,
                    error: `No generator instruction found for ${entityName}. Add a "## Data Generator" section to the entity markdown.`
                });
            }

            // Build schema info
            const schemaInfo = {
                columns: entity.columns,
                types: schema.types || {}
            };

            // Load existing FK data from database (with seed file fallback)
            const { existingData, seedOnlyFKs } = promptBuilder.loadExistingDataForFKs(schemaInfo, getDatabase, schema);

            // Compute which FK entities have no data at all (not in DB, not in seed)
            const fkEntities = entity.columns.filter(c => c.foreignKey).map(c => c.foreignKey.entity);
            const loadedEntities = Object.keys(existingData);
            const emptyFKs = [...new Set(fkEntities.filter(e => !loadedEntities.includes(e)))];

            // Load back-reference data (entities that reference this one)
            const backRefData = promptBuilder.loadBackReferenceData(entityName, getDatabase, schema);

            // Load seed context data (validation/constraint entities)
            const mdPath = getEntityMdPath(entityName);
            let contextData = {};
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                const contextSpecs = parseSeedContext(mdContent);
                contextData = promptBuilder.loadSeedContext(contextSpecs, getDatabase, schema);
            }

            // Build the prompt
            const prompt = promptBuilder.buildPrompt(entityName, schemaInfo, instruction, existingData, contextData, backRefData);

            res.json({
                success: true,
                prompt,
                instruction,
                emptyFKs,
                seedOnlyFKs // FK entities with data only in seed files (not loaded in DB)
            });
        } catch (e) {
            console.error(`Failed to build prompt for ${req.params.entity}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Build complete prompt (for filling missing attributes in existing records)
    router.post('/api/seed/complete-prompt/:entity', (req, res) => {
        try {
            const entityName = req.params.entity;
            const { instruction: overrideInstruction } = req.body;

            // Get schema for entity
            const schema = getSchema();
            const entity = schema.entities[entityName];
            if (!entity) {
                return res.status(404).json({
                    success: false,
                    error: `Entity ${entityName} not found`
                });
            }

            // Get instruction (from request body or markdown file)
            let instruction = overrideInstruction;
            if (!instruction) {
                const mdResult = readEntityCompleterInstruction(entityName);
                instruction = mdResult.instruction;
            }

            if (!instruction) {
                return res.status(400).json({
                    success: false,
                    error: `No completer instruction found for ${entityName}. Add a "## Data Completer" section to the entity markdown.`
                });
            }

            // Load existing records from database
            const db = getDatabase();
            let existingRecords = [];
            try {
                existingRecords = db.prepare(`SELECT * FROM ${entity.tableName}`).all();
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    error: `No data in ${entityName} table. Load some records first.`
                });
            }

            if (existingRecords.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: `No records in ${entityName}. Load some records first before completing.`
                });
            }

            // Build schema info
            const schemaInfo = {
                columns: entity.columns,
                types: schema.types || {}
            };

            // Load FK data for reference
            const { existingData: fkData, seedOnlyFKs } = promptBuilder.loadExistingDataForFKs(schemaInfo, getDatabase, schema);

            // Compute which FK entities have no data
            const fkEntities = entity.columns.filter(c => c.foreignKey).map(c => c.foreignKey.entity);
            const loadedEntities = Object.keys(fkData);
            const emptyFKs = [...new Set(fkEntities.filter(e => !loadedEntities.includes(e)))];

            // Load seed context data
            const mdPath = getEntityMdPath(entityName);
            let contextData = {};
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                const contextSpecs = parseSeedContext(mdContent);
                contextData = promptBuilder.loadSeedContext(contextSpecs, getDatabase, schema);
            }

            // Build the complete prompt
            const prompt = promptBuilder.buildCompletePrompt(entityName, schemaInfo, instruction, existingRecords, fkData, contextData);

            res.json({
                success: true,
                prompt,
                instruction,
                recordCount: existingRecords.length,
                emptyFKs,
                seedOnlyFKs
            });
        } catch (e) {
            console.error(`Failed to build complete prompt for ${req.params.entity}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Parse pasted AI response and validate in one step
    router.post('/api/seed/parse/:entity', (req, res) => {
        try {
            const entityName = req.params.entity;
            const { text } = req.body;

            if (!text || typeof text !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'text is required (the AI response to parse)'
                });
            }

            // Parse the pasted text (strip markdown, extract JSON array)
            const records = promptBuilder.parseResponse(text);

            // Validate (same as import dialog uses)
            const validation = SeedManager.validateImport(entityName, records);

            res.json({
                success: true,
                records,
                count: records.length,
                ...validation
            });
        } catch (e) {
            // Parse errors are user-facing (truncation, invalid JSON)
            res.status(400).json({
                success: false,
                error: e.message
            });
        }
    });

    return router;
};
