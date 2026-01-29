/**
 * Layout Editor Router
 * Routes: /layout-editor, /api/layout-editor/*
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getSchema } = require('../config/database');

/**
 * Transform schema format to model format expected by Layout-Editor.
 * Schema: { entities: { Name: { columns, foreignKeys, ... } } }
 * Model:  { classes: { Name: { description, attributes: [...] } } }
 */
function schemaToModel(schema) {
    const classes = {};

    for (const [name, entity] of Object.entries(schema.entities)) {
        classes[name] = {
            description: entity.description || '',
            area: entity.area,
            attributes: entity.columns.map(col => ({
                name: col.displayName || col.name,
                type: col.foreignKey ? col.foreignKey.entity : col.type,
                description: col.description || ''
            }))
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
        res.sendFile(path.join(appDir, 'static', 'rap', 'diagram', 'layout-editor.html'));
    });

    // API: List available data model documents
    router.get('/api/layout-editor/documents', (req, res) => {
        try {
            const docsDir = cfg.paths.docs;
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
    router.get('/api/layout-editor/load', (req, res) => {
        try {
            let docName = req.query.doc || 'DataModel';
            docName = path.basename(docName).replace(/\.md$/i, '');

            const docsDir = cfg.paths.docs;
            const layoutPath = path.join(docsDir, `${docName}-layout.json`);

            // Get model from cached schema (single source of truth)
            const schema = getSchema();
            const model = schemaToModel(schema);

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

            // Generate Entity Cards PDF and DOCX if model is provided
            const model = req.body.model;
            if (model && model.classes) {
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

    return router;
};
