/**
 * Instruction Parser
 * Extracts and updates '## Data Generator' sections in entity markdown files
 */

const fs = require('fs');
const path = require('path');

const CLASSES_DIR = path.join(__dirname, '..', '..', 'docs', 'requirements', 'classes');

/**
 * Get the markdown file path for an entity
 * @param {string} entityName - Entity class name
 * @returns {string} Path to markdown file
 */
function getEntityMdPath(entityName) {
  return path.join(CLASSES_DIR, `${entityName}.md`);
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
  getEntityMdPath,
  extractGeneratorInstruction,
  updateGeneratorInstruction,
  readEntityInstruction,
  writeEntityInstruction
};
