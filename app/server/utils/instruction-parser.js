/**
 * Instruction Parser
 * Extracts and updates markdown sections (Data Generator, Data Completer) in entity files
 */

const fs = require('fs');
const path = require('path');

// Module-level classes directory (configured via init())
let CLASSES_DIR = null;

/**
 * Initialize instruction-parser with a specific docs directory
 * @param {string} docsDir - Path to the docs directory (contains classes/, ui/, imports/)
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
 * Extract a named section from markdown content
 * @param {string} markdownContent - Full markdown content
 * @param {string} sectionName - Section header name (e.g., "Data Generator")
 * @returns {string|null} Section content or null if not found
 */
function extractSection(markdownContent, sectionName) {
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n#+ |$)`);
  const match = markdownContent.match(regex);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Extract the Data Generator instruction from markdown content
 * @param {string} markdownContent - Full markdown content
 * @returns {string|null} Instruction text or null if not found
 */
function extractGeneratorInstruction(markdownContent) {
  return extractSection(markdownContent, 'Data Generator');
}

/**
 * Extract the Data Completer instruction from markdown content
 * @param {string} markdownContent - Full markdown content
 * @returns {string|null} Instruction text or null if not found
 */
function extractCompleterInstruction(markdownContent) {
  return extractSection(markdownContent, 'Data Completer');
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
 * Update or add a named section in markdown content
 * @param {string} markdownContent - Full markdown content
 * @param {string} sectionName - Section header name (e.g., "Data Generator")
 * @param {string} newContent - New section content
 * @returns {string} Updated markdown content
 */
function updateSection(markdownContent, sectionName, newContent) {
  const hasSection = markdownContent.includes(`## ${sectionName}`);

  if (hasSection) {
    const regex = new RegExp(`## ${sectionName}\\s*\\n[\\s\\S]*?(?=\\n## |\\n#+ |$)`);
    return markdownContent.replace(regex, `## ${sectionName}\n\n${newContent}\n`);
  } else {
    const trimmed = markdownContent.trimEnd();
    return `${trimmed}\n\n## ${sectionName}\n\n${newContent}\n`;
  }
}

/**
 * Update or add the Data Generator instruction in markdown content
 * @param {string} markdownContent - Full markdown content
 * @param {string} newInstruction - New instruction text
 * @returns {string} Updated markdown content
 */
function updateGeneratorInstruction(markdownContent, newInstruction) {
  return updateSection(markdownContent, 'Data Generator', newInstruction);
}

/**
 * Update or add the Data Completer instruction in markdown content
 * @param {string} markdownContent - Full markdown content
 * @param {string} newInstruction - New instruction text
 * @returns {string} Updated markdown content
 */
function updateCompleterInstruction(markdownContent, newInstruction) {
  return updateSection(markdownContent, 'Data Completer', newInstruction);
}

/**
 * Read instruction from entity markdown file (generic)
 * @param {string} entityName - Entity class name
 * @param {string} sectionName - Section name ('Data Generator' or 'Data Completer')
 * @returns {Object} { instruction, hasInstruction, mdPath, exists }
 */
function readEntitySectionInstruction(entityName, sectionName) {
  const mdPath = getEntityMdPath(entityName);

  if (!fs.existsSync(mdPath)) {
    return { instruction: null, hasInstruction: false, mdPath, exists: false };
  }

  const content = fs.readFileSync(mdPath, 'utf-8');
  const instruction = extractSection(content, sectionName);

  return {
    instruction,
    hasInstruction: instruction !== null && instruction.length > 0,
    mdPath,
    exists: true
  };
}

/**
 * Write instruction to entity markdown file (generic)
 * @param {string} entityName - Entity class name
 * @param {string} sectionName - Section name ('Data Generator' or 'Data Completer')
 * @param {string} instruction - Instruction text
 * @returns {Object} { success, mdPath, error }
 */
function writeEntitySectionInstruction(entityName, sectionName, instruction) {
  const mdPath = getEntityMdPath(entityName);

  try {
    if (!fs.existsSync(mdPath)) {
      return { success: false, mdPath, error: `Markdown file not found: ${mdPath}` };
    }

    const content = fs.readFileSync(mdPath, 'utf-8');
    const updatedContent = updateSection(content, sectionName, instruction);
    fs.writeFileSync(mdPath, updatedContent, 'utf-8');

    return { success: true, mdPath };
  } catch (error) {
    return { success: false, mdPath, error: error.message };
  }
}

/**
 * Read generator instruction from entity markdown file
 * @param {string} entityName - Entity class name
 * @returns {Object} { instruction, hasInstruction, mdPath, exists }
 */
function readEntityInstruction(entityName) {
  return readEntitySectionInstruction(entityName, 'Data Generator');
}

/**
 * Write generator instruction to entity markdown file
 * @param {string} entityName - Entity class name
 * @param {string} instruction - Instruction text
 * @returns {Object} { success, mdPath, error }
 */
function writeEntityInstruction(entityName, instruction) {
  return writeEntitySectionInstruction(entityName, 'Data Generator', instruction);
}

/**
 * Read completer instruction from entity markdown file
 * @param {string} entityName - Entity class name
 * @returns {Object} { instruction, hasInstruction, mdPath, exists }
 */
function readEntityCompleterInstruction(entityName) {
  return readEntitySectionInstruction(entityName, 'Data Completer');
}

/**
 * Write completer instruction to entity markdown file
 * @param {string} entityName - Entity class name
 * @param {string} instruction - Instruction text
 * @returns {Object} { success, mdPath, error }
 */
function writeEntityCompleterInstruction(entityName, instruction) {
  return writeEntitySectionInstruction(entityName, 'Data Completer', instruction);
}

module.exports = {
  init,
  getClassesDir,
  getEntityMdPath,
  // Generic section functions
  extractSection,
  updateSection,
  readEntitySectionInstruction,
  writeEntitySectionInstruction,
  // Generator-specific (backward compatible)
  extractGeneratorInstruction,
  updateGeneratorInstruction,
  readEntityInstruction,
  writeEntityInstruction,
  // Completer-specific
  extractCompleterInstruction,
  updateCompleterInstruction,
  readEntityCompleterInstruction,
  writeEntityCompleterInstruction,
  // Seed context
  parseSeedContext
};
