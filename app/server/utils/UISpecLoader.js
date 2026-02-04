/**
 * UISpecLoader — Read CRUD and Views configuration from Markdown files.
 *
 * Looks for `docs/Crud.md` and `docs/views/{Area}/{ViewName}.md`.
 * Returns the same data structures as the old config.json format.
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
 * Area = subdirectory name (used as section separator)
 */

const fs = require('fs');
const path = require('path');

const SEPARATOR_PREFIX = '-------------------- ';

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
  let jsonBlock = null;
  let jsBlock = null;
  let inJson = false;
  let inJs = false;
  let blockContent = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // H1 = View Name
    if (trimmed.startsWith('# ') && !name) {
      name = trimmed.substring(2).trim();
    } else if (trimmed === '```json') {
      inJson = true;
      blockContent = [];
    } else if (trimmed === '```js') {
      inJs = true;
      blockContent = [];
    } else if (trimmed === '```') {
      if (inJson) {
        jsonBlock = blockContent.join('\n');
        inJson = false;
      } else if (inJs) {
        jsBlock = blockContent.join('\n');
        inJs = false;
      }
    } else if (inJson || inJs) {
      blockContent.push(line);
    }
  }

  if (!jsonBlock) return null;

  try {
    const viewDef = JSON.parse(jsonBlock);
    viewDef.name = name || filename.replace('.md', '');
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
 * Load view definitions from docs/views/{Area}/{ViewName}.md files.
 * @param {string} requirementsDir - Path to docs/ directory
 * @returns {Array|null} Array of view objects and separator strings, or null if not found
 */
function loadViewsConfig(requirementsDir) {
  const viewsDir = path.join(requirementsDir, 'views');

  if (!fs.existsSync(viewsDir)) {
    return null;
  }

  const result = [];

  // Scan area subdirectories (sorted alphabetically)
  const areas = fs.readdirSync(viewsDir)
    .filter(f => {
      const fullPath = path.join(viewsDir, f);
      return fs.statSync(fullPath).isDirectory();
    })
    .sort();

  for (const area of areas) {
    const areaDir = path.join(viewsDir, area);
    const viewFiles = fs.readdirSync(areaDir)
      .filter(f => f.endsWith('.md'))
      .sort();

    if (viewFiles.length === 0) continue;

    // Section separator for this area
    result.push(SEPARATOR_PREFIX + area);

    for (const file of viewFiles) {
      const content = fs.readFileSync(path.join(areaDir, file), 'utf-8');
      const viewDef = parseViewFile(content, file);
      if (viewDef) {
        result.push(viewDef);
      }
    }
  }

  return result.length > 0 ? result : null;
}

module.exports = { loadCrudConfig, loadViewsConfig };
