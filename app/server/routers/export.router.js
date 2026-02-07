/**
 * Export Router (PDF, CSV, DOCX, XLSX)
 * Routes: /api/entities/:entity/export-pdf, export-tree-pdf, export-csv, export-docx, export-xlsx
 * Emits: export:start, export:complete, export:error
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const PrintService = require('../services/PrintService');
const CsvService = require('../services/CsvService');
const XlsxService = require('../services/XlsxService');
const eventBus = require('../utils/EventBus');

/**
 * Generate Entity Cards PDF for printing and cutting out.
 * Each card shows entity name (large) and attributes with FK indicators.
 * Single column layout with variable width based on content.
 */
async function generateEntityCardsPDF(model, outputPath) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 60, right: 40 }  // Extra left margin for FK dashes
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Card dimensions
    const CARD_MARGIN = 25;
    const HEADER_PADDING = 8;
    const ATTR_LINE_HEIGHT = 14;
    const BOTTOM_SPACE = 40;  // Space for handwritten notes
    const NAME_FONT_SIZE = 24;
    const ATTR_FONT_SIZE = 11;
    const FK_DASH_LENGTH = 12;
    const FK_DASH_OFFSET = 5;
    const MIN_CARD_WIDTH = 120;
    const CARD_PADDING = 15;

    // Page dimensions
    const pageHeight = doc.page.height - 80;
    const startX = 60;  // Left margin with space for FK dashes

    // Get area color for a class
    function getColor(className) {
        const classDef = model.classes[className] || {};
        const area = classDef.area || '';
        const areaDef = model.areas[area] || {};
        return areaDef.color || '#E8E8E8';
    }

    // Check if attribute is a FK (references another entity)
    function isFK(attr) {
        if (!attr.type) return false;
        const baseType = attr.type.replace(/\[\]$/, '').replace(/\?$/, '');
        return Object.keys(model.classes).includes(baseType);
    }

    // Check if attribute is tagged as LABEL (from schema ui flags)
    function isLabel(attr) {
        return attr.ui?.label || attr.ui?.label2;
    }

    // Calculate card width based on content
    function calculateCardWidth(className, classDef) {
        // Measure entity name width
        doc.fontSize(NAME_FONT_SIZE).font('Helvetica-Bold');
        let maxWidth = doc.widthOfString(className);

        // Measure attribute widths (FK attributes are bold)
        const attrs = classDef.attributes || [];
        for (const attr of attrs) {
            const isForeignKey = isFK(attr);
            doc.fontSize(ATTR_FONT_SIZE).font(isForeignKey ? 'Helvetica-Bold' : 'Helvetica');
            const attrWidth = doc.widthOfString(attr.name);
            if (attrWidth > maxWidth) {
                maxWidth = attrWidth;
            }
        }

        // Add padding
        return Math.max(MIN_CARD_WIDTH, maxWidth + CARD_PADDING * 2);
    }

    // Calculate card height
    function calculateCardHeight(classDef) {
        const attrCount = classDef.attributes ? classDef.attributes.length : 0;
        const headerHeight = NAME_FONT_SIZE + HEADER_PADDING * 2;
        return headerHeight + attrCount * ATTR_LINE_HEIGHT + BOTTOM_SPACE;
    }

    // Draw a single entity card
    function drawCard(className, classDef, x, y, cardWidth, cardHeight) {
        const color = getColor(className);
        const headerHeight = NAME_FONT_SIZE + HEADER_PADDING * 2;

        // Card border (draw after fill to ensure border is visible)
        doc.rect(x, y, cardWidth, cardHeight)
           .lineWidth(1.5)
           .stroke('#333');

        // Header background (colored)
        doc.rect(x + 0.75, y + 0.75, cardWidth - 1.5, headerHeight - 0.75)
           .fill(color);

        // Header border bottom
        doc.moveTo(x, y + headerHeight)
           .lineTo(x + cardWidth, y + headerHeight)
           .lineWidth(1)
           .stroke('#333');

        // Entity name (centered, large font)
        doc.fillColor('#000')
           .fontSize(NAME_FONT_SIZE)
           .font('Helvetica-Bold');

        const nameWidth = doc.widthOfString(className);
        const nameX = x + (cardWidth - nameWidth) / 2;
        const nameY = y + HEADER_PADDING;

        doc.text(className, nameX, nameY, { lineBreak: false });

        // Attributes
        let attrY = y + headerHeight + 10;

        const attrs = classDef.attributes || [];
        for (const attr of attrs) {
            const isForeignKey = isFK(attr);
            const isLabelAttr = isLabel(attr);
            const dashY = attrY + ATTR_FONT_SIZE / 2 - 1;

            // FK indicator: horizontal dash outside the box (left AND right)
            if (isForeignKey) {
                // Left dash
                doc.moveTo(x - FK_DASH_OFFSET - FK_DASH_LENGTH, dashY)
                   .lineTo(x - FK_DASH_OFFSET, dashY)
                   .lineWidth(1.5)
                   .stroke('#333');
                // Right dash
                doc.moveTo(x + cardWidth + FK_DASH_OFFSET, dashY)
                   .lineTo(x + cardWidth + FK_DASH_OFFSET + FK_DASH_LENGTH, dashY)
                   .lineWidth(1.5)
                   .stroke('#333');
            }

            // Attribute name (FK = bold, LABEL = red)
            doc.fontSize(ATTR_FONT_SIZE)
               .font(isForeignKey ? 'Helvetica-Bold' : 'Helvetica')
               .fillColor(isLabelAttr ? '#CC0000' : '#333')
               .text(attr.name, x + CARD_PADDING, attrY, { lineBreak: false });

            attrY += ATTR_LINE_HEIGHT;
        }

        // Entity description to the right of the card
        if (classDef.description) {
            const descX = x + cardWidth + 25;
            const descY = y + HEADER_PADDING;
            // Calculate available width: page width (595) - right margin (40) - descX
            const availableWidth = 595 - 40 - descX;
            if (availableWidth > 50) {  // Only show if enough space
                doc.fontSize(10)
                   .font('Helvetica-Oblique')
                   .fillColor('#666')
                   .text(classDef.description, descX, descY, {
                       width: availableWidth,
                       lineBreak: true
                   });
            }
        }
    }

    // Single column layout
    let y = 40;
    const classNames = Object.keys(model.classes);

    for (const className of classNames) {
        const classDef = model.classes[className];
        const cardWidth = calculateCardWidth(className, classDef);
        const cardHeight = calculateCardHeight(classDef);

        // Check if card fits on current page
        if (y + cardHeight > pageHeight + 40) {
            doc.addPage();
            y = 40;
        }

        drawCard(className, classDef, startX, y, cardWidth, cardHeight);

        y += cardHeight + CARD_MARGIN;
    }

    doc.end();

    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

/**
 * Extract ## sections from markdown content, skipping internal sections.
 * Returns array of { heading, content } objects.
 */
function extractExtraSections(mdContent) {
    const SKIP_SECTIONS = ['Data Generator', 'Attributes'];
    const sections = [];
    const parts = mdContent.split(/^## /gm);

    // Skip first part (everything before first ## heading)
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const newlineIdx = part.indexOf('\n');
        if (newlineIdx === -1) continue;

        const heading = part.substring(0, newlineIdx).trim();
        if (SKIP_SECTIONS.includes(heading)) continue;

        const content = part.substring(newlineIdx + 1).trim();
        if (content) {
            sections.push({ heading, content });
        }
    }
    return sections;
}

/**
 * Parse markdown table lines into rows of cell values.
 * Filters out separator lines (|---|---|).
 */
function parseMarkdownTableRows(lines) {
    const dataLines = lines.filter(line => !line.match(/^\s*\|[\s\-:|]+\|\s*$/));
    return dataLines.map(line =>
        line.split('|').slice(1, -1).map(cell => cell.trim())
    );
}


/**
 * Generate Entity Cards DOCX — editable entity definitions document.
 * Groups entities by area (DataModel.md order), alphabetically within areas.
 * Skips "Data Generator" sections, includes extra notes sections.
 * Track Changes enabled so customer edits are visible.
 */
async function generateEntityCardsDocx(model, classesDir, outputPath) {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell,
            WidthType, HeadingLevel, TextRun } = require('docx');

    const children = [];

    // Title
    children.push(new Paragraph({
        children: [new TextRun({ text: 'Entity Definitions', bold: true, size: 48 })],
        spacing: { after: 100 }
    }));

    children.push(new Paragraph({
        children: [new TextRun({
            text: `Generated: ${new Date().toLocaleString('de-DE')}`,
            color: '666666', size: 20
        })],
        spacing: { after: 400 }
    }));

    // Group classes by area
    const areaGroups = {};
    for (const [className, classDef] of Object.entries(model.classes)) {
        const areaKey = classDef.area || '_none';
        if (!areaGroups[areaKey]) {
            areaGroups[areaKey] = [];
        }
        areaGroups[areaKey].push({ name: className, def: classDef });
    }

    // Sort entities alphabetically within each area
    for (const group of Object.values(areaGroups)) {
        group.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Process areas in model.areas order
    const areaKeys = Object.keys(model.areas);
    if (areaGroups['_none']) areaKeys.push('_none');

    for (const areaKey of areaKeys) {
        const areaDef = model.areas[areaKey] || { name: 'Other', color: '#E8E8E8' };
        const entities = areaGroups[areaKey];
        if (!entities || entities.length === 0) continue;

        const areaColor = (areaDef.color || '#E8E8E8').replace('#', '');

        // Area heading
        children.push(new Paragraph({
            children: [new TextRun({
                text: areaDef.name || areaKey,
                bold: true, size: 32, color: '333333'
            })],
            heading: HeadingLevel.HEADING_1,
            shading: { fill: areaColor },
            spacing: { before: 400, after: 200 }
        }));

        for (const entity of entities) {
            const className = entity.name;
            const classDef = entity.def;

            // Entity heading
            children.push(new Paragraph({
                children: [new TextRun({ text: className, bold: true, size: 28 })],
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 100 }
            }));

            // Description
            if (classDef.description) {
                children.push(new Paragraph({
                    children: [new TextRun({
                        text: classDef.description,
                        italics: true, color: '555555', size: 22
                    })],
                    spacing: { after: 150 }
                }));
            }

            // Attribute table
            if (classDef.attributes && classDef.attributes.length > 0) {
                const headerRow = new TableRow({
                    children: ['Attribute', 'Type', 'Description'].map(h =>
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: h, bold: true, size: 20 })]
                            })],
                            shading: { fill: areaColor }
                        })
                    ),
                    tableHeader: true
                });

                const dataRows = classDef.attributes.map(attr =>
                    new TableRow({
                        children: [
                            attr.name || '',
                            attr.type || '',
                            attr.description || ''
                        ].map(val => new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: String(val), size: 20 })]
                            })]
                        }))
                    })
                );

                children.push(new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [headerRow, ...dataRows]
                }));
            }

            // Extra sections from raw .md file (skip Data Generator)
            const mdPath = path.join(classesDir, `${className}.md`);
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf8');
                const extraSections = extractExtraSections(mdContent);

                for (const section of extraSections) {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: section.heading, bold: true, size: 24 })],
                        heading: HeadingLevel.HEADING_3,
                        spacing: { before: 150, after: 80 }
                    }));

                    // Render section content: handles ### sub-headings, markdown tables, and text
                    const lines = section.content.split('\n');
                    let li = 0;
                    while (li < lines.length) {
                        const line = lines[li];

                        // Sub-heading (### ...)
                        if (line.startsWith('### ')) {
                            children.push(new Paragraph({
                                children: [new TextRun({ text: line.substring(4).trim(), bold: true, size: 22 })],
                                heading: HeadingLevel.HEADING_4,
                                spacing: { before: 120, after: 60 }
                            }));
                            li++;
                            continue;
                        }

                        // Markdown table (consecutive lines starting with |)
                        if (line.trimStart().startsWith('|')) {
                            const tableLines = [];
                            while (li < lines.length && lines[li].trimStart().startsWith('|')) {
                                tableLines.push(lines[li]);
                                li++;
                            }
                            const rows = parseMarkdownTableRows(tableLines);
                            if (rows.length > 0) {
                                const tableRows = rows.map((cells, rowIdx) =>
                                    new TableRow({
                                        children: cells.map(cell =>
                                            new TableCell({
                                                children: [new Paragraph({
                                                    children: [new TextRun({ text: cell, bold: rowIdx === 0, size: 20 })]
                                                })],
                                                ...(rowIdx === 0 ? { shading: { fill: areaColor } } : {})
                                            })
                                        ),
                                        ...(rowIdx === 0 ? { tableHeader: true } : {})
                                    })
                                );
                                children.push(new Table({
                                    width: { size: 100, type: WidthType.PERCENTAGE },
                                    rows: tableRows
                                }));
                            }
                            continue;
                        }

                        // Empty line — skip
                        if (line.trim() === '') {
                            li++;
                            continue;
                        }

                        // Regular text — collect until empty line or special line
                        const textLines = [];
                        while (li < lines.length &&
                               lines[li].trim() !== '' &&
                               !lines[li].startsWith('### ') &&
                               !lines[li].trimStart().startsWith('|')) {
                            textLines.push(lines[li]);
                            li++;
                        }
                        if (textLines.length > 0) {
                            children.push(new Paragraph({
                                children: [new TextRun({ text: textLines.join(' '), size: 20 })],
                                spacing: { after: 80 }
                            }));
                        }
                    }
                }
            }

            // Spacer between entities
            children.push(new Paragraph({ spacing: { after: 200 } }));
        }
    }

    // Build document with Track Changes enabled
    const doc = new Document({
        features: { trackRevisions: true },
        sections: [{ children }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
}

function createRouter(cfg) {
    const router = express.Router();

    // JSON body parser for export routes
    router.use(express.json());

    // Export entity table to PDF
    router.post('/api/entities/:entity/export-pdf', (req, res) => {
        const entity = req.params.entity;
        const format = 'pdf';

        try {
            const { title, columns, records, entityColor, filters } = req.body;

            if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
                return res.status(400).json({ error: 'columns and records arrays are required' });
            }

            eventBus.emit('export:start', { format, entity, recordCount: records.length });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${entity}.pdf"`);

            const printService = new PrintService();
            printService.generatePdf({ title, columns, records, entityColor, filters }, res);

            eventBus.emit('export:complete', { format, entity, recordCount: records.length });

        } catch (error) {
            console.error('PDF generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'PDF generation failed' });
        }
    });

    // Export tree view to PDF (hierarchical format)
    router.post('/api/entities/:entity/export-tree-pdf', (req, res) => {
        const entity = req.params.entity;
        const format = 'tree-pdf';

        try {
            const { title, nodes, entityColor } = req.body;

            if (!nodes || !Array.isArray(nodes)) {
                return res.status(400).json({ error: 'nodes array is required' });
            }

            eventBus.emit('export:start', { format, entity, nodeCount: nodes.length });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${entity}_tree.pdf"`);

            const printService = new PrintService();
            printService.generateTreePdf({ title, nodes, entityColor }, res);

            eventBus.emit('export:complete', { format, entity, nodeCount: nodes.length });

        } catch (error) {
            console.error('Tree PDF generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'PDF generation failed' });
        }
    });

    // Export entity table to CSV
    router.post('/api/entities/:entity/export-csv', (req, res) => {
        const entity = req.params.entity;
        const format = 'csv';

        try {
            const { columns, records } = req.body;

            if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
                return res.status(400).json({ error: 'columns and records arrays are required' });
            }

            eventBus.emit('export:start', { format, entity, recordCount: records.length });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${entity}.csv"`);

            const csvService = new CsvService();
            csvService.generateCsv({ columns, records }, res);

            eventBus.emit('export:complete', { format, entity, recordCount: records.length });

        } catch (error) {
            console.error('CSV generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'CSV generation failed' });
        }
    });

    // Export entity table to XLSX (Excel)
    router.post('/api/entities/:entity/export-xlsx', (req, res) => {
        const entity = req.params.entity;
        const format = 'xlsx';

        try {
            const { columns, records } = req.body;

            if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
                return res.status(400).json({ error: 'columns and records arrays are required' });
            }

            eventBus.emit('export:start', { format, entity, recordCount: records.length });

            const xlsxService = new XlsxService();
            const buffer = xlsxService.generateXlsx({ columns, records });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${entity}.xlsx"`);
            res.send(buffer);

            eventBus.emit('export:complete', { format, entity, recordCount: records.length, size: buffer.length });

        } catch (error) {
            console.error('XLSX generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'XLSX generation failed' });
        }
    });

    // Export entity table to DOCX (Word)
    router.post('/api/entities/:entity/export-docx', async (req, res) => {
        const entity = req.params.entity;
        const format = 'docx';

        try {
            const { title, columns, records, entityColor, filters } = req.body;

            if (!columns || !Array.isArray(columns) || !records || !Array.isArray(records)) {
                return res.status(400).json({ error: 'columns and records arrays are required' });
            }

            eventBus.emit('export:start', { format, entity, recordCount: records.length });

            const printService = new PrintService();
            const buffer = await printService.generateDocx({ title, columns, records, entityColor, filters });

            const filename = (title || entity).replace(/[^a-z0-9]/gi, '_');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
            res.send(buffer);

            eventBus.emit('export:complete', { format, entity, recordCount: records.length, size: buffer.length });

        } catch (error) {
            console.error('DOCX generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'DOCX generation failed' });
        }
    });

    // Export tree view to DOCX (Word)
    router.post('/api/entities/:entity/export-tree-docx', async (req, res) => {
        const entity = req.params.entity;
        const format = 'tree-docx';

        try {
            const { title, nodes, entityColor, layout } = req.body;

            if (!nodes || !Array.isArray(nodes)) {
                return res.status(400).json({ error: 'nodes array is required' });
            }

            eventBus.emit('export:start', { format, entity, nodeCount: nodes.length });

            const printService = new PrintService();
            const buffer = await printService.generateTreeDocx({ title, nodes, entityColor, layout });

            const filename = (title || `${entity}_tree`).replace(/[^a-z0-9]/gi, '_');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
            res.send(buffer);

            eventBus.emit('export:complete', { format, entity, nodeCount: nodes.length, size: buffer.length });

        } catch (error) {
            console.error('Tree DOCX generation error:', error);
            eventBus.emit('export:error', { format, entity, error: error.message });
            res.status(500).json({ error: 'DOCX generation failed' });
        }
    });

    return router;
}

// Export the router factory and the EntityCards generation functions
module.exports = createRouter;
module.exports.generateEntityCardsPDF = generateEntityCardsPDF;
module.exports.generateEntityCardsDocx = generateEntityCardsDocx;
