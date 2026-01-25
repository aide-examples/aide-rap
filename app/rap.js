#!/usr/bin/env node
/**
 * AIDE RAP - Rapid Application Prototyping
 */

const path = require('path');
const fs = require('fs');

// =============================================================================
// 1. PATH SETUP
// =============================================================================

const APP_DIR = __dirname;
const PROJECT_DIR = path.dirname(APP_DIR);
const TOOLS_DIR = path.join(PROJECT_DIR, 'tools');
const SYSTEMS_DIR = path.join(APP_DIR, 'systems');

// =============================================================================
// 2. AIDE-FRAME INIT
// =============================================================================

const aideFrame = require(path.join(PROJECT_DIR, 'aide-frame', 'js', 'aide_frame'));
const { paths, args, HttpServer } = aideFrame;

paths.init(APP_DIR);

// =============================================================================
// 3. APP IMPORTS
// =============================================================================

const parseDatamodel = require(path.join(TOOLS_DIR, 'parse-datamodel'));
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

program.description('AIDE RAP - Rapid Application Prototyping');
args.addCommonArgs(program);  // Adds --log-level, --config, --regenerate-icons
program.requiredOption('-s, --system <name>', 'System name (required, subdirectory in systems/)');
program.option('-p, --port <number>', 'Override port', parseInt);
program.parse();

const opts = program.opts();

// Validate and setup system paths
const systemName = opts.system;
const SYSTEM_DIR = path.join(SYSTEMS_DIR, systemName);

if (!fs.existsSync(SYSTEM_DIR)) {
    console.error(`Error: System directory not found: ${SYSTEM_DIR}`);
    console.error(`Available systems:`);
    if (fs.existsSync(SYSTEMS_DIR)) {
        const systems = fs.readdirSync(SYSTEMS_DIR).filter(f => {
            const stat = fs.statSync(path.join(SYSTEMS_DIR, f));
            return stat.isDirectory();
        });
        systems.forEach(s => console.error(`  - ${s}`));
    } else {
        console.error(`  (systems directory does not exist: ${SYSTEMS_DIR})`);
    }
    process.exit(1);
}

// System-specific paths (can be overridden in config)
const systemPaths = {
    docs: path.join(SYSTEM_DIR, 'docs', 'requirements'),
    data: path.join(SYSTEM_DIR, 'data'),
    seed: path.join(SYSTEM_DIR, 'data', 'seed'),
    logs: path.join(SYSTEM_DIR, 'logs'),
    help: path.join(SYSTEM_DIR, 'help'),
    database: 'rap.sqlite'
};

// Apply common args (log level, config loading, icon generation)
const cfg = args.applyCommonArgs(opts, {
    configDefaults: DEFAULT_CONFIG,
    configSearchPaths: [path.join(SYSTEM_DIR, 'config.json')],
    appDir: APP_DIR,
});

// Override paths from config if specified
if (cfg.paths) {
    if (cfg.paths.docs) systemPaths.docs = path.isAbsolute(cfg.paths.docs) ? cfg.paths.docs : path.join(SYSTEM_DIR, cfg.paths.docs);
    if (cfg.paths.data) systemPaths.data = path.isAbsolute(cfg.paths.data) ? cfg.paths.data : path.join(SYSTEM_DIR, cfg.paths.data);
    if (cfg.paths.seed) systemPaths.seed = path.isAbsolute(cfg.paths.seed) ? cfg.paths.seed : path.join(SYSTEM_DIR, cfg.paths.seed);
    if (cfg.paths.logs) systemPaths.logs = path.isAbsolute(cfg.paths.logs) ? cfg.paths.logs : path.join(SYSTEM_DIR, cfg.paths.logs);
    if (cfg.paths.help) systemPaths.help = path.isAbsolute(cfg.paths.help) ? cfg.paths.help : path.join(SYSTEM_DIR, cfg.paths.help);
    if (cfg.paths.database) systemPaths.database = cfg.paths.database;
}

// Store in config for passing to other modules
cfg.systemName = systemName;
cfg.systemDir = SYSTEM_DIR;
cfg.paths = systemPaths;

if (opts.port) {
    cfg.port = opts.port;
}

// Initialize logger with system-specific logs directory
const logger = require('./server/utils/logger');
logger.init(cfg.paths.logs);

console.log(`Starting AIDE RAP - System: ${systemName}`);

// =============================================================================
// 6. SERVER SETUP
// =============================================================================

// Register system-specific paths with aide-frame BEFORE HttpServer
// This prevents auto-registration from using default app/docs and app/help paths
paths.register('DOCS_DIR', path.join(cfg.paths.docs, '..'));  // docs/ not requirements/
paths.register('HELP_DIR', cfg.paths.help);
paths.register('RAP_DOCS_DIR', path.join(APP_DIR, 'docs'));   // Generic RAP platform docs

const server = new HttpServer({
    port: cfg.port,
    appDir: APP_DIR,
    docsConfig: {
        appName: `AIDE RAP [${systemName}]`,
        pwa: cfg.pwa && cfg.pwa.enabled ? cfg.pwa : null,
        docsEditable: cfg.docsEditable,
        helpEditable: cfg.helpEditable,
        // Point docs to system-specific directory
        docsDir: cfg.paths.docs,
        // Add RAP platform docs as separate root
        customRoots: {
            'rap': {
                title: 'RAP Platform',
                route: '/rap',
                dirKey: 'RAP_DOCS_DIR',
                editable: false
            }
        }
    },
    updateConfig: {
        githubRepo: 'aide-examples/aide-rap',
        serviceName: 'aide-rap',
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
        appDir: APP_DIR,
        enabledEntities,
        paths: cfg.paths
    });
}

// =============================================================================
// 7b. STATIC ROUTES
// =============================================================================

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(APP_DIR, 'static', 'rap', 'rap.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/');
});

// =============================================================================
// 7c. ROUTERS
// =============================================================================

// Import generateEntityCardsPDF for layout-editor
const { generateEntityCardsPDF } = require('./server/routers/export.router');

// Layout Editor Router
app.use(require('./server/routers/layout-editor.router')(cfg, {
    appDir: APP_DIR,
    parseDatamodel,
    generateEntityCardsPDF
}));

// Seed Data Management Router
app.use(require('./server/routers/seed.router')(cfg));

// LLM Seed Generator Router
app.use(require('./server/routers/generator.router')(cfg));

// Export Router (PDF, CSV)
app.use(require('./server/routers/export.router')(cfg));

// Model Builder Router (create new systems)
app.use(require('./server/routers/model-builder.router')(cfg));

// =============================================================================
// 8. START SERVER
// =============================================================================

server.run();
