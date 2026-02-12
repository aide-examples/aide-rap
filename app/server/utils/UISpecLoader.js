/**
 * UISpecLoader — Read CRUD, Views, and Processes configuration from Markdown files.
 *
 * Looks for `docs/Crud.md`, `docs/views/{Area}/{ViewName}.md`,
 * and `docs/processes/{Area}/{ProcessName}.md`.
 *
 * Crud.md format:
 *   # CRUD
 *   ## Section Name        → section separator
 *   - EntityName           → entity entry
 *
 * View file format (one file per view in docs/views/{Area}/{ViewName}.md):
 *   # View Name            → view name (or inferred from filename)
 *   ```json                → view definition (base, columns)
 *   { "base": "...", "columns": [...] }
 *   ```
 *   ```js                  → optional calculator (client-side JS)
 *   schema.columns.push({ key: 'x', label: 'X', type: 'number' });
 *   for (const row of data) { row.x = ...; }
 *   ```
 *
 * Process file format (one file per process in docs/processes/{Area}/{ProcessName}.md):
 *   # Process Name         → process name
 *   Required: Entity:select → optional initial object selection
 *   Description text...    → process description (before first ##)
 *   ## Step Title           → step tab
 *   Step markdown text...   → step content (rendered with marked)
 *   View: ViewName          → optional directive → action button
 *   Entity: EntityName      → optional directive → action button
 *
 * Area = subdirectory name (used as section separator)
 */

const fs = require('fs');
const path = require('path');

const SEPARATOR_PREFIX = '-------------------- ';
const COLUMN_BREAK = '===COLUMN_BREAK===';

/**
 * Load CRUD entity list from Crud.md.
 * Supports optional options in parentheses:
 *   - `- EntityName (prefilter: field1, field2)` — optional filter dialog when large
 *   - `- EntityName (required: field1)` — always show filter dialog
 *   - `- EntityName (required: field1:select)` — always show filter dialog with dropdown
 *   - `- EntityName (required: field1, prefilter: field2)` — both
 *   - `- EntityName (mediaRowHeight: 100)` — row height for rows with media
 *   - `- EntityName (sort: column_name)` — default sort ascending
 *   - `- EntityName (sort: column_name DESC)` — default sort descending
 * Field suffix `:select` = dropdown, no suffix = text input (LIKE)
 * @param {string} requirementsDir - Path to requirements/ directory
 * @returns {{entities: string[], prefilters: Object, requiredFilters: Object, tableOptions: Object}|null}
 */
function loadCrudConfig(requirementsDir) {
  const mdPath = path.join(requirementsDir, 'Crud.md');
  if (!fs.existsSync(mdPath)) return null;

  let content = fs.readFileSync(mdPath, 'utf-8');

  // Remove HTML comments before parsing (they may contain example entries)
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const entities = [];
  const prefilters = {}; // { entityName: ['field1', 'field2:select'] }
  const requiredFilters = {}; // { entityName: ['field1', 'field2:select'] }
  const tableOptions = {}; // { entityName: { mediaRowHeight: 100 } }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Horizontal rule = column break
    if (/^-{3,}$/.test(trimmed)) {
      entities.push(COLUMN_BREAK);
      continue;
    }

    // H2 = section separator
    if (trimmed.startsWith('## ')) {
      entities.push(SEPARATOR_PREFIX + trimmed.substring(3).trim());
      continue;
    }

    // Bullet item = entity name, optionally with options in parentheses
    if (trimmed.startsWith('- ')) {
      let entityPart = trimmed.substring(2).trim();

      // Check for options in parentheses: `- EntityName (option: values, ...)`
      const parenMatch = entityPart.match(/^(.+?)\s*\((.+)\)$/);
      if (parenMatch) {
        const entityName = parenMatch[1].trim();
        const optionsStr = parenMatch[2];

        // Parse options: "required: field1:select, prefilter: field2, mediaRowHeight: 100, sort: column DESC"
        // Split by known keywords
        const requiredMatch = optionsStr.match(/required:\s*([^,)]+(?:,\s*[^,)]+)*?)(?=,\s*(?:prefilter:|mediaRowHeight:|sort:|$)|$)/i);
        const prefilterMatch = optionsStr.match(/prefilter:\s*([^,)]+(?:,\s*[^,)]+)*?)(?=,\s*(?:required:|mediaRowHeight:|sort:|$)|$)/i);
        const mediaRowHeightMatch = optionsStr.match(/mediaRowHeight:\s*(\d+)/i);
        const sortMatch = optionsStr.match(/sort:\s*(\w+)(?:\s+(asc|desc))?/i);

        if (entityName) {
          entities.push(entityName);

          if (requiredMatch) {
            // Allow field:select syntax - only exclude standalone colons (like "required:")
            const fields = requiredMatch[1].split(',').map(f => f.trim()).filter(f => f && f !== ':');
            if (fields.length > 0) {
              requiredFilters[entityName] = fields;
            }
          }

          if (prefilterMatch) {
            // Allow field:select syntax - only exclude standalone colons
            const fields = prefilterMatch[1].split(',').map(f => f.trim()).filter(f => f && f !== ':');
            if (fields.length > 0) {
              prefilters[entityName] = fields;
            }
          }

          if (mediaRowHeightMatch) {
            if (!tableOptions[entityName]) tableOptions[entityName] = {};
            tableOptions[entityName].mediaRowHeight = parseInt(mediaRowHeightMatch[1], 10);
          }

          if (sortMatch) {
            if (!tableOptions[entityName]) tableOptions[entityName] = {};
            tableOptions[entityName].defaultSort = {
              column: sortMatch[1],
              order: (sortMatch[2] || 'asc').toLowerCase()
            };
          }
        }
      } else if (entityPart) {
        entities.push(entityPart);
      }
    }
  }

  return { entities, prefilters, requiredFilters, tableOptions };
}

/**
 * Parse a single view file.
 * @param {string} content - File content
 * @param {string} filename - Filename (used as fallback for view name)
 * @returns {Object|null} View definition object or null if invalid
 */
function parseViewFile(content, filename) {
  // Remove HTML comments before parsing
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const lines = content.split('\n');
  let name = null;
  let description = null;
  let collectDesc = false;
  let jsonBlock = null;
  let detailBlock = null;
  let jsBlock = null;
  let inJson = false;
  let inDetail = false;
  let inJs = false;
  let blockContent = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // H1 = View Name
    if (trimmed.startsWith('# ') && !name) {
      name = trimmed.substring(2).trim();
      collectDesc = true;
    } else if (collectDesc && trimmed && !inJson && !inDetail && !inJs) {
      if (trimmed.startsWith('```')) {
        // Don't consume fence as description — fall through
        collectDesc = false;
      } else {
        description = trimmed;
        collectDesc = false;
      }
    }

    if (trimmed === '```json') {
      inJson = true;
      blockContent = [];
    } else if (trimmed === '```detail') {
      inDetail = true;
      blockContent = [];
    } else if (trimmed === '```js') {
      inJs = true;
      blockContent = [];
    } else if (trimmed === '```') {
      if (inJson) {
        jsonBlock = blockContent.join('\n');
        inJson = false;
      } else if (inDetail) {
        detailBlock = blockContent;
        inDetail = false;
      } else if (inJs) {
        jsBlock = blockContent.join('\n');
        inJs = false;
      }
    } else if (inJson || inDetail || inJs) {
      blockContent.push(line);
    }
  }

  // Detail view (```detail block)
  if (detailBlock) {
    const template = parseDetailTemplate(detailBlock);
    if (!template) {
      console.error(`Failed to parse detail template in ${filename}`);
      return null;
    }
    const viewDef = {
      name: name || filename.replace('.md', ''),
      base: template.base,
      detail: true,
      template
    };
    if (description) viewDef.description = description;
    return viewDef;
  }

  if (!jsonBlock) return null;

  try {
    const viewDef = JSON.parse(jsonBlock);
    viewDef.name = name || filename.replace('.md', '');
    if (description) viewDef.description = description;
    if (jsBlock && jsBlock.trim()) {
      viewDef.calculator = jsBlock.trim();
    }
    return viewDef;
  } catch (e) {
    console.error(`Failed to parse view ${filename}: ${e.message}`);
    return null;
  }
}

/**
 * Parse a detail template block into a tree structure.
 *
 * Syntax:
 *   base: EntityName
 *   : attr1, attr2              → root attributes
 *   EngineAllocation(ORDER BY start_date DESC, LIMIT 5): start_date, aircraft
 *     aircraft: registration, type
 *   current_lessor: name, country
 *
 * - PascalCase (first char uppercase) = back-reference entity
 * - snake_case (first char lowercase) = FK field on parent
 * - (params) = query params for back-refs (ORDER BY, LIMIT, WHERE)
 * - : attr1, attr2 = visible attributes (omit for all)
 * - Indentation (2 spaces) = nesting depth
 *
 * @param {string[]} lines - Lines from the detail block
 * @returns {Object|null} Parsed template { base, rootAttributes, children }
 */
function parseDetailTemplate(lines) {
  let base = null;
  let rootAttributes = null;
  const rootChildren = [];

  // Stack for tracking parent nodes at each indentation level
  // stack[depth] = children array to push into
  const stack = [rootChildren];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // base: EntityName
    const baseMatch = line.match(/^\s*base:\s*(\w+)\s*$/);
    if (baseMatch) {
      base = baseMatch[1];
      continue;
    }

    // Determine indentation level (2 spaces per level)
    const leadingSpaces = line.match(/^(\s*)/)[1].length;
    const depth = Math.floor(leadingSpaces / 2);
    const trimmed = line.trim();

    // Root attributes line: ": attr1, attr2"
    if (trimmed.startsWith(':') && depth === 0) {
      rootAttributes = trimmed.substring(1).split(',').map(a => a.trim()).filter(Boolean);
      continue;
    }

    // Parse node line: "Name(params): attr1, attr2" or "Name: attr1, attr2" or "Name(params)" or "Name"
    const nodeMatch = trimmed.match(/^(\w+)(?:\(([^)]*)\))?(?:\s*:\s*(.+))?$/);
    if (!nodeMatch) continue;

    const nodeName = nodeMatch[1];
    const params = nodeMatch[2] || null;
    const attrStr = nodeMatch[3] || null;
    const attributes = attrStr ? attrStr.split(',').map(a => a.trim()).filter(Boolean) : null;

    // PascalCase (starts with uppercase) = back-reference, snake_case = FK field
    const isPascal = nodeName[0] === nodeName[0].toUpperCase() && nodeName[0] !== nodeName[0].toLowerCase();
    const node = isPascal
      ? { type: 'backref', entity: nodeName, params, attributes, children: [] }
      : { type: 'fk', field: nodeName, params: null, attributes, children: [] };

    // Find correct parent level
    // Nodes at depth 1 go into rootChildren (stack[0]),
    // nodes at depth 2 go into the last depth-1 node's children (stack[1]), etc.
    while (stack.length > depth) stack.pop();

    const parentChildren = stack[stack.length - 1];
    parentChildren.push(node);

    // Push this node's children array for potential sub-nodes
    stack.push(node.children);
  }

  if (!base) return null;

  return { base, rootAttributes, children: rootChildren };
}

/**
 * Parse a layout markdown file for area ordering and column breaks.
 * Recognizes `## AreaName` for area ordering and `---` for column breaks.
 * @param {string} filePath - Path to layout .md file (e.g. Views.md)
 * @returns {{areas: string[], breaks: Set<number>}|null} areas in order, breaks = indices where column breaks occur
 */
function parseLayoutFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const areas = [];
  const breaks = new Set();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^-{3,}$/.test(trimmed)) {
      breaks.add(areas.length); // break before next area
    } else if (trimmed.startsWith('## ')) {
      areas.push(trimmed.substring(3).trim());
    }
  }

  return areas.length > 0 ? { areas, breaks } : null;
}

/**
 * Load view files for a single area directory.
 * @param {string} areaDir - Path to area subdirectory
 * @returns {Object[]} Array of parsed view definitions
 */
function loadAreaViews(areaDir) {
  const viewFiles = fs.readdirSync(areaDir)
    .filter(f => f.endsWith('.md'))
    .sort();
  const views = [];
  for (const file of viewFiles) {
    const content = fs.readFileSync(path.join(areaDir, file), 'utf-8');
    const viewDef = parseViewFile(content, file);
    if (viewDef) views.push(viewDef);
  }
  return views;
}

/**
 * Load view definitions from docs/views/{Area}/{ViewName}.md files.
 * Uses Views.md (if present) for area ordering and column breaks.
 * @param {string} requirementsDir - Path to docs/ directory
 * @returns {Array|null} Array of view objects, separator strings, and COLUMN_BREAK markers
 */
function loadViewsConfig(requirementsDir) {
  const viewsDir = path.join(requirementsDir, 'views');

  if (!fs.existsSync(viewsDir)) {
    return null;
  }

  const result = [];

  // All area directories on disk
  const diskAreas = fs.readdirSync(viewsDir)
    .filter(f => fs.statSync(path.join(viewsDir, f)).isDirectory())
    .sort();

  const layout = parseLayoutFile(path.join(requirementsDir, 'Views.md'));

  // Determine area order: layout file or alphabetical fallback
  const orderedAreas = layout
    ? [...layout.areas, ...diskAreas.filter(a => !layout.areas.includes(a))]
    : diskAreas;

  let areaIndex = 0;
  for (const area of orderedAreas) {
    const areaDir = path.join(viewsDir, area);
    if (!fs.existsSync(areaDir) || !fs.statSync(areaDir).isDirectory()) continue;

    const views = loadAreaViews(areaDir);
    if (views.length === 0) continue;

    // Insert column break if layout says so
    if (layout && layout.breaks.has(areaIndex)) {
      result.push(COLUMN_BREAK);
    }

    result.push(SEPARATOR_PREFIX + area);
    result.push(...views);
    areaIndex++;
  }

  return result.length > 0 ? result : null;
}

/**
 * Parse a single process file.
 * Extracts: name (H1), required directive, description (text before first H2),
 * steps (H2 sections with body text, View/Entity directives).
 * @param {string} content - File content
 * @param {string} filename - Filename (used as fallback for process name)
 * @returns {Object|null} Process definition or null if invalid
 */
function parseProcessFile(content, filename) {
  // Remove HTML comments before parsing
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const lines = content.split('\n');
  let name = null;
  let required = null;
  let workflow = null;
  let descriptionLines = [];
  let steps = [];
  let currentStep = null;
  let foundFirstH2 = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // H1 = Process Name
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ') && !name) {
      name = trimmed.substring(2).trim();
      continue;
    }

    // Required directive (before first H2)
    if (!foundFirstH2 && /^Required:\s*(.+)$/i.test(trimmed)) {
      required = trimmed.match(/^Required:\s*(.+)$/i)[1].trim();
      continue;
    }

    // Workflow directives: Leap: or Power: (before first H2)
    const wfMatch = !foundFirstH2 && trimmed.match(/^(Leap|Power):\s*(.+)$/i);
    if (wfMatch) {
      workflow = wfMatch[1].toLowerCase() + ':' + wfMatch[2].trim();
      continue;
    }

    // H2 = Step
    if (trimmed.startsWith('## ')) {
      foundFirstH2 = true;
      if (currentStep) steps.push(currentStep);
      currentStep = { title: trimmed.substring(3).trim(), bodyLines: [], view: null, entities: [], call: null, select: null };
      continue;
    }

    if (!foundFirstH2) {
      // Before first H2 = description
      if (name) descriptionLines.push(line);
    } else if (currentStep) {
      // Inside a step — check for directives
      const viewMatch = trimmed.match(/^View:\s*(.+?)(?:\((\w+)\))?$/i);
      const entityMatch = trimmed.match(/^Entity:\s*(.+)$/i);
      const callMatch = trimmed.match(/^Call:\s*(.+)$/i);
      const selectMatch = trimmed.match(/^Select:\s*(.+)$/i);
      if (viewMatch) {
        currentStep.view = viewMatch[1].trim();
        if (viewMatch[2]) currentStep.viewContext = viewMatch[2];
      } else if (entityMatch) {
        currentStep.entities.push(entityMatch[1].trim());
      } else if (callMatch) {
        currentStep.call = callMatch[1].trim();
      } else if (selectMatch) {
        currentStep.select = selectMatch[1].trim();
      } else {
        currentStep.bodyLines.push(line);
      }
    }
  }

  // Push last step
  if (currentStep) steps.push(currentStep);

  if (!name && steps.length === 0) return null;

  // Clean up: trim trailing empty lines from body, join into string
  const trimBody = (lines) => {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    return lines.join('\n');
  };

  return {
    name: name || filename.replace('.md', ''),
    required,
    workflow,
    description: trimBody(descriptionLines),
    steps: steps.map(s => ({
      title: s.title,
      body: trimBody(s.bodyLines),
      view: s.view,
      viewContext: s.viewContext || null,
      entities: s.entities,
      call: s.call,
      select: s.select || null
    }))
  };
}

/**
 * Reconstruct a markdown process file from a parsed process object.
 * Inverse of parseProcessFile() — used for saving edits back to disk.
 * @param {Object} process - { name, required, description, steps: [{ title, body, view, entities[], call }] }
 * @returns {string} Markdown content
 */
function reconstructProcessFile(process) {
  const lines = [];

  lines.push(`# ${process.name}`);
  lines.push('');

  if (process.required) {
    lines.push(`Required: ${process.required}`);
    lines.push('');
  }

  if (process.workflow) {
    const [wfType, ...wfRest] = process.workflow.split(':');
    const wfKeyword = wfType === 'power' ? 'Power' : 'Leap';
    lines.push(`${wfKeyword}: ${wfRest.join(':')}`);
    lines.push('');
  }

  if (process.description) {
    lines.push(process.description);
    lines.push('');
  }

  for (const step of (process.steps || [])) {
    lines.push(`## ${step.title}`);
    lines.push('');

    if (step.body) {
      lines.push(step.body);
      lines.push('');
    }

    for (const entity of (step.entities || [])) {
      lines.push(`Entity: ${entity}`);
    }
    if (step.view) {
      const viewCtx = step.viewContext ? `(${step.viewContext})` : '';
      lines.push(`View: ${step.view}${viewCtx}`);
    }
    if (step.call) {
      lines.push(`Call: ${step.call}`);
    }
    if (step.select) {
      lines.push(`Select: ${step.select}`);
    }

    // Add blank line after directives (if any were written)
    const hasDirectives = (step.entities && step.entities.length > 0) || step.view || step.call || step.select;
    if (hasDirectives) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Load process files for a single area directory.
 * @param {string} areaDir - Path to area subdirectory
 * @param {string} areaName - Name of the area (directory name)
 * @returns {Object[]} Array of parsed process definitions
 */
function loadAreaProcesses(areaDir, areaName) {
  const processFiles = fs.readdirSync(areaDir)
    .filter(f => f.endsWith('.md'))
    .sort();
  const processes = [];
  for (const file of processFiles) {
    const content = fs.readFileSync(path.join(areaDir, file), 'utf-8');
    const processDef = parseProcessFile(content, file);
    if (processDef) {
      processDef._sourceFile = path.join('processes', areaName, file);
      processDef._area = areaName;
      processes.push(processDef);
    }
  }
  return processes;
}

/**
 * Load process definitions from docs/processes/{Area}/{ProcessName}.md files.
 * Uses Processes.md (if present) for area ordering and column breaks.
 * @param {string} requirementsDir - Path to docs/ directory
 * @returns {Array|null} Array of process objects, separator strings, and COLUMN_BREAK markers
 */
function loadProcessesConfig(requirementsDir) {
  const processesDir = path.join(requirementsDir, 'processes');

  if (!fs.existsSync(processesDir)) {
    return null;
  }

  const result = [];

  // All area directories on disk
  const diskAreas = fs.readdirSync(processesDir)
    .filter(f => fs.statSync(path.join(processesDir, f)).isDirectory())
    .sort();

  const layout = parseLayoutFile(path.join(requirementsDir, 'Processes.md'));

  // Determine area order: layout file or alphabetical fallback
  const orderedAreas = layout
    ? [...layout.areas, ...diskAreas.filter(a => !layout.areas.includes(a))]
    : diskAreas;

  let areaIndex = 0;
  for (const area of orderedAreas) {
    const areaDir = path.join(processesDir, area);
    if (!fs.existsSync(areaDir) || !fs.statSync(areaDir).isDirectory()) continue;

    const processes = loadAreaProcesses(areaDir, area);
    if (processes.length === 0) continue;

    // Insert column break if layout says so
    if (layout && layout.breaks.has(areaIndex)) {
      result.push(COLUMN_BREAK);
    }

    result.push(SEPARATOR_PREFIX + area);
    result.push(...processes);
    areaIndex++;
  }

  return result.length > 0 ? result : null;
}

module.exports = { loadCrudConfig, loadViewsConfig, loadProcessesConfig, reconstructProcessFile, parseProcessFile, SEPARATOR_PREFIX, COLUMN_BREAK };
