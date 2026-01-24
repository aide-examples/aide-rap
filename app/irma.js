#!/usr/bin/env node
/**
 * AIDE IRMA - Intelligent Repair and Maintenance in Aviation
 */

const path = require('path');
const fs = require('fs');

// =============================================================================
// 1. PATH SETUP
// =============================================================================

const SCRIPT_DIR = __dirname;
const PROJECT_DIR = path.dirname(SCRIPT_DIR);
const TOOLS_DIR = path.join(PROJECT_DIR, 'tools');

// =============================================================================
// 2. AIDE-FRAME INIT
// =============================================================================

const aideFrame = require(path.join(PROJECT_DIR, 'aide-frame', 'js', 'aide_frame'));
const { paths, args, HttpServer } = aideFrame;

paths.init(SCRIPT_DIR);

// =============================================================================
// 3. APP IMPORTS
// =============================================================================

const parseDatamodel = require(path.join(TOOLS_DIR, 'parse-datamodel'));
const extractLayout = require(path.join(TOOLS_DIR, 'extract-layout'));
const backend = require('./server');

// =============================================================================
// 4. CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG = {
    port: 18354,
    log_level: 'INFO'
};

// =============================================================================
// 5. ARGUMENT PARSING
// =============================================================================

const { Command } = require('commander');
const program = new Command();

program.description('AIDE IRMA - Intelligent Repair and Maintenance in Aviation');
args.addCommonArgs(program);  // Adds --log-level, --config, --regenerate-icons
program.option('-p, --port <number>', 'Override port', parseInt);
program.parse();

const opts = program.opts();

// Apply common args (log level, config loading, icon generation)
const cfg = args.applyCommonArgs(opts, {
    configDefaults: DEFAULT_CONFIG,
    configSearchPaths: [path.join(SCRIPT_DIR, 'config.json')],
    appDir: SCRIPT_DIR,
});

if (opts.port) {
    cfg.port = opts.port;
}

// =============================================================================
// 6. SERVER SETUP
// =============================================================================

const server = new HttpServer({
    port: cfg.port,
    appDir: SCRIPT_DIR,
    docsConfig: {
        appName: 'AIDE IRMA',
        pwa: cfg.pwa && cfg.pwa.enabled ? cfg.pwa : null,
        docsEditable: cfg.docsEditable,
        helpEditable: cfg.helpEditable,
    },
    updateConfig: {
        githubRepo: 'aide-examples/aide-irma',
        serviceName: 'aide-irma',
    }
});

// =============================================================================
// 7. ROUTES
// =============================================================================

const app = server.getApp();

// =============================================================================
// 7a. BACKEND INITIALIZATION (CRUD API)
// =============================================================================

if (cfg.crud && cfg.crud.enabledEntities && cfg.crud.enabledEntities.length > 0) {
    // Filter out area separator comments (entries starting with 20 dashes)
    const enabledEntities = cfg.crud.enabledEntities.filter(e => !e.startsWith('--------------------'));
    backend.init(app, {
        appDir: SCRIPT_DIR,
        enabledEntities
    });
}

// =============================================================================
// 7b. FRONTEND ROUTES
// =============================================================================

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(SCRIPT_DIR, 'static', 'irma', 'irma.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/');
});

// Layout Editor page
app.get('/layout-editor', (req, res) => {
    res.sendFile(path.join(SCRIPT_DIR, 'static', 'irma', 'diagram', 'layout-editor.html'));
});

// API: List available data model documents
app.get('/api/layout-editor/documents', (req, res) => {
    try {
        const docsDir = path.join(SCRIPT_DIR, 'docs', 'requirements');
        const files = fs.readdirSync(docsDir);

        // Find .md files that have entity tables (data models)
        const docs = [];
        for (const file of files) {
            if (file.endsWith('.md')) {
                const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
                // Check if it contains entity descriptions (data model marker)
                if (content.includes('## Entity Descriptions') || content.includes('## Class Diagram')) {
                    docs.push(file.replace(/\.md$/, ''));
                }
            }
        }

        res.json(docs);
    } catch (e) {
        console.error('Failed to list documents:', e);
        res.status(500).json([]);
    }
});

// API: Load model and layout for a document
app.get('/api/layout-editor/load', (req, res) => {
    try {
        let docName = req.query.doc || 'DataModel';
        docName = path.basename(docName).replace(/\.md$/i, '');

        const docsDir = path.join(SCRIPT_DIR, 'docs', 'requirements');
        const mdPath = path.join(docsDir, `${docName}.md`);
        const layoutPath = path.join(docsDir, `${docName}-layout.json`);

        if (!fs.existsSync(mdPath)) {
            return res.status(404).json({
                success: false,
                error: `Document not found: ${docName}.md`
            });
        }

        // Parse model from markdown
        const model = parseDatamodel.parseDatamodel(mdPath);

        // Load or create layout
        let layout = { classes: {}, canvas: { width: 1200, height: 900 } };
        if (fs.existsSync(layoutPath)) {
            layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
        }

        // Ensure all classes have positions
        const classNames = Object.keys(model.classes);
        const cols = Math.ceil(Math.sqrt(classNames.length));
        classNames.forEach((name, i) => {
            if (!layout.classes[name]) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                layout.classes[name] = {
                    x: 50 + col * 180,
                    y: 50 + row * 80
                };
            }
        });

        res.json({
            success: true,
            model: model,
            layout: layout
        });
    } catch (e) {
        console.error('Failed to load document:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Save layout for a document
app.post('/api/layout-editor/save', (req, res) => {
    try {
        let docName = req.body.doc;
        if (!docName) {
            return res.status(400).json({ success: false, error: 'Missing doc parameter' });
        }

        docName = path.basename(docName).replace(/\.md$/i, '');
        const docsDir = path.join(SCRIPT_DIR, 'docs', 'requirements');
        const layoutPath = path.join(docsDir, `${docName}-layout.json`);
        const drawioPath = path.join(docsDir, `${docName}-layout.drawio`);

        const layout = req.body.layout;
        if (!layout) {
            return res.status(400).json({ success: false, error: 'Missing layout data' });
        }

        // Save layout.json
        fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2));

        // Update draw.io file positions if it exists
        if (fs.existsSync(drawioPath)) {
            let drawioContent = fs.readFileSync(drawioPath, 'utf-8');

            for (const [className, pos] of Object.entries(layout.classes || {})) {
                // Update mxGeometry for this class
                // Match: value="ClassName"...><mxGeometry x="..." y="..."
                const pattern = new RegExp(
                    `(value="${className}"[^>]*>[\\s\\S]*?<mxGeometry[^>]*?)x="[^"]*"([^>]*?)y="[^"]*"`,
                    'g'
                );
                drawioContent = drawioContent.replace(pattern, `$1x="${pos.x}"$2y="${pos.y}"`);
            }

            fs.writeFileSync(drawioPath, drawioContent);
        }

        // Save SVG diagrams if provided (client-side generation)
        const svgCompact = req.body.svgCompact;
        const svgDetailed = req.body.svgDetailed;

        if (svgCompact) {
            const svgPath = path.join(docsDir, `${docName}-diagram.svg`);
            fs.writeFileSync(svgPath, svgCompact);
        }

        if (svgDetailed) {
            const svgDetailedPath = path.join(docsDir, `${docName}-diagram-detailed.svg`);
            fs.writeFileSync(svgDetailedPath, svgDetailed);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Failed to save layout:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// 7c. SEED DATA MANAGEMENT API
// =============================================================================

const SeedManager = require('./server/utils/SeedManager');

// Get status of all entities (row counts, seed file availability)
app.get('/api/seed/status', (req, res) => {
    try {
        const status = SeedManager.getStatus();
        res.json(status);
    } catch (e) {
        console.error('Failed to get seed status:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get seed file content for preview/export
app.get('/api/seed/content/:entity', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const seedFile = path.join(SeedManager.SEED_DIR, `${req.params.entity}.json`);

        if (!fs.existsSync(seedFile)) {
            return res.status(404).json({ error: 'No seed file found', records: [] });
        }

        const records = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
        res.json({ records: Array.isArray(records) ? records : [] });
    } catch (e) {
        console.error(`Failed to read seed file for ${req.params.entity}:`, e);
        res.status(500).json({ error: e.message, records: [] });
    }
});

// Load seed data for a specific entity
// Options: { skipInvalid: boolean, mode: 'replace'|'merge'|'skip_conflicts' }
// - replace: INSERT OR REPLACE (default, may break FK refs if id changes)
// - merge: UPDATE existing records (preserve id), INSERT new ones
// - skip_conflicts: Skip records that conflict with existing ones
app.post('/api/seed/load/:entity', (req, res) => {
    try {
        const options = {
            skipInvalid: req.body?.skipInvalid === true,
            mode: req.body?.mode || 'replace'
        };
        const result = SeedManager.loadEntity(req.params.entity, null, options);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error(`Failed to load seed for ${req.params.entity}:`, e);
        res.status(400).json({ success: false, error: e.message });
    }
});

// Clear data for a specific entity
app.post('/api/seed/clear/:entity', (req, res) => {
    try {
        const result = SeedManager.clearEntity(req.params.entity);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error(`Failed to clear ${req.params.entity}:`, e);
        res.status(400).json({ success: false, error: e.message });
    }
});

// Load all seed files
app.post('/api/seed/load-all', (req, res) => {
    try {
        const results = SeedManager.loadAll();
        res.json({ success: true, results });
    } catch (e) {
        console.error('Failed to load all seeds:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Clear all entity data
app.post('/api/seed/clear-all', (req, res) => {
    try {
        const results = SeedManager.clearAll();
        res.json({ success: true, results });
    } catch (e) {
        console.error('Failed to clear all:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Reset all: clear then load
app.post('/api/seed/reset-all', (req, res) => {
    try {
        const results = SeedManager.resetAll();
        res.json({ success: true, ...results });
    } catch (e) {
        console.error('Failed to reset all:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// DEBUG: Test FK label lookup for an entity
app.get('/api/seed/debug-lookup/:entity', (req, res) => {
    try {
        const { getSchema, getDatabase } = require('./server/config/database');
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
app.post('/api/seed/validate/:entity', (req, res) => {
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
app.post('/api/seed/upload/:entity', (req, res) => {
    try {
        const result = SeedManager.uploadEntity(req.params.entity, req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error(`Failed to upload ${req.params.entity}:`, e);
        res.status(400).json({ success: false, error: e.message });
    }
});

// =============================================================================
// 7b. LLM SEED DATA GENERATOR API
// =============================================================================

const express = require('express');
const { getGenerator, resetGenerator } = require('./server/services/llm-generator');
const { readEntityInstruction, writeEntityInstruction, parseSeedContext, getEntityMdPath } = require('./server/utils/instruction-parser');
const { getSchema, getDatabase } = require('./server/config/database');

// JSON body parser for LLM API routes
app.use('/api/entity', express.json());
app.use('/api/seed', express.json());

// Get generator instruction from entity markdown
app.get('/api/entity/:name/generator-instruction', (req, res) => {
    try {
        const result = readEntityInstruction(req.params.name);
        res.json(result);
    } catch (e) {
        console.error(`Failed to read instruction for ${req.params.name}:`, e);
        res.status(500).json({ error: e.message });
    }
});

// Save generator instruction to entity markdown
app.put('/api/entity/:name/generator-instruction', (req, res) => {
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
app.get('/api/seed/generator-status', (req, res) => {
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
app.post('/api/seed/prompt/:entity', (req, res) => {
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

        // Load seed context data (validation/constraint entities)
        const mdPath = getEntityMdPath(entityName);
        let contextData = {};
        if (fs.existsSync(mdPath)) {
            const mdContent = fs.readFileSync(mdPath, 'utf-8');
            const contextSpecs = parseSeedContext(mdContent);
            contextData = generator.loadSeedContext(contextSpecs, getDatabase, schema);
        }

        // Build the prompt (without calling API)
        const prompt = generator.buildPrompt(entityName, schemaInfo, instruction, existingData, contextData);

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
app.post('/api/seed/generate/:entity', async (req, res) => {
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

        // Load seed context data (validation/constraint entities)
        const mdPath = getEntityMdPath(entityName);
        let contextData = {};
        if (fs.existsSync(mdPath)) {
            const mdContent = fs.readFileSync(mdPath, 'utf-8');
            const contextSpecs = parseSeedContext(mdContent);
            contextData = generator.loadSeedContext(contextSpecs, getDatabase, schema);
        }

        // Build the prompt (for display)
        const prompt = generator.buildPrompt(entityName, schemaInfo, instruction, existingData, contextData);

        // Generate data
        const data = await generator.generateSeedData(entityName, schemaInfo, instruction, existingData, contextData);

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
app.post('/api/seed/save/:entity', (req, res) => {
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

// =============================================================================
// 7d. PDF EXPORT API
// =============================================================================

const PrintService = require('./server/services/PrintService');
const CsvService = require('./server/services/CsvService');

// Export entity table to PDF
app.post('/api/entities/:entity/export-pdf', (req, res) => {
  try {
    const { title, columns, records, entityColor } = req.body;

    if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'columns and records arrays are required' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.pdf"`);

    const printService = new PrintService();
    printService.generatePdf({ title, columns, records, entityColor }, res);

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

// Export tree view to PDF (hierarchical format)
app.post('/api/entities/:entity/export-tree-pdf', (req, res) => {
  try {
    const { title, nodes, entityColor } = req.body;

    if (!nodes || !Array.isArray(nodes)) {
      return res.status(400).json({ error: 'nodes array is required' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}_tree.pdf"`);

    const printService = new PrintService();
    printService.generateTreePdf({ title, nodes, entityColor }, res);

  } catch (error) {
    console.error('Tree PDF generation error:', error);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

// Export entity table to CSV
app.post('/api/entities/:entity/export-csv', (req, res) => {
  try {
    const { columns, records } = req.body;

    if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'columns and records arrays are required' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`);

    const csvService = new CsvService();
    csvService.generateCsv({ columns, records }, res);

  } catch (error) {
    console.error('CSV generation error:', error);
    res.status(500).json({ error: 'CSV generation failed' });
  }
});

// =============================================================================
// 8. START SERVER
// =============================================================================

server.run();
