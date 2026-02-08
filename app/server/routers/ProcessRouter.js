/**
 * ProcessRouter - REST API for business processes
 *
 * GET /api/processes           - List processes with groups/colors
 * GET /api/processes/:name     - Get full process definition with steps
 */

const express = require('express');
const logger = require('../utils/logger');
const { SEPARATOR_PREFIX, COLUMN_BREAK } = require('../utils/UISpecLoader');

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

module.exports = function(processesConfig) {
  const router = express.Router();
  const { getSchema } = require('../config/database');

  /**
   * GET /api/processes - List all processes with grouping info
   */
  router.get('/api/processes', (req, res) => {
    try {
      const schema = getSchema();
      const { processes, groups } = buildProcessData(processesConfig, schema);

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
      const schema = getSchema();
      const { processes, groups } = buildProcessData(processesConfig, schema);
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
        steps: process.steps.map(s => ({
          title: s.title,
          body: s.body,
          view: s.view || null,
          entity: s.entity || null,
          call: s.call || null
        }))
      });
    } catch (err) {
      logger.error('Failed to get process', { name: req.params.name, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
