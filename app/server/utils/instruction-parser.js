/**
 * Instruction Parser
 * Extracts and updates '## Data Generator' sections in entity markdown files
 */

const fs = require('fs');
const path = require('path');

// Module-level classes directory (configured via init())
let CLASSES_DIR = null;

/**
 * Initialize instruction-parser with a specific docs directory
 * @param {string} docsDir - Path to the docs/requirements directory
 */
function init(docsDir) {
  CLASSES_DIR = path.join(docsDir, 'classes');
}

/**
 * Get the classes directory
 * @returns {string} - The classes directory path
 */
function getClassesDir() {
  if (!CLASSES_DIR) {
    throw new Error('Instruction-parser not initialized. Call init(docsDir) first.');
  }
  return CLASSES_DIR;
}

/**
 * Get the markdown file path for an entity
 * @param {string} entityName - Entity class name
 * @returns {string} Path to markdown file
 */
function getEntityMdPath(entityName) {
  return path.join(getClassesDir(), `${entityName}.md`);
}

/**
 * Extract the Data Generator instruction from markdown content
 * @param {string} markdownContent - Full markdown content
 * @returns {string|null} Instruction text or null if not found
 */
function extractGeneratorInstruction(markdownContent) {
  // Match ## Data Generator section until next ## or end of file
  const match = markdownContent.match(/## Data Generator\s*\n([\s\S]*?)(?=\n## |\n#+ |$)/);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Parse Seed Context section from markdown content
 * Extracts entities and their selected attributes for seed generation context
 *
 * Syntax:
 *   - EntityName: attr1, attr2   → only these attributes
 *   - EntityName                 → all attributes (attributes = null)
 *
 * @param {string} markdownContent - Full markdown content
 * @returns {Array<{entity: string, attributes: string[]|null}>}
 */
function parseSeedContext(markdownContent) {
  // Match ## Seed Context section until next ## or end of file
  const match = markdownContent.match(/## Seed Context\s*\n([\s\S]*?)(?=\n## |\n#+ |$)/);
  if (!match) return [];

  const lines = match[1].split('\n');
  return lines
    .map(line => line.trim())
    .filter(line => line.startsWith('-') || line.startsWith('*'))
    .map(line => {
      const content = line.replace(/^[-*]\s*/, '').trim();

      // Parse "EntityName: attr1, attr2" or "EntityName"
      const colonIndex = content.indexOf(':');
      if (colonIndex > 0) {
        const entity = content.substring(0, colonIndex).trim();
        const attrs = content.substring(colonIndex + 1)
          .split(',')
          .map(a => a.trim())
          .filter(Boolean);
        return { entity, attributes: attrs };
      }

      return { entity: content, attributes: null };
    })
    .filter(item => item.entity);
}

/**
 * Update or add the Data Generator instruction in markdown content
 * @param {string} markdownContent - Full markdown content
 * @param {string} newInstruction - New instruction text
 * @returns {string} Updated markdown content
 */
function updateGeneratorInstruction(markdownContent, newInstruction) {
  const hasSection = markdownContent.includes('## Data Generator');

  if (hasSection) {
    // Replace existing section content
    return markdownContent.replace(
      /## Data Generator\s*\n[\s\S]*?(?=\n## |\n#+ |$)/,
      `## Data Generator\n\n${newInstruction}\n`
    );
  } else {
    // Append new section at end
    const trimmed = markdownContent.trimEnd();
    return `${trimmed}\n\n## Data Generator\n\n${newInstruction}\n`;
  }
}

/**
 * Read generator instruction from entity markdown file
 * @param {string} entityName - Entity class name
 * @returns {Object} { instruction, hasInstruction, mdPath, exists }
 */
function readEntityInstruction(entityName) {
  const mdPath = getEntityMdPath(entityName);

  if (!fs.existsSync(mdPath)) {
    return {
      instruction: null,
      hasInstruction: false,
      mdPath,
      exists: false
    };
  }

  const content = fs.readFileSync(mdPath, 'utf-8');
  const instruction = extractGeneratorInstruction(content);

  return {
    instruction,
    hasInstruction: instruction !== null && instruction.length > 0,
    mdPath,
    exists: true
  };
}

/**
 * Write generator instruction to entity markdown file
 * @param {string} entityName - Entity class name
 * @param {string} instruction - Instruction text
 * @returns {Object} { success, mdPath, error }
 */
function writeEntityInstruction(entityName, instruction) {
  const mdPath = getEntityMdPath(entityName);

  try {
    if (!fs.existsSync(mdPath)) {
      return {
        success: false,
        mdPath,
        error: `Markdown file not found: ${mdPath}`
      };
    }

    const content = fs.readFileSync(mdPath, 'utf-8');
    const updatedContent = updateGeneratorInstruction(content, instruction);
    fs.writeFileSync(mdPath, updatedContent, 'utf-8');

    return {
      success: true,
      mdPath
    };
  } catch (error) {
    return {
      success: false,
      mdPath,
      error: error.message
    };
  }
}

module.exports = {
  init,
  getClassesDir,
  getEntityMdPath,
  extractGeneratorInstruction,
  updateGeneratorInstruction,
  readEntityInstruction,
  writeEntityInstruction,
  parseSeedContext
};
