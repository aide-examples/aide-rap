/**
 * Extract layout positions from a draw.io file and update layout.json
 *
 * After editing the draw.io file, run this script to update layout.json,
 * then run generate-diagram.js to create the final SVG.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Decode draw.io's compressed/encoded diagram content.
 */
function decodeDrawioContent(content) {
    // draw.io can store content in multiple ways:
    // 1. Plain XML
    // 2. URL-encoded + base64 + deflate compressed

    if (content.startsWith('<mxGraphModel')) {
        return content;
    }

    try {
        // Try to decode: URL decode -> base64 decode -> inflate
        const urlDecoded = decodeURIComponent(content);
        const base64Decoded = Buffer.from(urlDecoded, 'base64');
        const inflated = zlib.inflateRawSync(base64Decoded);
        return inflated.toString('utf-8');
    } catch (e) {
        // If decoding fails, assume it's plain text
        return content;
    }
}

/**
 * Simple XML attribute parser (no external dependencies)
 */
function parseXmlAttributes(tag) {
    const attrs = {};
    const attrPattern = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = attrPattern.exec(tag)) !== null) {
        attrs[match[1]] = match[2];
    }
    return attrs;
}

/**
 * Extract class positions from draw.io file.
 */
function extractPositions(drawioPath) {
    const content = fs.readFileSync(drawioPath, 'utf-8');
    const positions = {};

    // Find diagram elements
    const diagramPattern = /<diagram[^>]*>([\s\S]*?)<\/diagram>/g;
    let diagramMatch;

    while ((diagramMatch = diagramPattern.exec(content)) !== null) {
        let graphContent = diagramMatch[1].trim();

        // Check if content is encoded
        if (!graphContent.startsWith('<mxGraphModel')) {
            graphContent = decodeDrawioContent(graphContent);
        }

        // Find all mxCell elements with value and geometry
        const cellPattern = /<mxCell([^>]*)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
        let cellMatch;

        while ((cellMatch = cellPattern.exec(graphContent)) !== null) {
            const cellAttrs = parseXmlAttributes(cellMatch[0]);
            const value = cellAttrs.value || '';

            // Skip cells that are clearly not class names
            if (!value || value.includes('<') || value === '0' || value === '1') {
                continue;
            }

            // Look for geometry in the cell content
            const geometryMatch = cellMatch[0].match(/<mxGeometry([^>]*)/);
            if (geometryMatch) {
                const geoAttrs = parseXmlAttributes(geometryMatch[0]);
                const x = geoAttrs.x;
                const y = geoAttrs.y;

                if (x !== undefined && y !== undefined) {
                    positions[value] = {
                        x: Math.floor(parseFloat(x)),
                        y: Math.floor(parseFloat(y))
                    };
                }
            }
        }
    }

    return positions;
}

/**
 * Update layout.json with new positions.
 */
function updateLayoutJson(layoutPath, newPositions) {
    // Read existing layout
    let layout = {};
    if (fs.existsSync(layoutPath)) {
        layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
    }

    // Update positions
    if (!layout.classes) {
        layout.classes = {};
    }

    for (const [className, pos] of Object.entries(newPositions)) {
        layout.classes[className] = pos;
    }

    // Write back
    fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2));

    return layout;
}

// CLI support
if (require.main === module) {
    const args = process.argv.slice(2);
    let inputPath = null;
    let outputPath = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i' || args[i] === '--input') {
            inputPath = args[++i];
        } else if (args[i] === '-o' || args[i] === '--output') {
            outputPath = args[++i];
        }
    }

    if (!inputPath) {
        console.error('Usage: node extract-layout.js -i layout.drawio [-o layout.json]');
        process.exit(1);
    }

    const drawioPath = inputPath;

    // Default output path
    const scriptDir = path.join(__dirname, '..', 'app', 'docs', 'requirements');
    const layoutPath = outputPath || path.join(scriptDir, 'layout.json');

    // Extract positions
    const positions = extractPositions(drawioPath);

    if (Object.keys(positions).length === 0) {
        console.log('Warning: No class positions found in draw.io file');
        return;
    }

    console.log(`Found ${Object.keys(positions).length} classes:`);
    for (const name of Object.keys(positions).sort()) {
        const pos = positions[name];
        console.log(`  ${name}: (${pos.x}, ${pos.y})`);
    }

    // Update layout.json
    updateLayoutJson(layoutPath, positions);
    console.log(`\nUpdated: ${layoutPath}`);
    console.log(`\nNow run: node generate-diagram.js`);
}

module.exports = { extractPositions, updateLayoutJson, decodeDrawioContent };
