/**
 * SystemDiagramParser - Parse system markdown files for the layout editor.
 *
 * System documents describe IT systems and their data flows.
 * Format: # SystemName, #### properties, ## Flow: chapters, ## Input section.
 * Output: layout editor model (same format as schemaToModel).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseAreasFromTable } = require('./SchemaGenerator');

/**
 * Parse a single system .md file.
 *
 * Expected format:
 *   # SystemName
 *   Description text.
 *   #### Property Name
 *   Property value
 *   ## Flow: FlowName
 *   Flow description.
 *   | Receiver | Trigger | Format | Transport |
 *   | AMOS     | daily   | JSON   | REST API  |
 *   ## Input
 *   | Source | Content | Trigger | Format |
 *
 * @param {string} filePath - Absolute path to the .md file
 * @returns {{ name, description, properties, flows, inputs }}
 */
function parseSystemFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Extract # SystemName
  const nameMatch = lines[0]?.match(/^#\s+(.+)/);
  const name = nameMatch ? nameMatch[1].trim() : path.basename(filePath, '.md');

  // Split content into sections by ## headings
  const sections = [];
  let currentSection = { heading: null, lines: [] };

  for (let i = 1; i < lines.length; i++) {
    const h2Match = lines[i].match(/^##\s+(.+)/);
    if (h2Match) {
      sections.push(currentSection);
      currentSection = { heading: h2Match[1].trim(), lines: [] };
    } else {
      currentSection.lines.push(lines[i]);
    }
  }
  sections.push(currentSection);

  // First section (before any ##): description + #### properties
  const preface = sections[0];
  let description = '';
  const properties = {};

  let currentProp = null;
  for (const line of preface.lines) {
    const propMatch = line.match(/^####\s+(.+)/);
    if (propMatch) {
      currentProp = propMatch[1].trim();
      properties[currentProp] = '';
    } else if (currentProp !== null) {
      const trimmed = line.trim();
      if (trimmed) {
        properties[currentProp] = properties[currentProp]
          ? properties[currentProp] + '\n' + trimmed
          : trimmed;
      }
    } else {
      const trimmed = line.trim();
      if (trimmed) {
        description = description ? description + ' ' + trimmed : trimmed;
      }
    }
  }

  // Parse ## Flow: sections
  const flows = [];
  for (const section of sections) {
    if (!section.heading) continue;
    const flowMatch = section.heading.match(/^Flow:\s*(.+)/);
    if (!flowMatch) continue;

    const flowName = flowMatch[1].trim();
    let flowDesc = '';
    const receivers = [];

    let inTable = false;
    for (const line of section.lines) {
      if (line.match(/^\|.*Receiver.*\|/)) {
        inTable = true;
        continue; // skip header
      }
      if (inTable && line.match(/^\|\s*-/)) continue; // skip separator
      if (inTable && line.startsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 4) {
          receivers.push({
            system: cells[0],
            trigger: cells[1],
            format: cells[2],
            transport: cells[3]
          });
        }
        continue;
      }
      if (inTable && !line.startsWith('|')) inTable = false;

      // Description lines (before table)
      const trimmed = line.trim();
      if (trimmed && !inTable) {
        flowDesc = flowDesc ? flowDesc + ' ' + trimmed : trimmed;
      }
    }

    flows.push({ name: flowName, description: flowDesc, receivers });
  }

  // Parse ## Input section
  const inputs = [];
  const inputSection = sections.find(s => s.heading === 'Input');
  if (inputSection) {
    let inTable = false;
    for (const line of inputSection.lines) {
      if (line.match(/^\|.*Source.*\|/)) { inTable = true; continue; }
      if (inTable && line.match(/^\|\s*-/)) continue;
      if (inTable && line.startsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          inputs.push({
            source: cells[0],
            content: cells[1] || '',
            trigger: cells[2] || '',
            format: cells[3] || ''
          });
        }
      }
    }
  }

  return { name, description, properties, flows, inputs };
}

/**
 * Parse SystemLandscape.md and all system files from the systems directory.
 *
 * @param {string} landscapePath - Path to SystemLandscape.md
 * @param {string} systemsDir - Path to docs/systems/ directory
 * @returns {{ areas, classToArea, systems }}
 */
function parseSystemLandscape(landscapePath, systemsDir) {
  const mdContent = fs.readFileSync(landscapePath, 'utf-8');
  const { areas, classToArea } = parseAreasFromTable(mdContent);

  const systems = {};
  if (fs.existsSync(systemsDir)) {
    const files = fs.readdirSync(systemsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const parsed = parseSystemFile(path.join(systemsDir, file));
      systems[parsed.name] = parsed;
    }
  }

  return { areas, classToArea, systems };
}

/**
 * Convert parsed system landscape to layout editor model format.
 *
 * Maps: System → class, Flow → attribute, Flow-Receiver → relationship.
 *
 * @param {{ areas, classToArea, systems }} parsed
 * @returns {{ areas, classes, relationships, globalTypes, docType }}
 */
function systemsToModel(parsed) {
  const classes = {};
  const relationships = [];
  const allSystemNames = Object.keys(parsed.systems);

  for (const [systemName, system] of Object.entries(parsed.systems)) {
    const attributes = system.flows.map(flow => ({
      name: flow.name,
      type: flow.receivers[0]?.system || '',
      description: flow.description || '',
      format: flow.receivers[0]?.format || '',
      transport: flow.receivers[0]?.transport || '',
      optional: false,
      ui: {}
    }));

    classes[systemName] = {
      description: system.description || '',
      area: parsed.classToArea[systemName] || 'unknown',
      attributes,
      properties: system.properties || {},
      externalInputs: system.inputs || [],
      types: {}
    };

    // One relationship per flow-receiver pair (enables multi-target lines)
    for (const flow of system.flows) {
      for (const receiver of flow.receivers) {
        if (allSystemNames.includes(receiver.system) || parsed.classToArea[receiver.system]) {
          relationships.push({
            from: systemName,
            to: receiver.system,
            displayName: flow.name
          });
        }
      }
    }
  }

  // Compute incoming flows per system (inverted view of relationships)
  for (const systemName of Object.keys(classes)) {
    const incoming = [];
    for (const [sourceName, source] of Object.entries(parsed.systems)) {
      if (sourceName === systemName) continue;
      for (const flow of source.flows) {
        for (const receiver of flow.receivers) {
          if (receiver.system === systemName) {
            incoming.push({
              from: sourceName,
              flow: flow.name,
              description: flow.description || '',
              trigger: receiver.trigger,
              format: receiver.format,
              transport: receiver.transport
            });
          }
        }
      }
    }
    classes[systemName].incomingFlows = incoming;
  }

  return {
    areas: parsed.areas,
    classes,
    relationships,
    globalTypes: {},
    docType: 'systems'
  };
}

module.exports = {
  parseSystemFile,
  parseSystemLandscape,
  systemsToModel
};
