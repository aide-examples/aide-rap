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

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(SCRIPT_DIR, 'static', 'irma', 'irma.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/');
});

// API: Regenerate diagrams from DataModel.md
app.post('/api/regenerate-diagrams', async (req, res) => {
    try {
        const docsDir = path.join(SCRIPT_DIR, 'docs', 'requirements');
        const mdPath = path.join(docsDir, 'DataModel.md');
        const yamlPath = path.join(docsDir, 'DataModel.yaml');
        const layoutPath = path.join(docsDir, 'layout.json');
        const drawioPath = path.join(docsDir, 'layout.drawio');
        const diagramPath = path.join(docsDir, 'diagram.svg');
        const diagramDetailedPath = path.join(docsDir, 'diagram-detailed.svg');

        // Step 1: Parse DataModel.md to YAML
        const model = parseDatamodel.parseDatamodel(mdPath);
        const yaml = require('js-yaml');
        fs.writeFileSync(yamlPath, yaml.dump(model, { noRefs: true, sortKeys: false }));

        // Step 2: Extract layout from draw.io (if exists)
        if (fs.existsSync(drawioPath)) {
            const positions = extractLayout.extractPositions(drawioPath);
            if (Object.keys(positions).length > 0) {
                extractLayout.updateLayoutJson(layoutPath, positions);
            }
        }

        // Step 3: Generate compact diagram
        const generator = new generateDiagram.DiagramGenerator(yamlPath, layoutPath);
        const svgCompact = generator.generate({ showAttributes: false, showLegend: true, yScale: 1.0 });
        fs.writeFileSync(diagramPath, svgCompact);

        // Step 4: Generate detailed diagram
        const svgDetailed = generator.generate({ showAttributes: true, showLegend: true, yScale: 2.5 });
        fs.writeFileSync(diagramDetailedPath, svgDetailed);

        res.json({
            success: true,
            message: 'Diagrams regenerated successfully',
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
