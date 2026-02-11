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
args.addCommonArgs(program);  // Adds --log-level, --config, --regenerate-icons, --port
program.requiredOption('-s, --system <name>', 'System name (required, subdirectory in systems/)');
program.option('--noauth', 'Disable authentication (for development)');
program.option('--import [entity]', 'Run import in batch mode (entity name or "all")');
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
    docs: path.join(SYSTEM_DIR, 'docs'),
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

// Initialize logger with system-specific logs directory
const logger = require('./server/utils/logger');
logger.init(cfg.paths.logs);

// =============================================================================
// 5a. IMPORT BATCH MODE (--import)
// =============================================================================

if (opts.import) {
    const ImportCLI = require('./server/utils/ImportCLI');
    const importCLI = new ImportCLI(cfg, logger);

    const entity = opts.import === true ? 'all' : opts.import;
    console.log(`AIDE RAP - Import Batch Mode (${systemName})`);

    importCLI.run(entity).then(results => {
        process.exit(results.failed > 0 ? 1 : 0);
    }).catch(err => {
        logger.error('Import batch failed', { error: err.message });
        process.exit(1);
    });

    // Don't continue to server setup
    return;
}

console.log(`Starting AIDE RAP - System: ${systemName}`);

// =============================================================================
// 6. SERVER SETUP
// =============================================================================

// Register system-specific paths with aide-frame BEFORE HttpServer
// This prevents auto-registration from using default app/docs and app/help paths
paths.register('DOCS_DIR', cfg.paths.docs);
paths.register('HELP_DIR', cfg.paths.help);
paths.register('RAP_DOCS_DIR', path.join(APP_DIR, 'docs'));   // Generic RAP platform docs

const server = new HttpServer({
    port: cfg.port,
    basePath: cfg.basePath || '',
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
        // views/ has subdirectories (areas) that should stay nested, not become top-level sections
        docsShallow: ['views'],
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

// API key authentication (for external workflow tools like HCL Leap, Power Automate)
// Must be registered BEFORE session auth so API key requests skip cookie checks
const { apiKeyAuth, checkEntityScope } = require('./server/middleware/apiKeyAuth');
app.use('/api', apiKeyAuth(cfg.apiKeys));

// CORS preflight handler for API-key-authenticated origins
app.options('/api/*', (req, res) => {
    if (res.getHeader('Access-Control-Allow-Origin')) {
        return res.status(204).end();
    }
    res.status(204).end();
});

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

app.get('/api/config/tree', (req, res) => {
    res.json(cfg.tree || { backRefPreviewLimit: 10 });
});

// Bridge filter: resolve indirect FK filtering via computed PAIRS entities
// Example: /api/config/bridge-filter?entity=Aircraft&target=EngineType&id=5
app.get('/api/config/bridge-filter', (req, res) => {
    const { entity: entityName, target: targetEntity, id: targetId } = req.query;
    if (!entityName || !targetEntity || !targetId) {
        return res.json({ filter: null });
    }

    try {
        const { getDatabase } = require('./server/config/database');
        const schema = getSchema();
        const db = getDatabase();
        const entity = schema.entities[entityName];
        if (!entity) return res.json({ filter: null });

        // For each FK on the entity, check if a bridge entity connects
        // the FK target to the requested target entity
        for (const col of entity.columns) {
            if (!col.foreignKey) continue;
            const intermediateEntity = col.foreignKey.entity;

            // Look for a computed bridge entity with FKs to both intermediate and target
            for (const bridgeEntity of Object.values(schema.entities)) {
                if (!bridgeEntity.computed) continue;
                const fkToIntermediate = bridgeEntity.columns.find(c =>
                    c.foreignKey?.entity === intermediateEntity
                );
                const fkToTarget = bridgeEntity.columns.find(c =>
                    c.foreignKey?.entity === targetEntity
                );
                if (!fkToIntermediate || !fkToTarget) continue;

                // Found bridge! Query matching intermediate IDs
                const sql = `SELECT DISTINCT ${fkToIntermediate.name} FROM ${bridgeEntity.tableName} WHERE ${fkToTarget.name} = ?`;
                const rows = db.prepare(sql).all(parseInt(targetId, 10));
                const ids = rows.map(r => r[fkToIntermediate.name]);

                if (ids.length > 0) {
                    return res.json({
                        filter: `${col.name}:${ids.join(',')}`,
                        bridgeEntity: bridgeEntity.className,
                        matchCount: ids.length
                    });
                }
                return res.json({ filter: null, bridgeEntity: bridgeEntity.className, matchCount: 0 });
            }
        }

        res.json({ filter: null });
    } catch (e) {
        console.error('Bridge filter error:', e);
        res.json({ filter: null });
    }
});

// Welcome screen content (system-specific, markdown preferred, HTML fallback)
app.get('/api/config/welcome', (req, res) => {
    const mdPath = path.join(cfg.paths.docs, 'welcome.md');
    const htmlPath = path.join(cfg.paths.docs, 'welcome.html');
    if (fs.existsSync(mdPath)) {
        res.json({ markdown: fs.readFileSync(mdPath, 'utf-8') });
    } else if (fs.existsSync(htmlPath)) {
        res.json({ html: fs.readFileSync(htmlPath, 'utf-8') });
    } else {
        res.json({ html: '' });
    }
});

// =============================================================================
// 7c. BACKEND INITIALIZATION (CRUD API)
// =============================================================================

const UISpecLoader = require('./server/utils/UISpecLoader');
const { getSchema, getMetaVersion } = require('./server/config/database');
const mdCrud = UISpecLoader.loadCrudConfig(cfg.paths.docs);
const mdViews = UISpecLoader.loadViewsConfig(cfg.paths.docs);
const mdProcesses = UISpecLoader.loadProcessesConfig(cfg.paths.docs);
const processesDocsDir = cfg.paths.docs;

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

    // Admin routes (SQL browser, reload-views) - admin only
    if (authEnabled) {
        app.use('/api/admin', authMiddleware, requireRole('admin'));
    }

    backend.init(app, {
        appDir: APP_DIR,
        enabledEntities,
        entityPrefilters,
        requiredFilters,
        entityTableOptions,
        paths: cfg.paths,
        viewsConfig: mdViews || [],
        systemConfig: cfg
    });

    // Integration API (for external workflow tools)
    // Supports both API key auth and session auth (for testing from UI)
    if (authEnabled) {
        app.use('/api/integrate', (req, res, next) => {
            // If already authenticated via API key, skip session auth
            if (req.user) return next();
            authMiddleware(req, res, (err) => {
                if (err) return next(err);
                requireRole('user', 'admin')(req, res, next);
            });
        });
    }
    app.use('/api/integrate/:entity', checkEntityScope);
    app.use('/api/integrate', require('./server/routers/IntegrationRouter'));
}

// =============================================================================
// 7d. CONSOLIDATED META ENDPOINT
// =============================================================================

const GenericService = require('./server/services/GenericService');
const { buildViewSummary, buildViewSchema } = require('./server/routers/UserViewRouter');
const { buildProcessData } = require('./server/routers/ProcessRouter');
const ImportManager = require('./server/utils/ImportManager');
const metaImportManager = new ImportManager(SYSTEM_DIR, require('./server/utils/logger'));

app.get('/api/meta/version', (req, res) => {
    res.json({ metaVersion: getMetaVersion() });
});

app.get('/api/meta', (req, res) => {
    try {
        const schema = getSchema();

        // Entity list with counts and areas
        const { entities, areas } = GenericService.getEnabledEntitiesWithAreas();

        // All extended schemas
        const schemas = {};
        for (const e of entities) {
            if (e.name) {
                try { schemas[e.name] = GenericService.getExtendedSchema(e.name); } catch {}
            }
        }
        // System entities (AuditTrail etc.) register their schemas via SystemEntityRegistry
        const systemSchemas = require('./server/utils/SystemEntityRegistry').getAll();
        Object.assign(schemas, systemSchemas);

        // Enrich apiRefresh: string array → object array with mode/label from definitions
        for (const [entityName, extSchema] of Object.entries(schemas)) {
            if (extSchema.apiRefresh && Array.isArray(extSchema.apiRefresh)) {
                extSchema.apiRefresh = extSchema.apiRefresh.map(name => {
                    const def = metaImportManager.parseRefreshDefinition(entityName, name);
                    return {
                        name,
                        mode: def?.mode || 'bulk',
                        label: def?.label || `Refresh ${name}`
                    };
                });
            }
        }

        // Views: list, groups, and all view schemas
        const userViews = schema.userViews || [];
        const viewGroups = schema.userViewGroups || [];
        const viewSchemas = {};
        for (const v of userViews) {
            viewSchemas[v.name] = buildViewSchema(v);
        }

        // Processes: list and groups
        const processesConfig = UISpecLoader.loadProcessesConfig(cfg.paths.docs);
        const { processes: processList, groups: processGroups } = buildProcessData(processesConfig, schema);

        res.json({
            metaVersion: getMetaVersion(),
            entities,
            areas,
            schemas,
            views: {
                views: userViews.map(buildViewSummary),
                groups: viewGroups,
                schemas: viewSchemas
            },
            externalQueries: cfg.externalQueries || {},
            workflows: cfg.workflows || {},
            processes: {
                processes: processList.map(p => ({
                    name: p.name,
                    color: processGroups.find(g => g.type === 'separator' && g.label === p.group)?.color || '#f5f5f5',
                    group: p.group,
                    stepCount: p.steps.length,
                    required: p.required || null,
                    workflow: p.workflow || null,
                    description: p.description || ''
                })),
                groups: processGroups
            }
        });
    } catch (err) {
        console.error('Failed to build meta response:', err);
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// 7e. STATIC ROUTES
// =============================================================================

// SQL Browser — embedded sqlite-viewer (static files, no auth needed for files,
// the /api/admin/db-file endpoint is protected above)
app.use('/sql-browser', require('express').static(path.join(APP_DIR, 'static', 'rap', 'sql-browser')));

// Favicon — inline SVG with primary area color
app.get('/favicon.ico', (req, res) => {
    let color = '#3b82f6';
    try {
        const schema = getSchema();
        const firstArea = Object.values(schema.areas || {})[0];
        if (firstArea?.color) color = firstArea.color;
    } catch (_) { /* schema not yet loaded */ }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${color}"/><text x="16" y="23" font-size="20" font-weight="700" fill="white" text-anchor="middle" font-family="system-ui,sans-serif">R</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
});

// System-specific icons (e.g., for custom titleHtml)
app.use('/icons', require('express').static(path.join(SYSTEM_DIR, 'icons')));

// Main page
app.get('/', (req, res) => {
    const htmlPath = path.join(APP_DIR, 'static', 'rap', 'rap.html');
    if (cfg.basePath) {
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html.replace('<head>', `<head>\n    <base href="${cfg.basePath}/">`);
        res.type('html').send(html);
    } else {
        res.sendFile(htmlPath);
    }
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

// XLSX Import Router (admin only)
if (authEnabled) {
    app.use('/api/import', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/import.router')(cfg));

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

// Process Router (GET for all, PUT/POST admin-only)
if (authEnabled) {
    app.use('/api/processes', authMiddleware, (req, res, next) => {
        if (req.method === 'GET') {
            return requireRole('guest', 'user', 'admin')(req, res, next);
        }
        return requireRole('admin')(req, res, next);
    });
}
app.use(require('./server/routers/ProcessRouter')(mdProcesses, processesDocsDir));

// Export Router (PDF, CSV) - routes are under /api/entities, protection handled there
app.use(require('./server/routers/export.router')(cfg));

// Model Builder Router (create new systems) - admin only
if (authEnabled) {
    app.use('/api/model-builder', authMiddleware, requireRole('admin'));
}
app.use(require('./server/routers/model-builder.router')(cfg));

// Schema Router (check changes, reload schema)
// Diagram endpoint accessible to all authenticated users; other routes admin-only
if (authEnabled) {
    app.use('/api/schema', authMiddleware, (req, res, next) => {
        // Diagram endpoint is read-only, accessible to all authenticated users
        if (req.path.startsWith('/diagram')) {
            return requireRole('guest', 'user', 'admin')(req, res, next);
        }
        // Other schema routes (reload, check-changes) are admin-only
        return requireRole('admin')(req, res, next);
    });
}
app.use(require('./server/routers/schema.router')(cfg));

// =============================================================================
// 8. START SERVER
// =============================================================================

server.run();
