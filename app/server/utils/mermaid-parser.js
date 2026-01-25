/**
 * Mermaid ER Diagram Parser
 * Parses Mermaid erDiagram syntax into entity definitions
 */

/**
 * Parse a Mermaid ER diagram
 * @param {string} code - Mermaid erDiagram code
 * @returns {{ entities: Array, relationships: Array, seedingInstructions: Object }}
 */
function parseMermaidER(code) {
    const lines = code.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));

    const entities = [];
    const relationships = [];
    const seedingInstructions = {};

    let currentEntity = null;
    let inEntityBlock = false;
    let inSeedingBlock = false;

    for (const line of lines) {
        // Skip erDiagram header
        if (line === 'erDiagram' || line.startsWith('erDiagram')) {
            continue;
        }

        // Check for SEEDING block
        if (line === 'SEEDING:' || line.startsWith('SEEDING:')) {
            inSeedingBlock = true;
            continue;
        }

        // End seeding block when AREAS or DESCRIPTIONS section starts
        if (inSeedingBlock && (line === 'AREAS:' || line === 'DESCRIPTIONS:')) {
            inSeedingBlock = false;
            // Don't continue - let AREAS/DESCRIPTIONS be parsed separately
        }

        // Parse seeding instructions
        if (inSeedingBlock) {
            const seedMatch = line.match(/^-\s*(\w+):\s*(.+)$/);
            if (seedMatch) {
                seedingInstructions[seedMatch[1]] = seedMatch[2].trim();
            }
            continue;
        }

        // Entity block start: EntityName {
        const entityStartMatch = line.match(/^(\w+)\s*\{$/);
        if (entityStartMatch) {
            currentEntity = {
                name: entityStartMatch[1],
                attributes: []
            };
            inEntityBlock = true;
            continue;
        }

        // Entity block end: }
        if (line === '}' && inEntityBlock) {
            if (currentEntity) {
                entities.push(currentEntity);
            }
            currentEntity = null;
            inEntityBlock = false;
            continue;
        }

        // Attribute line: type name "description"
        if (inEntityBlock && currentEntity) {
            const attrMatch = line.match(/^(\w+)\s+(\w+)\s+"([^"]*)"$/);
            if (attrMatch) {
                const attr = parseAttribute(attrMatch[1], attrMatch[2], attrMatch[3]);
                currentEntity.attributes.push(attr);
            }
            continue;
        }

        // Relationship line: Entity1 ||--o{ Entity2 : "fk_name"
        const relMatch = line.match(/^(\w+)\s+(\|[|o]--[o|]\{|\}[o|]--[o|]\{|\|[|o]--\|[|o])\s+(\w+)\s*:\s*"(\w+)"$/);
        if (relMatch) {
            const rel = parseRelationship(relMatch[1], relMatch[2], relMatch[3], relMatch[4]);
            relationships.push(rel);
            continue;
        }

        // Alternative relationship format without quotes
        const relMatch2 = line.match(/^(\w+)\s+(\|[|o]--[o|]\{|\}[o|]--[o|]\{|\|[|o]--\|[|o])\s+(\w+)\s*:\s*(\w+)$/);
        if (relMatch2) {
            const rel = parseRelationship(relMatch2[1], relMatch2[2], relMatch2[3], relMatch2[4]);
            relationships.push(rel);
        }
    }

    // Apply relationships to entities (add FK attributes)
    applyRelationships(entities, relationships);

    // Parse AREAS section
    const areas = parseAreas(code);

    // Parse DESCRIPTIONS section
    const descriptions = parseDescriptions(code);

    return { entities, relationships, seedingInstructions, areas, descriptions };
}

/**
 * Parse an attribute definition
 */
function parseAttribute(type, name, description) {
    const attr = {
        name: name,
        type: normalizeType(type),
        description: description
    };

    // Extract markers from description
    const markers = extractMarkers(description);
    if (markers.label) attr.label = true;
    if (markers.label2) attr.label2 = true;
    if (markers.default !== undefined) attr.default = markers.default;
    if (markers.readonly) attr.readonly = true;
    if (markers.hidden) attr.hidden = true;
    if (markers.uk1) attr.uk1 = true;
    if (markers.uk2) attr.uk2 = true;

    // Clean description (remove markers)
    attr.description = cleanDescription(description);

    return attr;
}

/**
 * Extract markers from description
 */
function extractMarkers(description) {
    const markers = {};

    if (/\[LABEL\]/i.test(description)) markers.label = true;
    if (/\[LABEL2\]/i.test(description)) markers.label2 = true;
    if (/\[READONLY\]/i.test(description)) markers.readonly = true;
    if (/\[HIDDEN\]/i.test(description)) markers.hidden = true;
    if (/\[UK1\]/i.test(description)) markers.uk1 = true;
    if (/\[UK2\]/i.test(description)) markers.uk2 = true;

    const defaultMatch = description.match(/\[DEFAULT=([^\]]+)\]/i);
    if (defaultMatch) {
        let val = defaultMatch[1];
        // Parse boolean/number values
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (val === 'TODAY') val = 'TODAY';
        else if (!isNaN(Number(val))) val = Number(val);
        markers.default = val;
    }

    return markers;
}

/**
 * Remove markers from description
 */
function cleanDescription(description) {
    return description
        .replace(/\[LABEL\]/gi, '')
        .replace(/\[LABEL2\]/gi, '')
        .replace(/\[READONLY\]/gi, '')
        .replace(/\[HIDDEN\]/gi, '')
        .replace(/\[UK1\]/gi, '')
        .replace(/\[UK2\]/gi, '')
        .replace(/\[DEFAULT=[^\]]+\]/gi, '')
        .trim();
}

/**
 * Normalize type names
 */
function normalizeType(type) {
    const typeMap = {
        'string': 'string',
        'text': 'text',
        'int': 'int',
        'integer': 'int',
        'number': 'int',
        'date': 'date',
        'datetime': 'date',
        'bool': 'bool',
        'boolean': 'bool'
    };
    return typeMap[type.toLowerCase()] || type;
}

/**
 * Parse relationship definition
 */
function parseRelationship(from, cardinality, to, fkName) {
    // Cardinality patterns:
    // ||--o{  : one-to-many (from has one, to has many) → FK on "to" side
    // ||--||  : one-to-one
    // }o--o{  : many-to-many (needs junction table)

    let type = 'one-to-many';
    let fkEntity = to; // Entity that gets the FK

    if (cardinality.includes('||--||')) {
        type = 'one-to-one';
    } else if (cardinality.includes('}o--o{') || cardinality.includes('}|--o{')) {
        type = 'many-to-many';
    } else if (cardinality.includes('||--o{')) {
        type = 'one-to-many';
        fkEntity = to;
    } else if (cardinality.includes('}o--||')) {
        type = 'one-to-many';
        fkEntity = from;
    }

    return {
        from,
        to,
        type,
        fkName,
        fkEntity
    };
}

/**
 * Apply relationships to entities by adding FK attributes
 */
function applyRelationships(entities, relationships) {
    const entityMap = {};
    for (const entity of entities) {
        entityMap[entity.name] = entity;
    }

    for (const rel of relationships) {
        if (rel.type === 'many-to-many') {
            // Create junction table entity
            const junctionName = `${rel.from}${rel.to}`;
            const junctionEntity = {
                name: junctionName,
                attributes: [
                    {
                        name: rel.from.toLowerCase(),
                        type: rel.from,
                        description: `Reference to ${rel.from}`,
                        foreignKey: rel.from
                    },
                    {
                        name: rel.to.toLowerCase(),
                        type: rel.to,
                        description: `Reference to ${rel.to}`,
                        foreignKey: rel.to
                    }
                ],
                isJunction: true
            };
            entities.push(junctionEntity);
        } else {
            // Add FK to the appropriate entity
            const fkEntity = entityMap[rel.fkEntity];
            if (fkEntity) {
                const targetEntity = rel.fkEntity === rel.to ? rel.from : rel.to;

                // Check if attribute with same name already exists
                const existingAttr = fkEntity.attributes.find(a => a.name === rel.fkName);
                if (existingAttr) {
                    // Convert existing attribute to FK (AI might have defined it as string)
                    existingAttr.type = targetEntity;
                    existingAttr.foreignKey = targetEntity;
                } else {
                    // Add new FK attribute
                    fkEntity.attributes.push({
                        name: rel.fkName,
                        type: targetEntity,
                        description: `Reference to ${targetEntity}`,
                        foreignKey: targetEntity
                    });
                }
            }
        }
    }
}

/**
 * Convert parsed entities to DataModel markdown format
 */
function toDataModelMarkdown(entity) {
    let md = `# ${entity.name}\n\n`;

    if (entity.isJunction) {
        md += `Junction table for many-to-many relationship.\n\n`;
    }

    md += `| Attribute | Type | Description | Example |\n`;
    md += `|-----------|------|-------------|----------|\n`;

    for (const attr of entity.attributes) {
        let type = attr.foreignKey || attr.type;
        let desc = attr.description || '';

        // Add markers
        const markers = [];
        if (attr.label) markers.push('[LABEL]');
        if (attr.label2) markers.push('[LABEL2]');
        if (attr.readonly) markers.push('[READONLY]');
        if (attr.hidden) markers.push('[HIDDEN]');
        if (attr.uk1) markers.push('[UK1]');
        if (attr.uk2) markers.push('[UK2]');
        if (attr.default !== undefined) {
            markers.push(`[DEFAULT=${attr.default}]`);
        }

        if (markers.length > 0) {
            desc = `${desc} ${markers.join(' ')}`.trim();
        }

        const example = generateExample(attr);
        md += `| ${attr.name} | ${type} | ${desc} | ${example} |\n`;
    }

    return md;
}

/**
 * Generate example value for attribute
 */
function generateExample(attr) {
    if (attr.foreignKey) return '1';

    switch (attr.type) {
        case 'string': return 'Example';
        case 'text': return 'Lorem ipsum...';
        case 'int': return '42';
        case 'date': return '2024-01-15';
        case 'bool': return 'true';
        default: return '';
    }
}

/**
 * Parse AREAS section from AI response
 * Format:
 * AREAS:
 * - AreaName: #HexColor
 *   - Entity1
 *   - Entity2
 * @param {string} code - Full response text
 * @returns {Object} { AreaName: { color: "#...", entities: [...] } }
 */
function parseAreas(code) {
    const areas = {};

    // Match AREAS section until next section or end
    const areaMatch = code.match(/AREAS:\s*\n([\s\S]*?)(?=\n(?:DESCRIPTIONS:|SEEDING:|```|$)|\n\n\n)/);
    if (!areaMatch) return {};

    const lines = areaMatch[1].split('\n');
    let currentArea = null;

    for (const line of lines) {
        // Area line: "- AreaName: #HexColor"
        const areaLine = line.match(/^-\s*([^:]+):\s*(#[0-9A-Fa-f]{6})/);
        if (areaLine) {
            currentArea = areaLine[1].trim();
            areas[currentArea] = { color: areaLine[2], entities: [] };
            continue;
        }

        // Entity line: "  - EntityName"
        const entityLine = line.match(/^\s+-\s*(\w+)\s*$/);
        if (entityLine && currentArea) {
            areas[currentArea].entities.push(entityLine[1]);
        }
    }

    return areas;
}

/**
 * Parse DESCRIPTIONS section from AI response
 * Format:
 * DESCRIPTIONS:
 * - EntityName: One-line description
 * @param {string} code - Full response text
 * @returns {Object} { EntityName: "description" }
 */
function parseDescriptions(code) {
    const descriptions = {};

    // Match DESCRIPTIONS section until next section or end
    const descMatch = code.match(/DESCRIPTIONS:\s*\n([\s\S]*?)(?=\n(?:AREAS:|SEEDING:|```|$)|\n\n\n)/);
    if (!descMatch) return {};

    const lines = descMatch[1].split('\n');
    for (const line of lines) {
        const match = line.match(/^-\s*(\w+):\s*(.+)$/);
        if (match) {
            descriptions[match[1]] = match[2].trim();
        }
    }

    return descriptions;
}

/**
 * Validate parsed entities
 */
function validateEntities(entities) {
    const errors = [];
    const warnings = [];

    for (const entity of entities) {
        // Check for LABEL
        const hasLabel = entity.attributes.some(a => a.label);
        if (!hasLabel && !entity.isJunction) {
            // Find first string attribute to suggest
            const firstString = entity.attributes.find(a => a.type === 'string');
            if (firstString) {
                warnings.push(`${entity.name}: No [LABEL] marker found. Consider adding to '${firstString.name}'`);
            } else {
                warnings.push(`${entity.name}: No [LABEL] marker found and no string attribute available`);
            }
        }

        // Check for empty entity
        if (entity.attributes.length === 0) {
            errors.push(`${entity.name}: Entity has no attributes`);
        }

        // Check for duplicate attribute names
        const names = entity.attributes.map(a => a.name);
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        if (duplicates.length > 0) {
            errors.push(`${entity.name}: Duplicate attribute names: ${duplicates.join(', ')}`);
        }
    }

    return { errors, warnings };
}

module.exports = {
    parseMermaidER,
    toDataModelMarkdown,
    validateEntities,
    parseAreas,
    parseDescriptions
};
