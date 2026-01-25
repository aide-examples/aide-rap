/**
 * Export Router (PDF, CSV)
 * Routes: /api/entities/:entity/export-pdf, export-tree-pdf, export-csv
 */

const express = require('express');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const PrintService = require('../services/PrintService');
const CsvService = require('../services/CsvService');

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

    // Check if attribute is tagged as LABEL (in description as [LABEL] or [LABEL2])
    function isLabel(attr) {
        const desc = attr.description || '';
        return desc.includes('[LABEL]') || desc.includes('[LABEL2]');
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

function createRouter(cfg) {
    const router = express.Router();

    // JSON body parser for export routes
    router.use(express.json());

    // Export entity table to PDF
    router.post('/api/entities/:entity/export-pdf', (req, res) => {
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
    router.post('/api/entities/:entity/export-tree-pdf', (req, res) => {
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
    router.post('/api/entities/:entity/export-csv', (req, res) => {
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

    return router;
}

// Export both the router factory and the generateEntityCardsPDF function
module.exports = createRouter;
module.exports.generateEntityCardsPDF = generateEntityCardsPDF;
