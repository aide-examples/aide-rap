/**
 * Generate a draw.io file from DataModel.yaml and layout.json
 *
 * This creates a .drawio file with positioned boxes for each class.
 * You can then open it in draw.io, move the boxes around, and use
 * extract-layout.js to update layout.json.
 *
 * Usage:
 *     node generate-drawio.js [--output layout.drawio]
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Generate draw.io XML from model and layout.
 */
function generateDrawio(modelPath, layoutPath) {
    const model = yaml.load(fs.readFileSync(modelPath, 'utf-8'));
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));

    const areas = model.areas || {};
    const classes = model.classes || {};
    const positions = layout.classes || {};
    const canvas = layout.canvas || { width: 1200, height: 900 };

    const boxWidth = 140;
    const boxHeight = 30;

    const xmlParts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="Claude" version="21.0.0">',
        '  <diagram name="DataModel" id="datamodel">',
        `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${canvas.width}" pageHeight="${canvas.height}">`,
        '      <root>',
        '        <mxCell id="0"/>',
        '        <mxCell id="1" parent="0"/>',
    ];

    let cellId = 2;

    for (const [className, classDef] of Object.entries(classes)) {
        const pos = positions[className] || { x: 100, y: 100 };
        const area = classDef.area || '';
        const areaDef = areas[area] || {};
        const color = areaDef.color || '#FFFFFF';

        // Create a rectangle for each class
        xmlParts.push(
            `        <mxCell id="${cellId}" value="${className}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#333333;fontStyle=1" vertex="1" parent="1">`
        );
        xmlParts.push(
            `          <mxGeometry x="${pos.x}" y="${pos.y}" width="${boxWidth}" height="${boxHeight}" as="geometry"/>`
        );
        xmlParts.push('        </mxCell>');
        cellId++;
    }

    xmlParts.push(
        '      </root>',
        '    </mxGraphModel>',
        '  </diagram>',
        '</mxfile>'
    );

    return xmlParts.join('\n');
}

// CLI support
if (require.main === module) {
    const args = process.argv.slice(2);
    let outputPath = 'layout.drawio';
    let modelPath = null;
    let layoutPath = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-o' || args[i] === '--output') {
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
    layoutPath = layoutPath || path.join(scriptDir, 'layout.json');

    const drawioXml = generateDrawio(modelPath, layoutPath);

    fs.writeFileSync(outputPath, drawioXml);
    console.log(`Generated: ${outputPath}`);
    console.log(`\nOpen this file in draw.io, arrange the boxes, then run:`);
    console.log(`  node tools/extract-layout.js -i ${outputPath}`);
}

module.exports = { generateDrawio };
