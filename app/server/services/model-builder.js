/**
 * Model Builder Service
 * Generates new AIDE RAP systems from design descriptions
 */

const fs = require('fs');
const path = require('path');
const { parseMermaidER, toDataModelMarkdown, validateEntities } = require('../utils/mermaid-parser');

const SYSTEMS_DIR = path.join(__dirname, '../../systems');
const MIN_PORT = 18360;

/**
 * Build enriched prompt from user's design brief
 */
function buildPrompt(systemName, displayName, description, designBrief) {
    return `# System Design Task

You are designing a data model for: **${displayName}**

## System Description
${description}

## User's Design Brief
${designBrief}

---

## IMPORTANT RULES

1. **Output language**: Generate ALL content in English only
2. **Entity names**: Use PascalCase (e.g., \`BookCategory\`, \`OrderItem\`)
3. **Attribute names**: Use snake_case (e.g., \`first_name\`, \`created_at\`)
4. **Relationships**: Express as noun-based foreign keys, not verbs
   - ❌ "Author writes Books" → NO verb-based relationships
   - ✅ Book has \`author\` (FK to Author) → Use noun-based FK names
5. **Use these markers in descriptions**:
   - \`[LABEL]\` - Primary display field (required, exactly one per entity)
   - \`[LABEL2]\` - Secondary display field (optional)
   - \`[DEFAULT=value]\` - Default value for new records
   - \`[UK1]\` - Part of unique key constraint
   - \`[HIDDEN]\` - Not shown in UI
   - \`[READONLY]\` - Not editable

## Output Format

**CRITICAL**: Always wrap your diagram in a complete code block with BOTH opening AND closing markers:

\`\`\`mermaid
erDiagram
    EntityName {
        type attribute_name "Description with [MARKERS]"
    }
    Entity1 ||--o{ Entity2 : "fk_attribute_name"
\`\`\`

Do NOT omit the opening \`\`\`mermaid line!

**Relationship notation**:
- \`||--o{\` : One-to-many (the "many" side has the FK)
- \`||--||\` : One-to-one
- \`}o--o{\` : Many-to-many (needs junction table)

**Types**: \`string\`, \`text\`, \`int\`, \`date\`, \`bool\`

## Example

For a blog system with authors and posts:

\`\`\`mermaid
erDiagram
    Author {
        string username "[LABEL] Login name"
        string email "Email address"
        string display_name "[LABEL2] Public name"
        date joined_date "[DEFAULT=TODAY] Registration date"
    }
    Post {
        string title "[LABEL] Post title"
        text content "Post body"
        date published_date "Publication date"
        bool is_draft "[DEFAULT=true] Draft status"
    }
    Author ||--o{ Post : "author"
\`\`\`

## Seeding Instructions

After the ER diagram, also provide seeding instructions for each entity in this format:

\`\`\`
SEEDING:
- Author: Create 5 sample authors with realistic names and email addresses
- Post: Create 2-3 posts per author with varied topics and publication dates
\`\`\`

**FK Reference Format**: When generating seed data JSON, you can reference related records using:
- **By label**: \`"author": "Jane Austen"\` - resolved by the author's name (LABEL field)
- **By index**: \`"author": "#1"\` - references the 1st record, \`"#2"\` = 2nd record, etc.

The index notation is useful when entities don't have unique labels or when referencing records by insertion order.

## Areas of Competence (Hemispheres)

Group related entities into logical areas. Each area represents a business domain or functional area.

**Rules for area names:**
- Use English gerunds (verbs ending in "-ing"): Publishing, Cataloging, Ordering
- Area names must NOT match any entity name
- Keep names short (1-2 words)

**Color assignment:**
- Use subtle pastel colors (hex format)
- Suggested palette: #E8F4E8 (green), #E8EEF4 (blue), #FCE5CD (orange), #E6D9F2 (purple), #FEF3C7 (yellow)

## Entity Descriptions

Provide a one-line description for each entity explaining its business purpose.

## Output: Areas and Descriptions

After the SEEDING section, add these two sections:

\`\`\`
AREAS:
- Authoring: #E8F4E8
  - Author
  - Post
- Organizing: #E8EEF4
  - Category

DESCRIPTIONS:
- Author: Blog writers with profile information
- Post: Blog articles with content and metadata
- Category: Content organization structure
\`\`\`

## IMPORTANT: Provide Download Option

**After generating the diagram, please offer the complete output as a downloadable markdown file.**

This is critical because copying from the rendered chat view often loses the \`\`\`mermaid code block markers. The downloadable file preserves the exact syntax needed for parsing.

Name the file: \`${systemName}_datamodel.md\`

Now generate the data model for the system described above.`;
}

/**
 * Parse Mermaid response and extract entities, areas, and descriptions
 */
function parseResponse(mermaidCode) {
    let code = mermaidCode;

    // Try to extract mermaid code block if wrapped in ```
    const codeBlockMatch = mermaidCode.match(/```(?:mermaid)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        code = codeBlockMatch[1];
    } else {
        // No code block found - check if it starts with erDiagram directly
        const erMatch = mermaidCode.match(/(erDiagram[\s\S]*?)(?:```|SEEDING:|AREAS:|DESCRIPTIONS:|## |$)/);
        if (erMatch) {
            code = erMatch[1];
        }
    }

    // Extract SEEDING section (may be in separate ``` block or after diagram)
    const seedingMatch = mermaidCode.match(/SEEDING:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (seedingMatch && !code.includes('SEEDING:')) {
        code += '\nSEEDING:\n' + seedingMatch[1];
    }

    // Extract AREAS section (may be outside the code block)
    const areasMatch = mermaidCode.match(/AREAS:\s*\n([\s\S]*?)(?=\n(?:DESCRIPTIONS:|SEEDING:|```|$)|\n\n\n)/);
    if (areasMatch && !code.includes('AREAS:')) {
        code += '\nAREAS:\n' + areasMatch[1];
    }

    // Extract DESCRIPTIONS section (may be outside the code block)
    const descMatch = mermaidCode.match(/DESCRIPTIONS:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (descMatch && !code.includes('DESCRIPTIONS:')) {
        code += '\nDESCRIPTIONS:\n' + descMatch[1];
    }

    const result = parseMermaidER(code);
    const validation = validateEntities(result.entities);

    return {
        entities: result.entities,
        relationships: result.relationships,
        seedingInstructions: result.seedingInstructions,
        areas: result.areas || {},
        descriptions: result.descriptions || {},
        validation
    };
}

/**
 * Find next available port
 */
function findNextPort() {
    let maxPort = MIN_PORT - 1;

    if (!fs.existsSync(SYSTEMS_DIR)) {
        return MIN_PORT;
    }

    const systems = fs.readdirSync(SYSTEMS_DIR);
    for (const system of systems) {
        const configPath = path.join(SYSTEMS_DIR, system, 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (config.port && config.port > maxPort) {
                    maxPort = config.port;
                }
            } catch (e) {
                // Ignore invalid configs
            }
        }
    }

    return Math.max(maxPort + 1, MIN_PORT);
}

/**
 * List existing systems
 */
function listSystems() {
    if (!fs.existsSync(SYSTEMS_DIR)) {
        return [];
    }

    const systems = [];
    const dirs = fs.readdirSync(SYSTEMS_DIR);

    for (const dir of dirs) {
        const configPath = path.join(SYSTEMS_DIR, dir, 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                systems.push({
                    name: dir,
                    displayName: config.pwa?.name || dir,
                    port: config.port
                });
            } catch (e) {
                systems.push({ name: dir, displayName: dir, port: null });
            }
        }
    }

    return systems;
}

/**
 * Generate complete system
 * @param {string} systemName - System name
 * @param {string} displayName - Display name
 * @param {string} description - System description
 * @param {Array} entities - Parsed entities
 * @param {Object} seedingInstructions - { EntityName: "instruction" }
 * @param {string} themeColor - Theme color hex
 * @param {Object} areas - { AreaName: { color: "#...", entities: [...] } }
 * @param {Object} descriptions - { EntityName: "description" }
 */
function generateSystem(systemName, displayName, description, entities, seedingInstructions, themeColor, areas = {}, descriptions = {}) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    // Check if already exists
    if (fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' already exists`);
    }

    const port = findNextPort();

    // Create directory structure
    const dirs = [
        systemDir,
        path.join(systemDir, 'data'),
        path.join(systemDir, 'data', 'seed'),
        path.join(systemDir, 'docs'),
        path.join(systemDir, 'docs', 'requirements'),
        path.join(systemDir, 'docs', 'requirements', 'classes'),
        path.join(systemDir, 'docs', 'requirements', 'ui'),
        path.join(systemDir, 'help')
    ];

    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Generate config.json
    const config = generateConfig(systemName, displayName, description, entities, port, themeColor);
    fs.writeFileSync(
        path.join(systemDir, 'config.json'),
        JSON.stringify(config, null, 2)
    );

    // Generate Crud.md (entity list for CRUD UI)
    const crudContent = generateCrudMd(entities);
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'ui', 'Crud.md'),
        crudContent
    );

    // Generate Views.md (empty, no views initially)
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'ui', 'Views.md'),
        '# Views\n'
    );

    // Generate entity class files
    for (const entity of entities) {
        const classContent = generateClassFile(entity, seedingInstructions[entity.name]);
        fs.writeFileSync(
            path.join(systemDir, 'docs', 'requirements', 'classes', `${entity.name}.md`),
            classContent
        );

        // Generate empty seed file
        fs.writeFileSync(
            path.join(systemDir, 'data', 'seed', `${entity.name}.json`),
            '[]'
        );
    }

    // Generate DataModel.md (with areas and descriptions)
    const dataModelContent = generateDataModel(entities, displayName, areas, descriptions);
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'DataModel.md'),
        dataModelContent
    );

    // Generate docs/index.md
    const docsIndexContent = generateDocsIndex(systemName, displayName, description, entities, port);
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'index.md'),
        docsIndexContent
    );

    // Generate help/index.md
    const helpContent = generateHelpIndex(displayName, description, entities);
    fs.writeFileSync(
        path.join(systemDir, 'help', 'index.md'),
        helpContent
    );

    return {
        systemDir,
        port,
        entityCount: entities.length,
        files: [
            'config.json',
            'docs/index.md',
            'docs/requirements/DataModel.md',
            'docs/requirements/ui/Crud.md',
            'docs/requirements/ui/Views.md',
            ...entities.map(e => `docs/requirements/classes/${e.name}.md`),
            ...entities.map(e => `data/seed/${e.name}.json`),
            'help/index.md'
        ]
    };
}

/**
 * Generate Crud.md content from entity list
 */
function generateCrudMd(entities) {
    let content = '# CRUD\n\n';
    for (const entity of entities) {
        content += `- ${entity.name}\n`;
    }
    return content;
}

/**
 * Generate config.json content
 */
function generateConfig(systemName, displayName, description, entities, port, themeColor) {
    const color = themeColor || '#2563eb';

    return {
        port,
        log_level: 'INFO',
        docsEditable: true,
        helpEditable: true,
        pwa: {
            enabled: true,
            name: `AIDE RAP [${systemName}]`,
            short_name: systemName,
            description: description || displayName,
            theme_color: color,
            background_color: '#f5f5f5',
            icon192: '/static/icons/icon-192.svg',
            icon512: '/static/icons/icon-512.svg',
            icon: {
                background: color,
                line1_text: 'aide',
                line1_color: '#94a3b8',
                line2_text: systemName.substring(0, 8),
                line2_color: '#ffffff',
                line2_size: 0.38
            }
        },
    };
}

/**
 * Generate entity class file content
 */
function generateClassFile(entity, seedingInstruction) {
    let content = `# ${entity.name}\n\n`;

    if (entity.isJunction) {
        content += `Junction table for many-to-many relationship.\n\n`;
    }

    content += `| Attribute | Type | Description | Example |\n`;
    content += `|-----------|------|-------------|----------|\n`;

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
        content += `| ${attr.name} | ${type} | ${desc} | ${example} |\n`;
    }

    if (seedingInstruction) {
        content += `\n## Data Generator\n\n${seedingInstruction}\n`;
    }

    return content;
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
 * Generate DataModel.md content
 * @param {Array} entities - Parsed entities
 * @param {string} displayName - System display name
 * @param {Object} areas - { AreaName: { color: "#...", entities: [...] } }
 * @param {Object} descriptions - { EntityName: "description" }
 */
function generateDataModel(entities, displayName, areas = {}, descriptions = {}) {
    let content = `# Data Model\n\n`;
    content += `![Data Model Diagram](/docs-assets/requirements/DataModel-diagram.svg)\n\n`;
    content += `## Entity Descriptions\n\n`;
    content += `Entity definitions are stored in separate files under [classes/](classes/).\n\n`;

    // Group by regular entities vs junction tables
    const regularEntities = entities.filter(e => !e.isJunction);
    const junctionEntities = entities.filter(e => e.isJunction);

    // Helper to get description for an entity
    const getDescription = (entityName) => {
        if (descriptions[entityName]) {
            return descriptions[entityName];
        }
        const entity = entities.find(e => e.name === entityName);
        return entity ? `${entity.attributes.length} attributes` : 'Entity definition';
    };

    // Check if we have areas defined
    if (Object.keys(areas).length > 0) {
        // Track which entities have been assigned to areas
        const assignedEntities = new Set();

        // Generate sections for each area
        for (const [areaName, areaData] of Object.entries(areas)) {
            // Filter to only include regular entities in this area
            const areaEntities = areaData.entities.filter(name => {
                const entity = regularEntities.find(e => e.name === name);
                if (entity) {
                    assignedEntities.add(name);
                    return true;
                }
                return false;
            });

            if (areaEntities.length > 0) {
                content += `### ${areaName}\n`;
                content += `<div style="background-color: ${areaData.color}; padding: 10px;">\n\n`;
                content += `| Entity | Description |\n`;
                content += `|--------|-------------|\n`;

                for (const entityName of areaEntities) {
                    content += `| [${entityName}](classes/${entityName}.md) | ${getDescription(entityName)} |\n`;
                }

                content += `</div>\n\n`;
            }
        }

        // Add any unassigned regular entities to a default area
        const unassignedEntities = regularEntities.filter(e => !assignedEntities.has(e.name));
        if (unassignedEntities.length > 0) {
            content += `### ${displayName}\n`;
            content += `<div style="background-color: #E8F4E8; padding: 10px;">\n\n`;
            content += `| Entity | Description |\n`;
            content += `|--------|-------------|\n`;

            for (const entity of unassignedEntities) {
                content += `| [${entity.name}](classes/${entity.name}.md) | ${getDescription(entity.name)} |\n`;
            }

            content += `</div>\n\n`;
        }
    } else {
        // No areas defined - use single default area
        content += `### ${displayName}\n`;
        content += `<div style="background-color: #E8F4E8; padding: 10px;">\n\n`;
        content += `| Entity | Description |\n`;
        content += `|--------|-------------|\n`;

        for (const entity of regularEntities) {
            content += `| [${entity.name}](classes/${entity.name}.md) | ${getDescription(entity.name)} |\n`;
        }

        content += `</div>\n\n`;
    }

    // Junction tables always get their own section
    if (junctionEntities.length > 0) {
        content += `### Junction Tables\n`;
        content += `<div style="background-color: #FEF3C7; padding: 10px;">\n\n`;
        content += `| Entity | Description |\n`;
        content += `|--------|-------------|\n`;

        for (const entity of junctionEntities) {
            content += `| [${entity.name}](classes/${entity.name}.md) | ${getDescription(entity.name) || 'Many-to-many junction'} |\n`;
        }

        content += `</div>\n\n`;
    }

    content += `## Class Diagram\n\n`;
    content += `![Data Model Diagram (Detailed)](/docs-assets/requirements/DataModel-diagram-detailed.svg)\n\n`;
    content += `<a href="/layout-editor?doc=DataModel" target="_blank"><button type="button">Edit Layout</button></a>\n\n`;
    content += `---\n\n`;
    content += `*Model generated with [Model Builder](/#model-builder). See [Design Brief](../design.md) for original requirements.*\n`;

    return content;
}

/**
 * Generate docs/index.md content
 */
function generateDocsIndex(systemName, displayName, description, entities, port) {
    let content = `# ${displayName} - Data Model Documentation\n\n`;
    content += `${description}\n\n`;
    content += `> *Generated by AIDE RAP Model Builder*\n\n`;
    content += `---\n\n`;
    content += `## Overview\n\n`;
    content += `This system contains ${entities.length} entities:\n\n`;

    for (const entity of entities) {
        const attrCount = entity.attributes.length;
        content += `- **${entity.name}** – ${attrCount} attribute${attrCount !== 1 ? 's' : ''}\n`;
    }

    content += `\n---\n\n`;
    content += `## Quick Links\n\n`;
    content += `| Link | Description |\n`;
    content += `|------|-------------|\n`;
    content += `| **[Data Model →](requirements/DataModel.md)** | Entity definitions |\n`;
    content += `| **[RAP Platform Docs →](/rap)** | How the RAP engine works |\n`;
    content += `| **[User Guide →](/help)** | How to use the application |\n`;
    content += `\n---\n\n`;
    content += `## Getting Started\n\n`;
    content += `1. Start the system: \`./run -s ${systemName}\`\n`;
    content += `2. Navigate to http://localhost:${port}\n`;
    content += `3. Use the entity selector to browse data\n`;
    content += `4. Create records using the form panel\n`;

    return content;
}

/**
 * Generate help/index.md content
 */
function generateHelpIndex(displayName, description, entities) {
    let content = `# ${displayName} - User Guide\n\n`;
    content += `${description}\n\n`;
    content += `## Entities\n\n`;

    for (const entity of entities) {
        content += `### ${entity.name}\n`;
        for (const attr of entity.attributes) {
            const labelInfo = attr.label ? ' (display label)' : (attr.label2 ? ' (secondary label)' : '');
            content += `- **${attr.name}**: ${attr.description || attr.type}${labelInfo}\n`;
        }
        content += `\n`;
    }

    content += `## Quick Start\n\n`;

    // Find entities without FKs (can be created first)
    const rootEntities = entities.filter(e =>
        !e.attributes.some(a => a.foreignKey)
    );
    const dependentEntities = entities.filter(e =>
        e.attributes.some(a => a.foreignKey)
    );

    let step = 1;
    if (rootEntities.length > 0) {
        content += `${step}. Create ${rootEntities.map(e => e.name).join(', ')} records first (no dependencies)\n`;
        step++;
    }
    if (dependentEntities.length > 0) {
        content += `${step}. Create ${dependentEntities.map(e => e.name).join(', ')} records and link to existing records\n`;
        step++;
    }
    content += `${step}. Use the Tree View to explore relationships\n`;

    return content;
}

/**
 * Create minimal system directory (Tab 1 - immediate persistence)
 * Only creates config.json and directory structure, no entity files yet
 */
function createMinimalSystem(systemName, displayName, description, themeColor) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    // Check if already exists
    if (fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' already exists`);
    }

    const port = findNextPort();

    // Create directory structure
    const dirs = [
        systemDir,
        path.join(systemDir, 'data'),
        path.join(systemDir, 'data', 'seed'),
        path.join(systemDir, 'docs'),
        path.join(systemDir, 'docs', 'requirements'),
        path.join(systemDir, 'docs', 'requirements', 'classes'),
        path.join(systemDir, 'docs', 'requirements', 'ui'),
        path.join(systemDir, 'help')
    ];

    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Generate minimal config.json (no entities yet)
    const config = {
        port,
        log_level: 'INFO',
        docsEditable: true,
        helpEditable: true,
        pwa: {
            enabled: true,
            name: `AIDE RAP [${systemName}]`,
            short_name: systemName,
            description: description || displayName,
            theme_color: themeColor || '#2563eb',
            background_color: '#f5f5f5',
            icon192: '/static/icons/icon-192.svg',
            icon512: '/static/icons/icon-512.svg',
            icon: {
                background: themeColor || '#2563eb',
                line1_text: 'aide',
                line1_color: '#94a3b8',
                line2_text: systemName.substring(0, 8),
                line2_color: '#ffffff',
                line2_size: 0.38
            }
        }
    };

    fs.writeFileSync(
        path.join(systemDir, 'config.json'),
        JSON.stringify(config, null, 2)
    );

    // Generate empty Crud.md and Views.md
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'ui', 'Crud.md'),
        '# CRUD\n'
    );
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'ui', 'Views.md'),
        '# Views\n'
    );

    return {
        systemDir,
        port,
        created: true
    };
}

/**
 * Save design brief to docs/design.md
 */
function saveDesignBrief(systemName, designBrief) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    if (!fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' does not exist`);
    }

    // Save to docs/ folder so it's accessible via docs server
    const designPath = path.join(systemDir, 'docs', 'design.md');
    const content = `# Design Brief\n\n${designBrief}\n`;
    fs.writeFileSync(designPath, content);

    return { saved: true };
}

/**
 * Load system state (config, design brief, existing entities)
 */
function loadSystemState(systemName) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    if (!fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' does not exist`);
    }

    // Load config
    const configPath = path.join(systemDir, 'config.json');
    let config = null;
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    // Load design brief (check docs/ first, then root for backward compatibility)
    const newDesignPath = path.join(systemDir, 'docs', 'design.md');
    const oldDesignPath = path.join(systemDir, 'design.md');
    const designPath = fs.existsSync(newDesignPath) ? newDesignPath : oldDesignPath;
    let designBrief = '';
    if (fs.existsSync(designPath)) {
        const content = fs.readFileSync(designPath, 'utf-8');
        // Extract content after "# Design Brief\n\n"
        const match = content.match(/^# Design Brief\s*\n\n([\s\S]*)$/);
        designBrief = match ? match[1].trim() : content;
    }

    // List existing entities
    const classesDir = path.join(systemDir, 'docs', 'requirements', 'classes');
    let existingEntities = [];
    if (fs.existsSync(classesDir)) {
        existingEntities = fs.readdirSync(classesDir)
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
    }

    return {
        config,
        designBrief,
        existingEntities,
        displayName: config?.pwa?.name || systemName,
        description: config?.pwa?.description || '',
        themeColor: config?.pwa?.theme_color || '#2563eb',
        port: config?.port
    };
}

/**
 * Import entities with mode option
 * @param {string} systemName - System name
 * @param {Array} entities - Parsed entities
 * @param {Object} seedingInstructions - { EntityName: "instruction" }
 * @param {string} mode - 'replace' | 'merge-ignore' | 'merge-replace'
 * @param {Object} areas - { AreaName: { color: "#...", entities: [...] } }
 * @param {Object} descriptions - { EntityName: "description" }
 */
function importEntities(systemName, entities, seedingInstructions, mode, areas = {}, descriptions = {}) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    if (!fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' does not exist`);
    }

    const classesDir = path.join(systemDir, 'docs', 'requirements', 'classes');
    const seedDir = path.join(systemDir, 'data', 'seed');

    // Ensure directories exist
    fs.mkdirSync(classesDir, { recursive: true });
    fs.mkdirSync(seedDir, { recursive: true });

    // Get existing entities
    let existingEntities = [];
    if (fs.existsSync(classesDir)) {
        existingEntities = fs.readdirSync(classesDir)
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
    }

    const imported = [];
    const skipped = [];
    const replaced = [];

    if (mode === 'replace') {
        // Delete all existing class files
        for (const existing of existingEntities) {
            fs.unlinkSync(path.join(classesDir, `${existing}.md`));
        }
        replaced.push(...existingEntities);
    }

    // Import new entities
    for (const entity of entities) {
        const entityExists = existingEntities.includes(entity.name);

        if (entityExists && mode === 'merge-ignore') {
            skipped.push(entity.name);
            continue;
        }

        if (entityExists && mode === 'merge-replace') {
            replaced.push(entity.name);
        }

        // Generate class file
        const classContent = generateClassFile(entity, seedingInstructions[entity.name]);
        fs.writeFileSync(
            path.join(classesDir, `${entity.name}.md`),
            classContent
        );

        // Generate empty seed file if it doesn't exist
        const seedPath = path.join(seedDir, `${entity.name}.json`);
        if (!fs.existsSync(seedPath)) {
            fs.writeFileSync(seedPath, '[]');
        }

        imported.push(entity.name);
    }

    // Get final entity list from classes directory
    const finalEntities = fs.readdirSync(classesDir)
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace('.md', ''));

    // Update Crud.md with entity list
    const uiDir = path.join(systemDir, 'docs', 'requirements', 'ui');
    fs.mkdirSync(uiDir, { recursive: true });
    const crudContent = generateCrudMd(finalEntities.map(name => ({ name })));
    fs.writeFileSync(path.join(uiDir, 'Crud.md'), crudContent);

    // Ensure Views.md exists
    const viewsMdPath = path.join(uiDir, 'Views.md');
    if (!fs.existsSync(viewsMdPath)) {
        fs.writeFileSync(viewsMdPath, '# Views\n');
    }

    // Load config for metadata
    const configPath = path.join(systemDir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Regenerate DataModel.md (with areas and descriptions)
    const allEntities = entities.filter(e => finalEntities.includes(e.name));
    const displayName = config.pwa?.name || systemName;
    const dataModelContent = generateDataModel(allEntities, displayName, areas, descriptions);
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'requirements', 'DataModel.md'),
        dataModelContent
    );

    // Regenerate docs/index.md
    const description = config.pwa?.description || displayName;
    const docsIndexContent = generateDocsIndex(systemName, displayName, description, allEntities, config.port);
    fs.writeFileSync(
        path.join(systemDir, 'docs', 'index.md'),
        docsIndexContent
    );

    // Regenerate help/index.md
    const helpContent = generateHelpIndex(displayName, description, allEntities);
    fs.writeFileSync(
        path.join(systemDir, 'help', 'index.md'),
        helpContent
    );

    return {
        imported,
        skipped,
        replaced,
        totalEntities: finalEntities.length
    };
}

/**
 * Delete a system completely
 * Removes the entire system directory and all contents
 */
function deleteSystem(systemName) {
    const systemDir = path.join(SYSTEMS_DIR, systemName);

    if (!fs.existsSync(systemDir)) {
        throw new Error(`System '${systemName}' does not exist`);
    }

    // Safety check: ensure we're deleting from systems directory
    const resolvedPath = path.resolve(systemDir);
    const resolvedSystems = path.resolve(SYSTEMS_DIR);
    if (!resolvedPath.startsWith(resolvedSystems + path.sep)) {
        throw new Error('Invalid system path');
    }

    // Remove directory recursively
    fs.rmSync(systemDir, { recursive: true, force: true });

    return {
        deleted: true,
        systemName
    };
}

module.exports = {
    buildPrompt,
    parseResponse,
    generateSystem,
    listSystems,
    findNextPort,
    createMinimalSystem,
    saveDesignBrief,
    loadSystemState,
    importEntities,
    deleteSystem
};
