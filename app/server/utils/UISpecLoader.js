/**
 * UISpecLoader — Read CRUD and Views configuration from Markdown files.
 *
 * Looks for `requirements/ui/Crud.md` and `requirements/ui/Views.md`.
 * Returns the same data structures as the old config.json format.
 *
 * Crud.md format:
 *   # CRUD
 *   ## Section Name        → section separator
 *   - EntityName           → entity entry
 *
 * Views.md format:
 *   # Views
 *   ## Section Name        → section separator
 *   ### View Name          → view name
 *   ```json                → view definition (base, columns)
 *   { "base": "...", "columns": [...] }
 *   ```
 *   ```js                  → optional calculator (client-side JS)
 *   schema.columns.push({ key: 'x', label: 'X', type: 'number' });
 *   for (const row of data) { row.x = ...; }
 *   ```
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
  const mdPath = path.join(requirementsDir, 'ui', 'Crud.md');
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
 * Load view definitions from Views.md.
 * @param {string} requirementsDir - Path to requirements/ directory
 * @returns {Array|null} Array of view objects and separator strings, or null if not found
 */
function loadViewsConfig(requirementsDir) {
  const mdPath = path.join(requirementsDir, 'ui', 'Views.md');
  if (!fs.existsSync(mdPath)) return null;

  let content = fs.readFileSync(mdPath, 'utf-8');

  // Remove HTML comments before parsing (they may contain example entries)
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const lines = content.split('\n');
  const result = [];
  let currentViewName = null;
  let lastViewObj = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // H2 = section separator
    if (trimmed.startsWith('## ')) {
      result.push(SEPARATOR_PREFIX + trimmed.substring(3).trim());
      currentViewName = null;
      lastViewObj = null;
      continue;
    }

    // H3 = view name
    if (trimmed.startsWith('### ')) {
      currentViewName = trimmed.substring(4).trim();
      lastViewObj = null;
      continue;
    }

    // JSON code block = view definition
    if (trimmed === '```json' && currentViewName) {
      const jsonLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        jsonLines.push(lines[i]);
        i++;
      }

      try {
        const viewDef = JSON.parse(jsonLines.join('\n'));
        viewDef.name = currentViewName;
        result.push(viewDef);
        lastViewObj = viewDef;
      } catch (e) {
        console.error(`Failed to parse view "${currentViewName}" in ${mdPath}: ${e.message}`);
      }

      currentViewName = null;
      continue;
    }

    // JS code block = calculator (attaches to preceding view)
    if (trimmed === '```js' && lastViewObj) {
      const jsLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        jsLines.push(lines[i]);
        i++;
      }
      const jsCode = jsLines.join('\n').trim();
      if (jsCode) {
        lastViewObj.calculator = jsCode;
      }
      lastViewObj = null;
    }
  }

  return result;
}

module.exports = { loadCrudConfig, loadViewsConfig };
