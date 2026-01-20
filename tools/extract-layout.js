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
 * @param {string} layoutPath - Path to layout.json
 * @param {Object} newPositions - New positions to merge
 * @param {string[]} [validClassNames] - If provided, remove classes not in this list
 */
function updateLayoutJson(layoutPath, newPositions, validClassNames) {
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

    // Remove classes not in validClassNames (if provided)
    if (validClassNames) {
        const validSet = new Set(validClassNames);
        for (const className of Object.keys(layout.classes)) {
            if (!validSet.has(className)) {
                delete layout.classes[className];
            }
        }
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

/**
 * Remove classes from draw.io file that are no longer in the model.
 * @param {string} drawioPath - Path to the draw.io file
 * @param {string[]} validClassNames - Class names that should remain
 * @returns {string[]} - Names of classes that were removed
 */
function removeClassesFromDrawio(drawioPath, validClassNames) {
    if (!fs.existsSync(drawioPath)) {
        return [];
    }

    let content = fs.readFileSync(drawioPath, 'utf-8');
    const validSet = new Set(validClassNames);
    const removedClasses = [];

    // Find all mxCell elements with a value attribute (class boxes)
    // Match the entire cell including its closing tag or self-closing
    const cellPattern = /<mxCell[^>]*value="([^"]+)"[^>]*>[\s\S]*?<\/mxCell>\s*/g;

    content = content.replace(cellPattern, (match, className) => {
        if (!validSet.has(className)) {
            removedClasses.push(className);
            return '';  // Remove the cell
        }
        return match;  // Keep the cell
    });

    if (removedClasses.length > 0) {
        fs.writeFileSync(drawioPath, content);
    }

    return removedClasses;
}

/**
 * Add missing classes to an existing draw.io file.
 * @param {string} drawioPath - Path to the draw.io file
 * @param {string[]} newClassNames - Class names to add
 * @param {Object} areas - Area definitions with colors { areaKey: { color: '#xxx' } }
 * @param {Object} classToArea - Mapping of class name to area key
 * @returns {string[]} - Names of classes that were added
 */
function addClassesToDrawio(drawioPath, newClassNames, areas, classToArea) {
    if (!fs.existsSync(drawioPath) || newClassNames.length === 0) {
        return [];
    }

    let content = fs.readFileSync(drawioPath, 'utf-8');

    // Find existing class names in the file
    const existingClasses = new Set();
    const valuePattern = /value="([^"]+)"/g;
    let match;
    while ((match = valuePattern.exec(content)) !== null) {
        existingClasses.add(match[1]);
    }

    // Filter to only truly new classes
    const classesToAdd = newClassNames.filter(name => !existingClasses.has(name));
    if (classesToAdd.length === 0) {
        return [];
    }

    // Find the highest existing cell id
    const idPattern = /id="(\d+)"/g;
    let maxId = 1;
    while ((match = idPattern.exec(content)) !== null) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
    }

    // Generate new cells for each class
    // Place them at the bottom of the canvas with auto-layout
    const startY = 650;  // Below existing content
    const startX = 50;
    const cellWidth = 140;
    const cellHeight = 30;
    const colSpacing = 180;
    const rowSpacing = 50;
    const cols = 5;

    const newCells = classesToAdd.map((className, i) => {
        const cellId = maxId + 1 + i;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * colSpacing;
        const y = startY + row * rowSpacing;

        // Determine color from area
        const areaKey = classToArea[className] || 'unknown';
        const areaDef = areas[areaKey] || {};
        const fillColor = areaDef.color || '#FFFFFF';

        return `                <mxCell id="${cellId}" value="${className}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${fillColor};strokeColor=#333333;fontStyle=1" parent="1" vertex="1">
                    <mxGeometry x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" as="geometry"/>
                </mxCell>`;
    });

    // Insert new cells before </root>
    const insertPoint = content.lastIndexOf('</root>');
    if (insertPoint === -1) {
        console.error('Could not find </root> in draw.io file');
        return [];
    }

    const newContent = content.slice(0, insertPoint) +
        newCells.join('\n') + '\n            ' +
        content.slice(insertPoint);

    fs.writeFileSync(drawioPath, newContent);

    return classesToAdd;
}

/**
 * Create a new draw.io file with the given classes.
 * @param {string} drawioPath - Path to create
 * @param {string[]} classNames - Class names
 * @param {Object} areas - Area definitions
 * @param {Object} classToArea - Class to area mapping
 */
function createDrawioFile(drawioPath, classNames, areas, classToArea) {
    const cellWidth = 140;
    const cellHeight = 30;
    const colSpacing = 180;
    const rowSpacing = 50;
    const cols = 5;
    const startX = 50;
    const startY = 50;

    const cells = classNames.map((className, i) => {
        const cellId = 3 + i;  // Start after 0, 1, 2 (root cells)
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * colSpacing;
        const y = startY + row * rowSpacing;

        const areaKey = classToArea[className] || 'unknown';
        const areaDef = areas[areaKey] || {};
        const fillColor = areaDef.color || '#FFFFFF';

        return `                <mxCell id="${cellId}" value="${className}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${fillColor};strokeColor=#333333;fontStyle=1" parent="1" vertex="1">
                    <mxGeometry x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" as="geometry"/>
                </mxCell>`;
    });

    const docName = path.basename(drawioPath, '-layout.drawio');
    const content = `<mxfile host="65bd71144e">
    <diagram name="${docName}" id="${docName.toLowerCase()}">
        <mxGraphModel dx="366" dy="563" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="900" math="0" shadow="0">
            <root>
                <mxCell id="0"/>
                <mxCell id="1" parent="0"/>
${cells.join('\n')}
            </root>
        </mxGraphModel>
    </diagram>
</mxfile>
`;

    fs.writeFileSync(drawioPath, content);
}

module.exports = {
    extractPositions,
    updateLayoutJson,
    decodeDrawioContent,
    addClassesToDrawio,
    removeClassesFromDrawio,
    createDrawioFile
};
