/**
 * Layout Editor Router
 * Routes: /layout-editor, /api/layout-editor/*
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getSchema } = require('../config/database');
const { filterColumnsForDiagram } = require('../utils/DiagramUtils');
const { parseSystemLandscape, systemsToModel } = require('../utils/SystemDiagramParser');

/**
 * Transform schema format to model format expected by Layout-Editor.
 * Schema: { entities: { Name: { columns, foreignKeys, ... } } }
 * Model:  { classes: { Name: { description, attributes: [...] } } }
 */
function schemaToModel(schema) {
    const classes = {};

    for (const [name, entity] of Object.entries(schema.entities)) {
        const { regularColumns, aggregates } = filterColumnsForDiagram(entity.columns);

        // Build attributes list
        const attributes = regularColumns.map(col => ({
            name: col.displayName || col.name,
            type: col.foreignKey ? col.foreignKey.entity : col.type,
            description: col.description || '',
            optional: col.optional || false,
            ui: col.ui || {}
        }));

        // Add collapsed aggregate entries
        for (const [source, type] of aggregates) {
            attributes.push({
                name: source,
                type: type,
                description: '',
                optional: true,
                ui: {}
            });
        }

        classes[name] = {
            description: entity.description || '',
            area: entity.area,
            attributes,
            types: entity.localTypes || {}
        };
    }

    return {
        areas: schema.areas,
        classes,
        relationships: schema.relationships || [],
        globalTypes: schema.globalTypes || {}
    };
}

module.exports = function(cfg, options = {}) {
    const router = express.Router();
    const { appDir, generateEntityCardsPDF, generateEntityCardsDocx } = options;

    // Layout Editor page
    router.get('/layout-editor', (req, res) => {
        const htmlPath = path.join(appDir, 'static', 'rap', 'diagram', 'layout-editor.html');
        if (cfg.basePath) {
            let html = fs.readFileSync(htmlPath, 'utf8');
            html = html.replace('<head>', `<head>\n    <base href="${cfg.basePath}/">`);
            res.type('html').send(html);
        } else {
            res.sendFile(htmlPath);
        }
    });

    // API: List available data model documents
    router.get('/api/layout-editor/documents', (req, res) => {
        try {
            const docsDir = cfg.paths.docs;
            const files = fs.readdirSync(docsDir);

            // Find .md files that contain diagram markers
            const docs = [];
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
                    if (content.includes('## Entity Descriptions') || content.includes('## Class Diagram') ||
                        content.includes('## System Diagram')) {
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
    router.get('/api/layout-editor/load', (req, res) => {
        try {
            let docName = req.query.doc || 'DataModel';
            docName = path.basename(docName).replace(/\.md$/i, '');

            const docsDir = cfg.paths.docs;
            const layoutPath = path.join(docsDir, `${docName}-layout.json`);

            // Detect document type and build model accordingly
            let model;
            const mdPath = path.join(docsDir, `${docName}.md`);
            if (fs.existsSync(mdPath) && fs.readFileSync(mdPath, 'utf-8').includes('## System Diagram')) {
                const systemsDir = path.join(docsDir, 'systems');
                const parsed = parseSystemLandscape(mdPath, systemsDir);
                model = systemsToModel(parsed);
            } else {
                const schema = getSchema();
                model = schemaToModel(schema);
            }

            // Load or create layout
            let layout = { classes: {}, canvas: { width: 1200, height: 900 } };
            if (fs.existsSync(layoutPath)) {
                const loaded = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
                layout = { ...layout, ...loaded };
                if (!layout.classes) layout.classes = {};
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
    router.post('/api/layout-editor/save', async (req, res) => {
        try {
            let docName = req.body.doc;
            if (!docName) {
                return res.status(400).json({ success: false, error: 'Missing doc parameter' });
            }

            docName = path.basename(docName).replace(/\.md$/i, '');
            const docsDir = cfg.paths.docs;
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

            // Generate Entity Cards PDF and DOCX (only for data model, not systems)
            const model = req.body.model;
            if (model && model.classes && model.docType !== 'systems') {
                if (generateEntityCardsPDF) {
                    const pdfPath = path.join(docsDir, 'EntityCards.pdf');
                    await generateEntityCardsPDF(model, pdfPath);
                }
                if (generateEntityCardsDocx) {
                    const classesDir = path.join(docsDir, 'classes');
                    const docxPath = path.join(docsDir, 'EntityCards.docx');
                    await generateEntityCardsDocx(model, classesDir, docxPath);
                }
            }

            res.json({ success: true });
        } catch (e) {
            console.error('Failed to save layout:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // API: Incoming flows for a system (computed from all other systems' outgoing flows)
    router.get('/api/layout-editor/incoming-flows', (req, res) => {
        try {
            const systemName = req.query.system;
            if (!systemName) {
                return res.status(400).json({ error: 'Missing system parameter' });
            }

            const docsDir = cfg.paths.docs;
            const systemsDir = path.join(docsDir, 'systems');

            // Find the landscape file to get context
            const landscapePath = path.join(docsDir, 'SystemLandscape.md');
            if (!fs.existsSync(landscapePath) || !fs.existsSync(systemsDir)) {
                return res.json({ system: systemName, incoming: [] });
            }

            const parsed = parseSystemLandscape(landscapePath, systemsDir);
            const model = systemsToModel(parsed);
            const classDef = model.classes[systemName];

            if (!classDef) {
                return res.json({ system: systemName, incoming: [] });
            }

            const incoming = classDef.incomingFlows || [];

            // Return as HTML or JSON based on Accept header
            if (req.accepts('html')) {
                let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; margin: 8px; color: #333; }
  h3 { margin: 0 0 8px; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  .empty { color: #888; font-style: italic; }
</style></head><body>`;

                html += `<h3>Incoming Flows for ${systemName}</h3>`;

                if (incoming.length === 0) {
                    html += '<p class="empty">No incoming flows from other systems.</p>';
                } else {
                    html += '<table><tr><th>From</th><th>Flow</th><th>Trigger</th><th>Format</th><th>Transport</th></tr>';
                    for (const flow of incoming) {
                        html += `<tr><td>${flow.from}</td><td>${flow.flow}</td><td>${flow.trigger}</td><td>${flow.format}</td><td>${flow.transport}</td></tr>`;
                    }
                    html += '</table>';
                }

                html += '</body></html>';
                res.type('html').send(html);
            } else {
                res.json({ system: systemName, incoming });
            }
        } catch (e) {
            console.error('Failed to compute incoming flows:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
