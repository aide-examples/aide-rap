/**
 * LLM Seed Data Generator Router
 * Routes: /api/entity/:name/generator-instruction, /api/seed/generator-status,
 *         /api/seed/prompt, /api/seed/generate, /api/seed/save
 */

const express = require('express');
const fs = require('fs');

module.exports = function(cfg) {
    const router = express.Router();

    const { getGenerator, resetGenerator } = require('../services/llm-generator');
    const instructionParser = require('../utils/instruction-parser');
    const { readEntityInstruction, writeEntityInstruction, parseSeedContext, getEntityMdPath } = instructionParser;
    const { getSchema, getDatabase } = require('../config/database');

    // Initialize instruction-parser with system-specific docs directory
    instructionParser.init(cfg.paths.docs);

    // JSON body parser for LLM API routes
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

    // Check if LLM generator is configured (and reset to pick up config changes)
    router.get('/api/seed/generator-status', (req, res) => {
        resetGenerator(); // Reset to pick up any config changes
        const generator = getGenerator(cfg.llm);
        const activeProvider = generator.getActiveProvider();
        const providerConfig = cfg.llm?.providers?.[activeProvider] || cfg.llm || {};
        res.json({
            enabled: generator.isEnabled(),
            provider: activeProvider,
            model: providerConfig.model || 'unknown',
            availableProviders: cfg.llm?.providers ? Object.keys(cfg.llm.providers) : [activeProvider]
        });
    });

    // Build prompt without calling LLM API
    router.post('/api/seed/prompt/:entity', (req, res) => {
        try {
            const entityName = req.params.entity;
            const { instruction: overrideInstruction } = req.body;

            // Get generator
            const generator = getGenerator(cfg.llm);

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

            // Build schema info for LLM
            const schemaInfo = {
                columns: entity.columns,
                types: schema.types || {}
            };

            // Load existing FK data from database (pass full schema for labelFields lookup)
            const existingData = generator.loadExistingDataForFKs(schemaInfo, getDatabase, schema);

            // Load back-reference data (entities that reference this one)
            const backRefData = generator.loadBackReferenceData(entityName, getDatabase, schema);

            // Load seed context data (validation/constraint entities)
            const mdPath = getEntityMdPath(entityName);
            let contextData = {};
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                const contextSpecs = parseSeedContext(mdContent);
                contextData = generator.loadSeedContext(contextSpecs, getDatabase, schema);
            }

            // Build the prompt (without calling API)
            const prompt = generator.buildPrompt(entityName, schemaInfo, instruction, existingData, contextData, backRefData);

            res.json({
                success: true,
                prompt,
                instruction
            });
        } catch (e) {
            console.error(`Failed to build prompt for ${req.params.entity}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Generate seed data using LLM
    router.post('/api/seed/generate/:entity', async (req, res) => {
        try {
            const entityName = req.params.entity;
            const { instruction: overrideInstruction } = req.body;

            // Get generator
            const generator = getGenerator(cfg.llm);
            if (!generator.isEnabled()) {
                return res.status(400).json({
                    success: false,
                    error: 'LLM Generator not configured. Add llm.apiKey to config.json'
                });
            }

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

            // Build schema info for LLM
            const schemaInfo = {
                columns: entity.columns,
                types: schema.types || {}
            };

            // Load existing FK data from database (pass full schema for labelFields lookup)
            const existingData = generator.loadExistingDataForFKs(schemaInfo, getDatabase, schema);

            // Load back-reference data (entities that reference this one)
            const backRefData = generator.loadBackReferenceData(entityName, getDatabase, schema);

            // Load seed context data (validation/constraint entities)
            const mdPath = getEntityMdPath(entityName);
            let contextData = {};
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                const contextSpecs = parseSeedContext(mdContent);
                contextData = generator.loadSeedContext(contextSpecs, getDatabase, schema);
            }

            // Build the prompt (for display)
            const prompt = generator.buildPrompt(entityName, schemaInfo, instruction, existingData, contextData, backRefData);

            // Generate data
            const data = await generator.generateSeedData(entityName, schemaInfo, instruction, existingData, contextData, backRefData);

            res.json({
                success: true,
                data,
                count: data.length,
                instruction,
                prompt
            });
        } catch (e) {
            console.error(`Failed to generate seed for ${req.params.entity}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Save generated data to seed file
    router.post('/api/seed/save/:entity', (req, res) => {
        try {
            const entityName = req.params.entity;
            const { data } = req.body;

            if (!data || !Array.isArray(data)) {
                return res.status(400).json({
                    success: false,
                    error: 'data must be an array'
                });
            }

            const generator = getGenerator(cfg.llm);
            const filePath = generator.saveGeneratedData(entityName, data);

            res.json({
                success: true,
                path: filePath,
                count: data.length
            });
        } catch (e) {
            console.error(`Failed to save seed for ${req.params.entity}:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    return router;
};
