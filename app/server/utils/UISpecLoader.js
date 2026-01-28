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
 * @param {string} requirementsDir - Path to requirements/ directory
 * @returns {string[]|null} Array of entity names and separators, or null if not found
 */
function loadCrudConfig(requirementsDir) {
  const mdPath = path.join(requirementsDir, 'ui', 'Crud.md');
  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, 'utf-8');
  const result = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // H2 = section separator
    if (trimmed.startsWith('## ')) {
      result.push(SEPARATOR_PREFIX + trimmed.substring(3).trim());
      continue;
    }

    // Bullet item = entity name
    if (trimmed.startsWith('- ')) {
      const entity = trimmed.substring(2).trim();
      if (entity) result.push(entity);
    }
  }

  return result;
}

/**
 * Load view definitions from Views.md.
 * @param {string} requirementsDir - Path to requirements/ directory
 * @returns {Array|null} Array of view objects and separator strings, or null if not found
 */
function loadViewsConfig(requirementsDir) {
  const mdPath = path.join(requirementsDir, 'ui', 'Views.md');
  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, 'utf-8');
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
