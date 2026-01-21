/**
 * Parse DataModel.md and generate DataModel.yaml
 *
 * This script reads the human-friendly Markdown documentation and extracts:
 * - Areas of Competence (from HTML table)
 * - Classes with attributes (from Entity Descriptions)
 * - Relationships (inferred from "Reference to X" in attribute descriptions)
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse the Areas from Entity Descriptions section.
 * Format: ### AreaName followed by <div style="background-color: #COLOR"> and entity table
 * @param {string} mdContent - Markdown content
 * @returns {Object} - { areas: {}, classToArea: {} }
 */
function parseAreasFromTable(mdContent) {
    const areas = {};
    const classToArea = {};

    // Match ### AreaName followed by <div style="background-color: #COLOR"> and entity table
    const areaPattern = /###\s+([^\n]+)\n<div[^>]*style="[^"]*background-color:\s*(#[0-9A-Fa-f]{6})[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    let match;

    while ((match = areaPattern.exec(mdContent)) !== null) {
        const areaName = match[1].trim();
        const color = match[2];
        const tableContent = match[3];

        const areaKey = areaName.toLowerCase().replace(/ /g, '_').replace(/&/g, 'and');

        areas[areaKey] = {
            name: areaName,
            color: color
        };

        // Extract entity names from markdown links: [EntityName](classes/EntityName.md)
        const entityPattern = /\[([^\]]+)\]\(classes\/[^)]+\.md\)/g;
        let entityMatch;
        while ((entityMatch = entityPattern.exec(tableContent)) !== null) {
            const className = entityMatch[1].trim();
            classToArea[className] = areaKey;
        }
    }

    return { areas, classToArea };
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/**
 * Parse a single entity markdown file
 * Format: # EntityName\n\nDescription\n\n| Attribute | Type | Description | Example |
 */
function parseEntityFile(fileContent) {
    const lines = fileContent.split('\n');

    // First line should be # EntityName
    const nameMatch = lines[0].match(/^#\s+(\w+)/);
    if (!nameMatch) {
        return null;
    }

    const className = nameMatch[1];
    let description = '';
    const attributes = [];

    // Find description (text before the table)
    let i = 1;
    while (i < lines.length && !lines[i].startsWith('|')) {
        if (lines[i].trim()) {
            description = lines[i].trim();
        }
        i++;
    }

    // Parse attribute table
    let inTable = false;
    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|') && !line.includes('---')) {
            if (line.includes('Attribute') && line.includes('Type')) {
                inTable = true;
                continue;
            }
            if (inTable) {
                // Parse table row: | name | type | description | example |
                const parts = line.split('|').slice(1, -1).map(p => p.trim());
                if (parts.length >= 3) {
                    attributes.push({
                        name: parts[0],
                        type: parts[1],
                        description: parts[2]
                    });
                }
            }
        }
    }

    return {
        className,
        description,
        attributes
    };
}

/**
 * Extract classes and attributes from classes/ directory.
 * Falls back to parsing Entity Descriptions section in DataModel.md for compatibility.
 */
function parseEntityDescriptions(mdContent, mdPath) {
    const classes = {};

    // Try to read from classes/ directory first
    if (mdPath) {
        const classesDir = path.join(path.dirname(mdPath), 'classes');
        if (fs.existsSync(classesDir)) {
            const entityFiles = fs.readdirSync(classesDir).filter(f => f.endsWith('.md'));

            for (const file of entityFiles) {
                const filePath = path.join(classesDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = parseEntityFile(content);

                if (parsed) {
                    classes[parsed.className] = {
                        description: parsed.description,
                        attributes: parsed.attributes
                    };
                }
            }

            if (Object.keys(classes).length > 0) {
                return classes;
            }
        }
    }

    // Fallback: parse from Entity Descriptions section in DataModel.md
    const entityMatch = mdContent.match(/## Entity Descriptions\s*\n([\s\S]*?)(?=\n## |\Z|$)/);
    if (!entityMatch) {
        return {};
    }

    let content = entityMatch[1];

    // Split by ### headers (class names)
    if (content.startsWith('### ')) {
        content = '\n' + content;
    }
    const classBlocks = content.split(/\n### /);

    for (const block of classBlocks.slice(1)) {  // Skip first empty split
        const lines = block.trim().split('\n');
        if (lines.length === 0) continue;

        const className = lines[0].trim();
        let description = '';
        const attributes = [];

        // Find description (text before the table)
        let i = 1;
        while (i < lines.length && !lines[i].startsWith('|')) {
            if (lines[i].trim()) {
                description = lines[i].trim();
            }
            i++;
        }

        // Parse attribute table
        let inTable = false;
        for (; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && !line.includes('---')) {
                if (line.includes('Attribute') && line.includes('Type')) {
                    inTable = true;
                    continue;
                }
                if (inTable) {
                    // Parse table row: | name | type | description |
                    const parts = line.split('|').slice(1, -1).map(p => p.trim());
                    if (parts.length >= 3) {
                        attributes.push({
                            name: parts[0],
                            type: parts[1],
                            description: parts[2]
                        });
                    }
                }
            }
        }

        classes[className] = {
            description: description,
            attributes: attributes
        };
    }

    return classes;
}

/**
 * Infer relationships from attribute descriptions containing 'Reference to X'.
 */
function inferRelationships(classes) {
    const relationships = [];

    for (const [className, classDef] of Object.entries(classes)) {
        for (const attr of classDef.attributes || []) {
            const desc = attr.description || '';
            // Look for "Reference to X" pattern
            const match = desc.match(/Reference to (\w+)/);
            if (match) {
                const targetClass = match[1];
                // Determine cardinality
                // Most are many-to-one (*:1), except special cases
                let fromCard = '*';
                let toCard = null;

                // Special case: 1:1 relationship (e.g., RepairOrder to Workscope)
                if (className === 'RepairOrder' && targetClass === 'Workscope') {
                    fromCard = '1';
                    toCard = '1';
                }

                const rel = {
                    from: className,
                    to: targetClass,
                    attribute: attr.name.replace('_id', ''),
                    from_cardinality: fromCard
                };

                if (toCard) {
                    rel.to_cardinality = toCard;
                }

                relationships.push(rel);
            }
        }
    }

    return relationships;
}

/**
 * Parse DataModel.md and return structured data.
 */
function parseDatamodel(mdPath) {
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    // Parse areas and class-to-area mapping
    const { areas, classToArea } = parseAreasFromTable(mdContent);

    // Parse entity descriptions (from classes/ directory or fallback to inline)
    const classes = parseEntityDescriptions(mdContent, mdPath);

    // Add area to each class
    for (const [className, classDef] of Object.entries(classes)) {
        classDef.area = classToArea[className] || 'unknown';
    }

    // Infer relationships
    const relationships = inferRelationships(classes);

    return {
        areas: areas,
        classes: classes,
        relationships: relationships
    };
}

// CLI support
if (require.main === module) {
    const yaml = require('js-yaml');

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

    // Default paths
    const scriptDir = path.join(__dirname, '..', 'app', 'docs', 'requirements');
    const mdPath = inputPath || path.join(scriptDir, 'DataModel.md');
    const yamlPath = outputPath || path.join(scriptDir, 'DataModel.yaml');

    // Parse
    const model = parseDatamodel(mdPath);

    // Write YAML
    fs.writeFileSync(yamlPath, yaml.dump(model, { noRefs: true, sortKeys: false }));

    console.log(`Parsed: ${mdPath}`);
    console.log(`  Areas: ${Object.keys(model.areas).length}`);
    console.log(`  Classes: ${Object.keys(model.classes).length}`);
    console.log(`  Relationships: ${model.relationships.length}`);
    console.log(`Generated: ${yamlPath}`);
}

module.exports = {
    parseDatamodel,
    parseAreasFromTable,
    parseEntityDescriptions,
    parseEntityFile,
    inferRelationships
};
