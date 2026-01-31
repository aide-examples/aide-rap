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

const backend = require('./server');
const cookieParser = require('cookie-parser');

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
program.option('--noauth', 'Disable authentication (for development)');
program.parse();

const opts = program.opts();

// Validate and setup system paths
const systemName = path.basename(opts.system);
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
    media: path.join(SYSTEM_DIR, 'data', 'media'),
    logs: path.join(SYSTEM_DIR, 'logs'),
    help: path.join(SYSTEM_DIR, 'help'),
    database: 'rap.sqlite'
};

// Apply common args (log level, config loading, icon generation)
const cfg = args.applyCommonArgs(opts, {
    configDefaults: DEFAULT_CONFIG,
    configSearchPaths: [path.join(SYSTEM_DIR, 'config.json')],
    appDir: APP_DIR,
    systemDir: SYSTEM_DIR,
});

// Override paths from config if specified
if (cfg.paths) {
    if (cfg.paths.docs) systemPaths.docs = path.isAbsolute(cfg.paths.docs) ? cfg.paths.docs : path.join(SYSTEM_DIR, cfg.paths.docs);
    if (cfg.paths.data) systemPaths.data = path.isAbsolute(cfg.paths.data) ? cfg.paths.data : path.join(SYSTEM_DIR, cfg.paths.data);
    if (cfg.paths.seed) systemPaths.seed = path.isAbsolute(cfg.paths.seed) ? cfg.paths.seed : path.join(SYSTEM_DIR, cfg.paths.seed);
    if (cfg.paths.logs) systemPaths.logs = path.isAbsolute(cfg.paths.logs) ? cfg.paths.logs : path.join(SYSTEM_DIR, cfg.paths.logs);
    if (cfg.paths.help) systemPaths.help = path.isAbsolute(cfg.paths.help) ? cfg.paths.help : path.join(SYSTEM_DIR, cfg.paths.help);
    if (cfg.paths.media) systemPaths.media = path.isAbsolute(cfg.paths.media) ? cfg.paths.media : path.join(SYSTEM_DIR, cfg.paths.media);
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
        titleHtml: cfg.titleHtml || null,
        pwa: cfg.pwa && cfg.pwa.enabled ? cfg.pwa : null,
        docsEditable: cfg.docsEditable,
        helpEditable: cfg.helpEditable,
        viewerHooks: '/static/rap/viewer-hooks.js',
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
// 7a. AUTHENTICATION
// =============================================================================

// Cookie parser for session cookies (required for auth)
const sessionSecret = cfg.auth?.sessionSecret || 'aide-rap-default-secret';
app.use(cookieParser(sessionSecret));

// Auth router (login, logout, session check)
app.use(require('./server/routers/auth.router')(cfg));

// Auth middleware - only active when auth is enabled (and --noauth not set)
const { authMiddleware, requireRole } = require('./server/middleware');
const authEnabled = cfg.auth?.enabled === true && !opts.noauth;

if (opts.noauth) {
    console.log('Authentication disabled via --noauth flag');
    cfg.noauth = true;  // Pass to auth router
}

// Conditional auth middleware factory
function protectRoute(...roles) {
    if (!authEnabled) {
        return (req, res, next) => next(); // No-op if auth disabled
    }
    return [authMiddleware, requireRole(...roles)];
}

// =============================================================================
// 7b. CONFIG API (pagination settings)
// =============================================================================

app.get('/api/config/pagination', (req, res) => {
    res.json(cfg.pagination || { threshold: 500, pageSize: 200 });
});

// =============================================================================
// 7c. BACKEND INITIALIZATION (CRUD API)
// =============================================================================

const UISpecLoader = require('./server/utils/UISpecLoader');
const mdCrud = UISpecLoader.loadCrudConfig(cfg.paths.docs);
const mdViews = UISpecLoader.loadViewsConfig(cfg.paths.docs);

// Extract entities, prefilters, requiredFilters, and tableOptions from CRUD config
const crudConfig = mdCrud || { entities: [], prefilters: {}, requiredFilters: {}, tableOptions: {} };
const enabledEntitiesRaw = crudConfig.entities || [];
const entityPrefilters = crudConfig.prefilters || {};
const requiredFilters = crudConfig.requiredFilters || {};
const entityTableOptions = crudConfig.tableOptions || {};

if (enabledEntitiesRaw.length > 0) {
    // Filter out area separator comments (entries starting with 20 dashes)
    const enabledEntities = enabledEntitiesRaw.filter(e => !e.startsWith('--------------------'));

    // Protect CRUD routes based on HTTP method
    if (authEnabled) {
        // All authenticated users (guest, user, admin) can READ data
        app.use('/api/entities', authMiddleware, requireRole('guest', 'user', 'admin'));

        // Only user/admin can CREATE, UPDATE, DELETE (but allow export routes for all)
        app.use('/api/entities', (req, res, next) => {
            if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
                // Allow export routes for all authenticated users (they use POST but are read-only)
                const isExportRoute = req.path.includes('/export-pdf') ||
                                      req.path.includes('/export-tree-pdf') ||
                                      req.path.includes('/export-csv') ||
                                      req.path.includes('/export-docx') ||
                                      req.path.includes('/export-tree-docx');
                if (!isExportRoute && (!req.user || !['user', 'admin'].includes(req.user.role))) {
                    return res.status(403).json({ error: 'Write access denied for guests' });
                }
            }
            next();
        });
    }

    backend.init(app, {
        appDir: APP_DIR,
        enabledEntities,
        entityPrefilters,
        requiredFilters,
        entityTableOptions,
        paths: cfg.paths,
        viewsConfig: mdViews || []
    });
}

// =============================================================================
// 7c. STATIC ROUTES
// =============================================================================

// System-specific icons (e.g., for custom titleHtml)
app.use('/icons', require('express').static(path.join(SYSTEM_DIR, 'icons')));

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(APP_DIR, 'static', 'rap', 'rap.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/');
});

// =============================================================================
// 7d. ROUTERS
// =============================================================================

// Import EntityCards generators for layout-editor
const { generateEntityCardsPDF, generateEntityCardsDocx } = require('./server/routers/export.router');

// Layout Editor Router
app.use(require('./server/routers/layout-editor.router')(cfg, {
    appDir: APP_DIR,
    generateEntityCardsPDF,
    generateEntityCardsDocx
}));

// Seed Data Management Router (admin only)
if (authEnabled) {
    app.use('/api/seed', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/seed.router')(cfg));

// Prompt Builder Router (instruction + prompt routes)
// Note: /api/seed/* routes are already protected by seed middleware above
if (authEnabled) {
    app.use('/api/entity', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/prompt.router')(cfg));

// User Views Router (read-only for all authenticated users)
if (authEnabled) {
    app.use('/api/views', authMiddleware, requireRole('guest', 'user', 'admin'));
}
app.use(require('./server/routers/UserViewRouter')());

// Export Router (PDF, CSV) - routes are under /api/entities, protection handled there
app.use(require('./server/routers/export.router')(cfg));

// Model Builder Router (create new systems) - admin only
if (authEnabled) {
    app.use('/api/model-builder', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/model-builder.router')(cfg));

// Schema Router (check changes, reload schema) - admin only
if (authEnabled) {
    app.use('/api/schema', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/schema.router')(cfg));

// =============================================================================
// 8. START SERVER
// =============================================================================

server.run();
