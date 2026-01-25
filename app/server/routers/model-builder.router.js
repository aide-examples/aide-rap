/**
 * Model Builder Router
 * Routes for creating new AIDE RAP systems from design descriptions
 *
 * Endpoints:
 * - GET /api/model-builder/systems - List existing systems
 * - GET /api/model-builder/systems/:name - Load system state (config, design.md)
 * - POST /api/model-builder/systems/:name - Create minimal system (Tab 1)
 * - PUT /api/model-builder/systems/:name/design - Save design brief (Tab 2)
 * - POST /api/model-builder/systems/:name/import - Import entities with mode
 * - POST /api/model-builder/prompt - Build enriched AI prompt
 * - POST /api/model-builder/parse - Parse Mermaid ER diagram
 * - POST /api/model-builder/generate - Generate system files (legacy)
 */

const express = require('express');

module.exports = function(cfg) {
    const router = express.Router();

    const modelBuilder = require('../services/model-builder');

    // JSON body parser
    router.use(express.json());

    /**
     * List existing systems
     * Returns array of { name, displayName, port }
     */
    router.get('/api/model-builder/systems', (req, res) => {
        try {
            const systems = modelBuilder.listSystems();
            res.json({
                success: true,
                systems,
                nextPort: modelBuilder.findNextPort()
            });
        } catch (e) {
            console.error('Failed to list systems:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Load system state for resuming
     * Returns config, design brief, existing entities
     */
    router.get('/api/model-builder/systems/:name', (req, res) => {
        try {
            const { name } = req.params;
            const state = modelBuilder.loadSystemState(name);

            if (!state) {
                return res.status(404).json({
                    success: false,
                    error: `System '${name}' not found`
                });
            }

            res.json({
                success: true,
                ...state
            });
        } catch (e) {
            console.error('Failed to load system state:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Create minimal system (Tab 1)
     * Creates system directory with config.json
     *
     * Body: { displayName, description, themeColor }
     * Returns: { success, systemDir, port }
     */
    router.post('/api/model-builder/systems/:name', (req, res) => {
        try {
            const { name } = req.params;
            const { displayName, description, themeColor } = req.body;

            if (!displayName) {
                return res.status(400).json({
                    success: false,
                    error: 'displayName is required'
                });
            }

            // Validate system name format (snake_case, lowercase)
            if (!/^[a-z][a-z0-9_]*$/.test(name)) {
                return res.status(400).json({
                    success: false,
                    error: 'System name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
                });
            }

            const result = modelBuilder.createMinimalSystem(
                name,
                displayName,
                description || displayName,
                themeColor
            );

            res.json({
                success: true,
                ...result
            });
        } catch (e) {
            console.error('Failed to create minimal system:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Save design brief (Tab 2)
     *
     * Body: { designBrief }
     * Returns: { success }
     */
    router.put('/api/model-builder/systems/:name/design', (req, res) => {
        try {
            const { name } = req.params;
            const { designBrief } = req.body;

            if (!designBrief) {
                return res.status(400).json({
                    success: false,
                    error: 'designBrief is required'
                });
            }

            // Check system exists
            const state = modelBuilder.loadSystemState(name);
            if (!state) {
                return res.status(404).json({
                    success: false,
                    error: `System '${name}' not found`
                });
            }

            modelBuilder.saveDesignBrief(name, designBrief);

            res.json({ success: true });
        } catch (e) {
            console.error('Failed to save design brief:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Import entities (Tab 5)
     *
     * Body: { entities, seedingInstructions, mode, areas, descriptions }
     * mode: 'replace' | 'merge-ignore' | 'merge-replace'
     * areas: { AreaName: { color: "#...", entities: [...] } }
     * descriptions: { EntityName: "description" }
     * Returns: { success, imported, skipped, replaced }
     */
    router.post('/api/model-builder/systems/:name/import', (req, res) => {
        try {
            const { name } = req.params;
            const { entities, seedingInstructions, mode, areas, descriptions } = req.body;

            if (!entities || !Array.isArray(entities)) {
                return res.status(400).json({
                    success: false,
                    error: 'entities array is required'
                });
            }

            if (entities.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'At least one entity is required'
                });
            }

            const validModes = ['replace', 'merge-ignore', 'merge-replace'];
            if (mode && !validModes.includes(mode)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid mode. Must be one of: ${validModes.join(', ')}`
                });
            }

            // Check system exists
            const state = modelBuilder.loadSystemState(name);
            if (!state) {
                return res.status(404).json({
                    success: false,
                    error: `System '${name}' not found`
                });
            }

            const result = modelBuilder.importEntities(
                name,
                entities,
                seedingInstructions || {},
                mode || 'replace',
                areas || {},
                descriptions || {}
            );

            res.json({
                success: true,
                ...result
            });
        } catch (e) {
            console.error('Failed to import entities:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Build enriched prompt from design brief
     *
     * Body: { systemName, displayName, description, designBrief }
     * Returns: { success, prompt }
     */
    router.post('/api/model-builder/prompt', (req, res) => {
        try {
            const { systemName, displayName, description, designBrief } = req.body;

            if (!systemName || !displayName || !designBrief) {
                return res.status(400).json({
                    success: false,
                    error: 'systemName, displayName, and designBrief are required'
                });
            }

            // Validate system name format (snake_case, lowercase)
            if (!/^[a-z][a-z0-9_]*$/.test(systemName)) {
                return res.status(400).json({
                    success: false,
                    error: 'System name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
                });
            }

            const prompt = modelBuilder.buildPrompt(systemName, displayName, description || displayName, designBrief);

            res.json({
                success: true,
                prompt
            });
        } catch (e) {
            console.error('Failed to build prompt:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Parse Mermaid ER diagram response
     *
     * Body: { mermaidCode }
     * Returns: { success, entities, relationships, seedingInstructions, areas, descriptions, validation }
     */
    router.post('/api/model-builder/parse', (req, res) => {
        try {
            const { mermaidCode } = req.body;

            if (!mermaidCode) {
                return res.status(400).json({
                    success: false,
                    error: 'mermaidCode is required'
                });
            }

            const result = modelBuilder.parseResponse(mermaidCode);

            res.json({
                success: true,
                entities: result.entities,
                relationships: result.relationships,
                seedingInstructions: result.seedingInstructions,
                areas: result.areas || {},
                descriptions: result.descriptions || {},
                validation: result.validation
            });
        } catch (e) {
            console.error('Failed to parse Mermaid:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Delete a system completely
     * Removes the entire system directory and all contents
     */
    router.delete('/api/model-builder/systems/:name', (req, res) => {
        try {
            const { name } = req.params;

            // Check system exists
            const state = modelBuilder.loadSystemState(name);
            if (!state) {
                return res.status(404).json({
                    success: false,
                    error: `System '${name}' not found`
                });
            }

            const result = modelBuilder.deleteSystem(name);

            res.json({
                success: true,
                ...result
            });
        } catch (e) {
            console.error('Failed to delete system:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * Generate complete system
     *
     * Body: { systemName, displayName, description, entities, seedingInstructions, themeColor, areas, descriptions }
     * areas: { AreaName: { color: "#...", entities: [...] } }
     * descriptions: { EntityName: "description" }
     * Returns: { success, systemDir, port, entityCount, files }
     */
    router.post('/api/model-builder/generate', (req, res) => {
        try {
            const { systemName, displayName, description, entities, seedingInstructions, themeColor, areas, descriptions } = req.body;

            if (!systemName || !displayName || !entities || !Array.isArray(entities)) {
                return res.status(400).json({
                    success: false,
                    error: 'systemName, displayName, and entities array are required'
                });
            }

            if (entities.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'At least one entity is required'
                });
            }

            // Check if system already exists
            const existingSystems = modelBuilder.listSystems();
            if (existingSystems.some(s => s.name === systemName)) {
                return res.status(400).json({
                    success: false,
                    error: `System '${systemName}' already exists`
                });
            }

            const result = modelBuilder.generateSystem(
                systemName,
                displayName,
                description || displayName,
                entities,
                seedingInstructions || {},
                themeColor,
                areas || {},
                descriptions || {}
            );

            res.json({
                success: true,
                ...result
            });
        } catch (e) {
            console.error('Failed to generate system:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    return router;
};
