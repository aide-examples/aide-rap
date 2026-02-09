/**
 * ProcessRouter - REST API for business processes
 *
 * GET  /api/processes              - List processes with groups/colors
 * GET  /api/processes/:name        - Get full process definition with steps
 * GET  /api/processes/:name/raw    - Get raw markdown content
 * PUT  /api/processes/:name        - Update process (structured: description + step titles/bodies)
 * PUT  /api/processes/:name/raw    - Update process (raw markdown)
 * POST /api/processes              - Create new process from template
 *
 * Process files are re-read from disk on each request (hot-reload).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../utils/logger');
const { loadProcessesConfig, reconstructProcessFile, parseProcessFile, SEPARATOR_PREFIX, COLUMN_BREAK } = require('../utils/UISpecLoader');

/**
 * Build process list and grouping from raw config array.
 * Resolves area colors from schema.
 * @param {Array} processesConfig - Raw array from loadProcessesConfig
 * @param {Object} schema - Schema with areas
 * @returns {{ processes: Object[], groups: Object[] }}
 */
function buildProcessData(processesConfig, schema) {
  if (!processesConfig || processesConfig.length === 0) {
    return { processes: [], groups: [] };
  }

  const processes = [];
  const groups = [];
  let currentGroup = null;

  for (const entry of processesConfig) {
    if (typeof entry === 'string') {
      if (entry === COLUMN_BREAK) {
        groups.push({ type: 'column_break' });
      } else if (entry.startsWith(SEPARATOR_PREFIX)) {
        const areaName = entry.substring(SEPARATOR_PREFIX.length);
        // Resolve area color from schema
        const areaKey = Object.keys(schema.areas || {}).find(
          k => schema.areas[k].name === areaName || k === areaName.toLowerCase().replace(/\s+/g, '_')
        );
        const color = areaKey ? schema.areas[areaKey].color : '#f5f5f5';
        currentGroup = areaName;
        groups.push({ type: 'separator', label: areaName, color });
      }
    } else if (entry && entry.name) {
      // Process definition object
      const process = { ...entry, group: currentGroup };
      processes.push(process);
      groups.push({ type: 'process', name: entry.name });
    }
  }

  return { processes, groups };
}

/**
 * Process file template for new processes.
 */
const PROCESS_TEMPLATE = (name) => `# ${name}

Process description goes here.

## Step 1: Preparation

Describe what needs to be prepared before starting.

## Step 2: Execution

Describe the main actions to perform.

## Step 3: Verification

Describe how to verify the process was completed successfully.
`;

module.exports = function(processesConfig, docsDir) {
  const router = express.Router();
  const { getSchema } = require('../config/database');

  /**
   * Load fresh process config from disk, falling back to startup cache.
   */
  function getProcessesConfig() {
    if (!docsDir) return processesConfig;
    try {
      return loadProcessesConfig(docsDir) || processesConfig;
    } catch (err) {
      logger.warn('Failed to reload processes from disk, using cached version', { error: err.message });
      return processesConfig;
    }
  }

  /**
   * Find a process by name from the current config (includes _sourceFile).
   */
  function findProcess(name) {
    const config = getProcessesConfig();
    if (!config) return null;
    return config.find(e => typeof e !== 'string' && e.name === name) || null;
  }

  // ─── READ ENDPOINTS ───────────────────────────────────────────────

  /**
   * GET /api/processes - List all processes with grouping info
   */
  router.get('/api/processes', (req, res) => {
    try {
      const schema = getSchema();
      const { processes, groups } = buildProcessData(getProcessesConfig(), schema);

      res.json({
        processes: processes.map(p => ({
          name: p.name,
          color: groups.find(g => g.type === 'separator' && g.label === p.group)?.color || '#f5f5f5',
          group: p.group,
          stepCount: p.steps.length,
          required: p.required || null,
          description: p.description || ''
        })),
        groups
      });
    } catch (err) {
      logger.error('Failed to list processes', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/processes/:name - Get full process definition with steps
   */
  router.get('/api/processes/:name', (req, res) => {
    try {
      // Check for /raw suffix handled by separate route
      if (req.params.name === '_areas') {
        // Special: list available areas for new process creation
        return handleListAreas(req, res);
      }

      const schema = getSchema();
      const { processes, groups } = buildProcessData(getProcessesConfig(), schema);
      const process = processes.find(p => p.name === req.params.name);

      if (!process) {
        return res.status(404).json({ error: `Process "${req.params.name}" not found` });
      }

      const color = groups.find(g => g.type === 'separator' && g.label === process.group)?.color || '#f5f5f5';

      res.json({
        name: process.name,
        description: process.description || '',
        color,
        required: process.required || null,
        _sourceFile: process._sourceFile || null,
        _area: process._area || null,
        steps: process.steps.map(s => ({
          title: s.title,
          body: s.body,
          view: s.view || null,
          viewContext: s.viewContext || null,
          entities: s.entities || [],
          call: s.call || null,
          select: s.select || null
        }))
      });
    } catch (err) {
      logger.error('Failed to get process', { name: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/processes/:name/raw - Get raw markdown content
   */
  router.get('/api/processes/:name/raw', (req, res) => {
    try {
      const process = findProcess(req.params.name);
      if (!process) {
        return res.status(404).json({ error: `Process "${req.params.name}" not found` });
      }
      if (!process._sourceFile || !docsDir) {
        return res.status(500).json({ error: 'Source file path unknown' });
      }

      const filePath = path.join(docsDir, process._sourceFile);
      const content = fs.readFileSync(filePath, 'utf-8');

      res.json({ content, path: process._sourceFile });
    } catch (err) {
      logger.error('Failed to read raw process', { name: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * List available area directories (for new process creation dialog).
   */
  function handleListAreas(req, res) {
    try {
      if (!docsDir) return res.json({ areas: [] });
      const processesDir = path.join(docsDir, 'processes');
      if (!fs.existsSync(processesDir)) return res.json({ areas: [] });

      const areas = fs.readdirSync(processesDir)
        .filter(f => fs.statSync(path.join(processesDir, f)).isDirectory())
        .sort();

      res.json({ areas });
    } catch (err) {
      logger.error('Failed to list areas', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }

  // ─── WRITE ENDPOINTS ──────────────────────────────────────────────

  /**
   * PUT /api/processes/:name - Structured save (step-edit)
   * Body: { description, steps: [{ title, body }] }
   */
  router.put('/api/processes/:name', (req, res) => {
    try {
      if (!docsDir) {
        return res.status(500).json({ error: 'No docs directory configured' });
      }

      const current = findProcess(req.params.name);
      if (!current) {
        return res.status(404).json({ error: `Process "${req.params.name}" not found` });
      }
      if (!current._sourceFile) {
        return res.status(500).json({ error: 'Source file path unknown' });
      }

      const { description, steps } = req.body;

      if (!Array.isArray(steps) || steps.length !== current.steps.length) {
        return res.status(400).json({ error: `Steps count mismatch: expected ${current.steps.length}, got ${steps ? steps.length : 0}` });
      }

      // Merge editable fields with preserved directives
      const updated = {
        name: current.name,
        required: current.required,
        description: description !== undefined ? description : current.description,
        steps: current.steps.map((origStep, i) => ({
          title: steps[i].title || origStep.title,
          body: steps[i].body !== undefined ? steps[i].body : origStep.body,
          view: origStep.view,
          viewContext: origStep.viewContext,
          entities: origStep.entities,
          call: origStep.call,
          select: origStep.select
        }))
      };

      const markdown = reconstructProcessFile(updated);
      const filePath = path.join(docsDir, current._sourceFile);
      fs.writeFileSync(filePath, markdown, 'utf-8');

      logger.info('Process saved (structured)', { name: req.params.name, path: current._sourceFile });
      res.json({ success: true, path: current._sourceFile });
    } catch (err) {
      logger.error('Failed to save process', { name: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/processes/:name/raw - Raw markdown save (full-edit)
   * Body: { content }
   */
  router.put('/api/processes/:name/raw', (req, res) => {
    try {
      if (!docsDir) {
        return res.status(500).json({ error: 'No docs directory configured' });
      }

      const current = findProcess(req.params.name);
      if (!current) {
        return res.status(404).json({ error: `Process "${req.params.name}" not found` });
      }
      if (!current._sourceFile) {
        return res.status(500).json({ error: 'Source file path unknown' });
      }

      const { content } = req.body;
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid content' });
      }

      // Validate: must parse successfully
      const parsed = parseProcessFile(content, path.basename(current._sourceFile));
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid process markdown: could not parse (needs at least # heading and ## step)' });
      }

      const filePath = path.join(docsDir, current._sourceFile);
      fs.writeFileSync(filePath, content, 'utf-8');

      logger.info('Process saved (raw)', { name: req.params.name, path: current._sourceFile });
      res.json({ success: true, path: current._sourceFile });
    } catch (err) {
      logger.error('Failed to save raw process', { name: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/processes - Create new process from template
   * Body: { name, area }
   */
  router.post('/api/processes', (req, res) => {
    try {
      if (!docsDir) {
        return res.status(500).json({ error: 'No docs directory configured' });
      }

      const { name, area } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Missing or invalid process name' });
      }
      if (!area || typeof area !== 'string' || !area.trim()) {
        return res.status(400).json({ error: 'Missing or invalid area name' });
      }

      const areaDir = path.join(docsDir, 'processes', area);
      if (!fs.existsSync(areaDir) || !fs.statSync(areaDir).isDirectory()) {
        return res.status(400).json({ error: `Area directory "${area}" does not exist` });
      }

      const filename = `${name.trim()}.md`;
      const filePath = path.join(areaDir, filename);
      const relativePath = path.join('processes', area, filename);

      if (fs.existsSync(filePath)) {
        return res.status(409).json({ error: `Process file already exists: ${relativePath}` });
      }

      const content = PROCESS_TEMPLATE(name.trim());
      fs.writeFileSync(filePath, content, 'utf-8');

      logger.info('Process created', { name: name.trim(), area, path: relativePath });
      res.json({ success: true, name: name.trim(), path: relativePath });
    } catch (err) {
      logger.error('Failed to create process', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
