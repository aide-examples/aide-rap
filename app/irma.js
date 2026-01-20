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
const generateDiagram = require(path.join(TOOLS_DIR, 'generate-diagram'));
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
    backend.init(app, {
        appDir: SCRIPT_DIR,
        enabledEntities: cfg.crud.enabledEntities
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
    res.sendFile(path.join(SCRIPT_DIR, 'static', 'irma', 'layout-editor.html'));
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

        res.json({ success: true });
    } catch (e) {
        console.error('Failed to save layout:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Regenerate diagrams from a DataModel markdown file
// Query param: ?doc=MiniModel (defaults to DataModel)
app.post('/api/regenerate-diagrams', async (req, res) => {
    try {
        // Get document name from query parameter (without .md extension)
        let docName = req.query.doc || 'DataModel';

        // Security: prevent path traversal
        docName = path.basename(docName).replace(/\.md$/i, '');

        const docsDir = path.join(SCRIPT_DIR, 'docs', 'requirements');
        const mdPath = path.join(docsDir, `${docName}.md`);

        // Check if source document exists
        if (!fs.existsSync(mdPath)) {
            return res.status(404).json({
                success: false,
                error: `Document not found: ${docName}.md`
            });
        }

        // Artifacts use document name as prefix
        const yamlPath = path.join(docsDir, `${docName}.yaml`);
        const layoutPath = path.join(docsDir, `${docName}-layout.json`);
        const drawioPath = path.join(docsDir, `${docName}-layout.drawio`);
        const diagramPath = path.join(docsDir, `${docName}-diagram.svg`);
        const diagramDetailedPath = path.join(docsDir, `${docName}-diagram-detailed.svg`);

        // Step 1: Parse Markdown to YAML
        const model = parseDatamodel.parseDatamodel(mdPath);
        const yaml = require('js-yaml');
        fs.writeFileSync(yamlPath, yaml.dump(model, { noRefs: true, sortKeys: false }));

        // Build class-to-area mapping for colors
        const classToArea = {};
        for (const [className, classDef] of Object.entries(model.classes)) {
            classToArea[className] = classDef.area || 'unknown';
        }
        const classNames = Object.keys(model.classes);

        // Step 2: Handle draw.io file
        if (fs.existsSync(drawioPath)) {
            // Remove classes that no longer exist in the model
            const removedClasses = extractLayout.removeClassesFromDrawio(drawioPath, classNames);
            if (removedClasses.length > 0) {
                console.log(`Removed ${removedClasses.length} classes from ${docName}-layout.drawio: ${removedClasses.join(', ')}`);
            }

            // Add any new classes to the existing draw.io file
            const addedClasses = extractLayout.addClassesToDrawio(
                drawioPath,
                classNames,
                model.areas,
                classToArea
            );
            if (addedClasses.length > 0) {
                console.log(`Added ${addedClasses.length} new classes to ${docName}-layout.drawio: ${addedClasses.join(', ')}`);
            }

            // Extract positions from draw.io and sync layout.json
            const positions = extractLayout.extractPositions(drawioPath);
            if (Object.keys(positions).length > 0) {
                extractLayout.updateLayoutJson(layoutPath, positions, classNames);
            }
        } else {
            // Create new draw.io file with all classes
            extractLayout.createDrawioFile(drawioPath, classNames, model.areas, classToArea);
            console.log(`Created ${docName}-layout.drawio with ${classNames.length} classes`);

            // Extract positions to create layout.json
            const positions = extractLayout.extractPositions(drawioPath);
            extractLayout.updateLayoutJson(layoutPath, positions, classNames);
        }

        // Step 3: Ensure layout.json exists (fallback if draw.io extraction failed)
        if (!fs.existsSync(layoutPath)) {
            const defaultLayout = {
                canvas: { width: 1200, height: 900 },
                classes: {}
            };
            const cols = Math.ceil(Math.sqrt(classNames.length));
            classNames.forEach((name, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                defaultLayout.classes[name] = {
                    x: 50 + col * 180,
                    y: 50 + row * 120
                };
            });
            fs.writeFileSync(layoutPath, JSON.stringify(defaultLayout, null, 2));
        }

        // Step 4: Generate compact diagram
        const generator = new generateDiagram.DiagramGenerator(yamlPath, layoutPath);
        const svgCompact = generator.generate({ showAttributes: false, showLegend: true });
        fs.writeFileSync(diagramPath, svgCompact);

        // Step 5: Generate detailed diagram
        const svgDetailed = generator.generate({ showAttributes: true, showLegend: true });
        fs.writeFileSync(diagramDetailedPath, svgDetailed);

        res.json({
            success: true,
            message: `Diagrams for ${docName} regenerated successfully`,
            doc: docName,
            files: [
                path.relative(PROJECT_DIR, yamlPath),
                path.relative(PROJECT_DIR, diagramPath),
                path.relative(PROJECT_DIR, diagramDetailedPath)
            ]
        });
    } catch (e) {
        console.error('Failed to regenerate diagrams:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// 8. START SERVER
// =============================================================================

server.run();
