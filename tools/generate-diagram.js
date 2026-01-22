/**
 * Generate SVG class diagram from DataModel.yaml and layout.json
 *
 * The script reads:
 *   - docs/requirements/DataModel.yaml (classes, attributes, relationships, colors)
 *   - docs/requirements/layout.json (x/y positions)
 *
 * And generates an SVG diagram.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Escape text for use in XML/SVG.
 */
function escapeXml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Remove type annotations like [DEFAULT=x] from type string for display.
 */
function cleanTypeForDisplay(typeStr) {
    return typeStr.replace(/\s*\[[^\]]+\]/g, '').trim();
}

/**
 * Generates SVG class diagrams from YAML model and JSON layout.
 */
class DiagramGenerator {
    // Box dimensions
    static BOX_WIDTH = 140;
    static BOX_HEIGHT_COMPACT = 30;
    static ATTR_LINE_HEIGHT = 16;
    static BOX_PADDING = 8;
    static HEADER_HEIGHT = 24;

    // Styling
    static STROKE_COLOR = '#333';
    static STROKE_WIDTH = 1.5;
    static FONT_FAMILY = 'Arial, sans-serif';
    static FONT_SIZE_CLASS = 12;
    static FONT_SIZE_ATTR = 10;

    constructor(modelPath, layoutPath) {
        this.model = yaml.load(fs.readFileSync(modelPath, 'utf-8'));
        this.layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));

        this.areas = this.model.areas || {};
        this.classes = this.model.classes || {};
        this.positions = this.layout.classes || {};
        this.canvas = this.layout.canvas || { width: 1200, height: 900 };

        // Derive relationships from FK attributes (conceptual notation)
        this.relationships = this.deriveRelationshipsFromFKs();
    }

    /**
     * Derive relationships from FK attributes.
     * In conceptual notation, an attribute with type = EntityName is a FK.
     */
    deriveRelationshipsFromFKs() {
        const relationships = [];
        const entityNames = Object.keys(this.classes);

        for (const [className, classDef] of Object.entries(this.classes)) {
            const attrs = classDef.attributes || [];
            // Get visible attributes (same as getVisibleAttributes, excluding 'id')
            const visibleAttrs = attrs.filter(a => a.name !== 'id');

            for (let i = 0; i < visibleAttrs.length; i++) {
                const attr = visibleAttrs[i];
                // Extract base type (remove [DEFAULT=...] etc.)
                const baseType = (attr.type || '').replace(/\s*\[[^\]]+\]/g, '').trim();

                // Check if type is an entity name (FK reference)
                if (entityNames.includes(baseType)) {
                    relationships.push({
                        from: className,
                        to: baseType,
                        attribute: attr.name,
                        attrIndex: i,  // Index for Y positioning
                        from_cardinality: '*'
                    });
                }
            }
        }

        return relationships;
    }

    getPosition(className) {
        return this.positions[className] || { x: 0, y: 0 };
    }

    getColor(className) {
        const classDef = this.classes[className] || {};
        const area = classDef.area || '';
        const areaDef = this.areas[area] || {};
        return areaDef.color || '#FFFFFF';
    }

    /**
     * Get visible attributes (filter out 'id' - it's implicit)
     */
    getVisibleAttributes(className) {
        const classDef = this.classes[className] || {};
        const attrs = classDef.attributes || [];
        return attrs.filter(a => a.name !== 'id');
    }

    getBoxHeight(className, showAttributes) {
        if (!showAttributes) {
            return DiagramGenerator.BOX_HEIGHT_COMPACT;
        }

        const visibleAttrs = this.getVisibleAttributes(className);
        return DiagramGenerator.HEADER_HEIGHT + visibleAttrs.length * DiagramGenerator.ATTR_LINE_HEIGHT + DiagramGenerator.BOX_PADDING;
    }

    getBoxCenter(className, showAttributes) {
        const pos = this.getPosition(className);
        const height = this.getBoxHeight(className, showAttributes);
        return { x: pos.x + DiagramGenerator.BOX_WIDTH / 2, y: pos.y + height / 2 };
    }

    /**
     * Calculate intersection of two line segments.
     * Returns intersection point or null if no intersection.
     */
    lineSegmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 0.0001) return null; // Parallel lines

        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

        // Check if intersection is within both segments
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            };
        }
        return null;
    }

    /**
     * Calculate where a ray from (x1,y1) to (x2,y2) intersects a box.
     * Returns the intersection point closest to (x1,y1).
     */
    rayBoxIntersection(x1, y1, x2, y2, boxX, boxY, boxW, boxH) {
        // Define box edges
        const edges = [
            { x1: boxX, y1: boxY, x2: boxX + boxW, y2: boxY },                 // top
            { x1: boxX, y1: boxY + boxH, x2: boxX + boxW, y2: boxY + boxH },   // bottom
            { x1: boxX, y1: boxY, x2: boxX, y2: boxY + boxH },                 // left
            { x1: boxX + boxW, y1: boxY, x2: boxX + boxW, y2: boxY + boxH }    // right
        ];

        let closestPoint = null;
        let minDist = Infinity;

        for (const edge of edges) {
            const intersection = this.lineSegmentIntersection(
                x1, y1, x2, y2,
                edge.x1, edge.y1, edge.x2, edge.y2
            );
            if (intersection) {
                const dist = Math.hypot(intersection.x - x1, intersection.y - y1);
                if (dist < minDist) {
                    minDist = dist;
                    closestPoint = intersection;
                }
            }
        }

        return closestPoint || { x: x2, y: y2 };
    }

    /**
     * Get connection points for a relationship.
     * In detailed mode, starts from the attribute row.
     * Target point is calculated via ray-box intersection.
     */
    getConnectionPoint(fromClass, toClass, showAttributes, attrIndex = -1) {
        const fromPos = this.getPosition(fromClass);
        const toPos = this.getPosition(toClass);

        const fromHeight = this.getBoxHeight(fromClass, showAttributes);
        const toHeight = this.getBoxHeight(toClass, showAttributes);

        // Target center
        const toCx = toPos.x + DiagramGenerator.BOX_WIDTH / 2;
        const toCy = toPos.y + toHeight / 2;

        // Source Y: attribute row in detailed mode, or box center
        let fromY;
        if (showAttributes && attrIndex >= 0) {
            // Y position at the center of the specific attribute row
            fromY = fromPos.y + DiagramGenerator.HEADER_HEIGHT + (attrIndex + 0.5) * DiagramGenerator.ATTR_LINE_HEIGHT;
        } else {
            // Fallback to box center
            fromY = fromPos.y + fromHeight / 2;
        }

        // Source X: left or right edge depending on target position
        let fromX;
        if (toCx > fromPos.x + DiagramGenerator.BOX_WIDTH / 2) {
            // Target is to the right
            fromX = fromPos.x + DiagramGenerator.BOX_WIDTH;
        } else {
            // Target is to the left
            fromX = fromPos.x;
        }

        // Calculate where line from (fromX, fromY) to (toCx, toCy) intersects target box
        const intersection = this.rayBoxIntersection(
            fromX, fromY,
            toCx, toCy,
            toPos.x, toPos.y, DiagramGenerator.BOX_WIDTH, toHeight
        );

        return { fromX, fromY, toX: intersection.x, toY: intersection.y };
    }

    renderClassBox(className, showAttributes) {
        const pos = this.getPosition(className);
        const color = this.getColor(className);
        const height = this.getBoxHeight(className, showAttributes);

        const { x, y } = pos;
        const svgParts = [];

        // Box rectangle
        svgParts.push(
            `<rect x="${x}" y="${y}" width="${DiagramGenerator.BOX_WIDTH}" height="${height}" ` +
            `fill="${color}" stroke="${DiagramGenerator.STROKE_COLOR}" stroke-width="${DiagramGenerator.STROKE_WIDTH}" rx="3"/>`
        );

        // Class name (header)
        const textY = y + (showAttributes ? DiagramGenerator.HEADER_HEIGHT : DiagramGenerator.BOX_HEIGHT_COMPACT) / 2 + 4;
        svgParts.push(
            `<text x="${x + DiagramGenerator.BOX_WIDTH / 2}" y="${textY}" ` +
            `text-anchor="middle" font-family="${DiagramGenerator.FONT_FAMILY}" ` +
            `font-size="${DiagramGenerator.FONT_SIZE_CLASS}" font-weight="bold">${escapeXml(className)}</text>`
        );

        // Separator line and attributes
        if (showAttributes) {
            const sepY = y + DiagramGenerator.HEADER_HEIGHT;
            svgParts.push(
                `<line x1="${x}" y1="${sepY}" x2="${x + DiagramGenerator.BOX_WIDTH}" y2="${sepY}" ` +
                `stroke="${DiagramGenerator.STROKE_COLOR}" stroke-width="1"/>`
            );

            const visibleAttrs = this.getVisibleAttributes(className);
            for (let i = 0; i < visibleAttrs.length; i++) {
                const attr = visibleAttrs[i];
                const attrY = sepY + (i + 1) * DiagramGenerator.ATTR_LINE_HEIGHT - 2;
                const cleanType = cleanTypeForDisplay(attr.type);
                const attrText = `${attr.name}: ${cleanType}`;
                svgParts.push(
                    `<text x="${x + 5}" y="${attrY}" ` +
                    `font-family="${DiagramGenerator.FONT_FAMILY}" font-size="${DiagramGenerator.FONT_SIZE_ATTR}">${escapeXml(attrText)}</text>`
                );
            }
        }

        return svgParts.join('\n    ');
    }

    renderRelationship(rel, showAttributes) {
        const fromClass = rel.from;
        const toClass = rel.to;
        const attribute = rel.attribute || '';
        const attrIndex = rel.attrIndex !== undefined ? rel.attrIndex : -1;
        const fromCard = rel.from_cardinality || '*';
        const toCard = rel.to_cardinality || '';

        const { fromX, fromY, toX, toY } = this.getConnectionPoint(fromClass, toClass, showAttributes, attrIndex);

        // Horizontal stub length before turning toward target
        const STUB_LENGTH = 15;
        const direction = fromX < toX ? 1 : -1;  // Right or left
        const stubX = fromX + direction * STUB_LENGTH;

        const svgParts = [];

        // Path: horizontal stub, then diagonal to target
        svgParts.push(
            `<path d="M ${fromX} ${fromY} L ${stubX} ${fromY} L ${toX} ${toY}" ` +
            `fill="none" stroke="${DiagramGenerator.STROKE_COLOR}" stroke-width="1" marker-end="url(#arrowhead)"/>`
        );

        // Label along the diagonal part (midpoint of stub-to-target segment)
        if (attribute) {
            const midX = (stubX + toX) / 2;
            const midY = (fromY + toY) / 2 - 5;
            svgParts.push(
                `<text x="${midX}" y="${midY}" text-anchor="middle" ` +
                `font-family="${DiagramGenerator.FONT_FAMILY}" font-size="9" fill="#666" ` +
                `font-style="italic">${escapeXml(attribute)}</text>`
            );
        }

        // Cardinality at to end (for 1:1 relationships)
        if (toCard) {
            const cardX = stubX + (toX - stubX) * 0.9;
            const cardY = fromY + (toY - fromY) * 0.9 - 5;
            svgParts.push(
                `<text x="${cardX}" y="${cardY}" font-family="${DiagramGenerator.FONT_FAMILY}" ` +
                `font-size="10" fill="#666">${escapeXml(toCard)}</text>`
            );
        }

        return svgParts.join('\n    ');
    }

    renderLegend(yOffset) {
        const svgParts = [];
        let x = 20;
        let y = yOffset;

        svgParts.push(
            `<text x="${x}" y="${y}" font-family="${DiagramGenerator.FONT_FAMILY}" ` +
            `font-size="12" font-weight="bold">Areas:</text>`
        );

        y += 20;
        for (const [areaId, areaDef] of Object.entries(this.areas)) {
            const color = areaDef.color || '#FFFFFF';
            const name = areaDef.name || areaId;

            svgParts.push(
                `<rect x="${x}" y="${y - 10}" width="14" height="14" ` +
                `fill="${color}" stroke="${DiagramGenerator.STROKE_COLOR}" stroke-width="1"/>`
            );
            svgParts.push(
                `<text x="${x + 20}" y="${y}" font-family="${DiagramGenerator.FONT_FAMILY}" ` +
                `font-size="11">${escapeXml(name)}</text>`
            );
            y += 20;
        }

        return svgParts.join('\n    ');
    }

    generate(options = {}) {
        const showAttributes = options.showAttributes || false;
        const showLegend = options.showLegend !== false;

        const width = this.canvas.width || 1200;
        const height = this.canvas.height || 900;

        const svgParts = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
            `width="${width}" height="${height}">`,
            '  <defs>',
            '    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">',
            '      <polygon points="0 0, 10 3.5, 0 7" fill="#333"/>',
            '    </marker>',
            '  </defs>',
            `  <rect width="${width}" height="${height}" fill="white"/>`,
            '',
            '  <!-- Relationships -->'
        ];

        for (const rel of this.relationships) {
            svgParts.push('  ' + this.renderRelationship(rel, showAttributes));
        }

        svgParts.push('');
        svgParts.push('  <!-- Class boxes -->');

        for (const className of Object.keys(this.classes)) {
            if (className in this.positions) {
                svgParts.push('  ' + this.renderClassBox(className, showAttributes));
            }
        }

        if (showLegend) {
            svgParts.push('');
            svgParts.push('  <!-- Legend -->');
            svgParts.push('  ' + this.renderLegend(height - 120));
        }

        svgParts.push('</svg>');

        return svgParts.join('\n');
    }
}

// CLI support
if (require.main === module) {
    const args = process.argv.slice(2);
    let showAttributes = false;
    let showLegend = true;
    let outputPath = 'diagram.svg';
    let modelPath = null;
    let layoutPath = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-a' || args[i] === '--show-attributes') {
            showAttributes = true;
        } else if (args[i] === '--no-legend') {
            showLegend = false;
        } else if (args[i] === '-o' || args[i] === '--output') {
            outputPath = args[++i];
        } else if (args[i] === '-m' || args[i] === '--model') {
            modelPath = args[++i];
        } else if (args[i] === '-l' || args[i] === '--layout') {
            layoutPath = args[++i];
        }
    }

    // Find paths relative to script location
    const scriptDir = path.join(__dirname, '..', 'app', 'docs', 'requirements');
    modelPath = modelPath || path.join(scriptDir, 'DataModel.yaml');
    layoutPath = layoutPath || path.join(scriptDir, 'DataModel-layout.json');

    const generator = new DiagramGenerator(modelPath, layoutPath);
    const svg = generator.generate({
        showAttributes,
        showLegend
    });

    fs.writeFileSync(outputPath, svg);
    console.log(`Generated: ${outputPath}`);
}

module.exports = { DiagramGenerator, escapeXml };
