/**
 * TypeParser - Parses type definitions from markdown files
 * Works on server (Node.js) only (requires fs)
 *
 * Parses two formats:
 * 1. Pattern types: | Type | Pattern | Description | Example |
 * 2. Enum types: | Internal | External | Description | (under ### TypeName heading)
 *
 * Also parses ## Types sections in entity markdown files
 */

const fs = require('fs');
const path = require('path');
const { getTypeRegistry } = require('./TypeRegistry');

class TypeParser {
  constructor(typeRegistry = null) {
    this.registry = typeRegistry || getTypeRegistry();
  }

  /**
   * Parses the global Types.md file
   * @param {string} typesPath - Path to Types.md
   */
  parseGlobalTypes(typesPath) {
    if (!fs.existsSync(typesPath)) {
      return;
    }

    const content = fs.readFileSync(typesPath, 'utf-8');
    this._parseTypesContent(content, 'global');
  }

  /**
   * Parses the ## Types section from an entity markdown file
   * @param {string} entityPath - Path to entity markdown file
   * @param {string} entityName - Name of the entity
   * @returns {Object} - Parsed types (for integration with parse-datamodel)
   */
  parseEntityTypes(entityPath, entityName) {
    if (!fs.existsSync(entityPath)) {
      return {};
    }

    const content = fs.readFileSync(entityPath, 'utf-8');
    const typesSection = this._extractTypesSection(content);

    if (!typesSection) {
      return {};
    }

    return this._parseTypesContent(typesSection, `entity:${entityName}`);
  }

  /**
   * Parses types content and registers them
   * @param {string} content - Markdown content
   * @param {string} scope - 'global' or 'entity:EntityName'
   * @returns {Object} - Parsed types { typeName: definition }
   * @private
   */
  _parseTypesContent(content, scope) {
    const types = {};
    const lines = content.split('\n');

    let currentSection = null;  // 'pattern' or 'enum' or 'inline-enum'
    let currentTypeName = null; // For both pattern and enum types with ### headers
    let currentEnumValues = [];
    let currentDescription = ''; // Description text between ### header and table
    let inlineEnums = {};  // Type name -> values (for inline enum format)
    let inTable = false;
    let tableHeaders = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect section headers
      if (line.startsWith('## Pattern Types') || line.startsWith('## Pattern')) {
        this._flushCurrentType(currentSection, currentTypeName, currentEnumValues, currentDescription, scope, types);
        currentSection = 'pattern';
        currentTypeName = null;
        currentEnumValues = [];
        currentDescription = '';
        this._flushInlineEnums(inlineEnums, scope, types);
        inlineEnums = {};
        inTable = false;
        continue;
      }

      if (line.startsWith('## Enum Types') || line.startsWith('## Enum')) {
        this._flushCurrentType(currentSection, currentTypeName, currentEnumValues, currentDescription, scope, types);
        currentSection = 'enum';
        currentTypeName = null;
        currentEnumValues = [];
        currentDescription = '';
        this._flushInlineEnums(inlineEnums, scope, types);
        inlineEnums = {};
        inTable = false;
        continue;
      }

      // Detect type name (### TypeName) - works for both pattern and enum sections
      if (line.startsWith('### ')) {
        this._flushCurrentType(currentSection, currentTypeName, currentEnumValues, currentDescription, scope, types);
        currentTypeName = line.substring(4).trim();
        currentEnumValues = [];
        currentDescription = '';
        inTable = false;
        // If no section set, default to enum (for entity-local types)
        if (!currentSection) {
          currentSection = 'enum';
        }
        continue;
      }

      // Capture description text (non-table, non-header lines after ### header)
      if (currentTypeName && !inTable && line && !line.startsWith('|') && !line.startsWith('#')) {
        currentDescription = line;
        continue;
      }

      // Detect table header
      if (line.startsWith('|') && line.includes('|')) {
        const cells = this._parseTableRow(line);

        // Check if this is a header row (contains known column names)
        if (this._isHeaderRow(cells)) {
          tableHeaders = cells.map(c => c.toLowerCase().trim());
          inTable = true;
          continue;
        }

        // Skip separator row
        if (line.includes('---')) {
          continue;
        }

        // Parse data row
        if (inTable && tableHeaders.length > 0) {
          // New format: Pattern types with ### header and | Pattern | Example | table
          if (currentSection === 'pattern' && currentTypeName && tableHeaders.includes('pattern')) {
            const patternIdx = tableHeaders.indexOf('pattern');
            const exampleIdx = tableHeaders.indexOf('example');
            if (patternIdx >= 0 && cells[patternIdx]) {
              // Strip backticks from pattern
              let pattern = cells[patternIdx];
              if (pattern.startsWith('`') && pattern.endsWith('`')) {
                pattern = pattern.slice(1, -1);
              }
              const example = exampleIdx >= 0 ? cells[exampleIdx] || '' : '';
              this.registry.registerPattern(
                currentTypeName,
                pattern,
                { description: currentDescription, example },
                scope
              );
              types[currentTypeName] = {
                kind: 'pattern',
                pattern,
                description: currentDescription,
                example
              };
            }
          }
          // Old format: Pattern types with | Type | Pattern | Description | Example | table
          else if (currentSection === 'pattern' && tableHeaders.includes('type') && tableHeaders.includes('pattern')) {
            const patternType = this._parsePatternRow(cells, tableHeaders);
            if (patternType) {
              this.registry.registerPattern(
                patternType.name,
                patternType.pattern,
                { description: patternType.description, example: patternType.example },
                scope
              );
              types[patternType.name] = {
                kind: 'pattern',
                pattern: patternType.pattern,
                description: patternType.description,
                example: patternType.example
              };
            }
          }
          // Enum types with ### header (Internal/External/Description table)
          // Note: This can appear under any section (even ## Pattern Types) - the table format determines the type
          else if (currentTypeName && tableHeaders.includes('internal') && tableHeaders.includes('external')) {
            const enumValue = this._parseEnumRow(cells, tableHeaders);
            if (enumValue) {
              currentEnumValues.push(enumValue);
            }
          }
          // Inline enum format: | Type | Internal | External | Description |
          else if (tableHeaders.includes('type') && tableHeaders.includes('internal') && tableHeaders.includes('external')) {
            const inlineEnum = this._parseInlineEnumRow(cells, tableHeaders);
            if (inlineEnum) {
              if (!inlineEnums[inlineEnum.typeName]) {
                inlineEnums[inlineEnum.typeName] = [];
              }
              inlineEnums[inlineEnum.typeName].push(inlineEnum.value);
            }
          }
        }
      } else {
        // Non-table line - reset table state
        if (!line.startsWith('|')) {
          inTable = false;
          tableHeaders = [];
        }
      }
    }

    // Flush any remaining type
    this._flushCurrentType(currentSection, currentTypeName, currentEnumValues, currentDescription, scope, types);

    // Flush inline enums
    this._flushInlineEnums(inlineEnums, scope, types);

    return types;
  }

  /**
   * Flushes the current type (pattern or enum) to registry
   * @private
   */
  _flushCurrentType(section, name, enumValues, description, scope, types) {
    if (!name) return;

    // Register enum if we have values - table format determines type, not section
    // (enums with Internal/External columns can appear under ## Pattern Types)
    if (enumValues.length > 0) {
      this.registry.registerEnum(name, enumValues, scope);
      types[name] = {
        kind: 'enum',
        values: [...enumValues]
      };
    }
    // Pattern types are registered inline when the table row is parsed
  }

  /**
   * Extracts the ## Types section from markdown content
   * @param {string} content - Full markdown content
   * @returns {string|null} - Types section content or null
   * @private
   */
  _extractTypesSection(content) {
    const lines = content.split('\n');
    let inTypesSection = false;
    let typesLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('## Types')) {
        inTypesSection = true;
        continue;
      }

      if (inTypesSection) {
        // Stop at next ## section (but not ### subsections)
        if (trimmed.startsWith('## ') && !trimmed.startsWith('## Types')) {
          break;
        }
        typesLines.push(line);
      }
    }

    return typesLines.length > 0 ? typesLines.join('\n') : null;
  }

  /**
   * Parses a table row into cells
   * @param {string} line - Table row line
   * @returns {string[]} - Cell values
   * @private
   */
  _parseTableRow(line) {
    return line
      .split('|')
      .map(cell => cell.trim())
      .filter((cell, index, arr) => index > 0 && index < arr.length - 1);
  }

  /**
   * Extract type name from a markdown link or plain text
   * Handles: "[TailSign](../Types.md#TailSign)" -> "TailSign"
   * @param {string} typeStr - Type string (may be a link)
   * @returns {string} - Extracted type name
   */
  extractTypeName(typeStr) {
    if (!typeStr) return typeStr;

    // Match markdown link: [TypeName](url)
    const linkMatch = typeStr.match(/^\[([^\]]+)\]\([^)]+\)$/);
    if (linkMatch) {
      return linkMatch[1].trim();
    }

    return typeStr.trim();
  }

  /**
   * Checks if row is a header row
   * @param {string[]} cells - Cell values
   * @returns {boolean}
   * @private
   */
  _isHeaderRow(cells) {
    const lowerCells = cells.map(c => c.toLowerCase());
    return lowerCells.includes('type') ||
           lowerCells.includes('pattern') ||
           lowerCells.includes('internal') ||
           lowerCells.includes('external');
  }

  /**
   * Parses a pattern type row
   * @param {string[]} cells - Cell values
   * @param {string[]} headers - Column headers
   * @returns {Object|null}
   * @private
   */
  _parsePatternRow(cells, headers) {
    const typeIdx = headers.indexOf('type');
    const patternIdx = headers.indexOf('pattern');
    const descIdx = headers.indexOf('description');
    const exampleIdx = headers.indexOf('example');

    if (typeIdx === -1 || patternIdx === -1) return null;
    if (!cells[typeIdx] || !cells[patternIdx]) return null;

    return {
      name: cells[typeIdx],
      pattern: cells[patternIdx],
      description: descIdx >= 0 ? cells[descIdx] || '' : '',
      example: exampleIdx >= 0 ? cells[exampleIdx] || '' : ''
    };
  }

  /**
   * Parses an enum value row
   * @param {string[]} cells - Cell values
   * @param {string[]} headers - Column headers
   * @returns {Object|null}
   * @private
   */
  _parseEnumRow(cells, headers) {
    const internalIdx = headers.indexOf('internal');
    const externalIdx = headers.indexOf('external');
    const descIdx = headers.indexOf('description');

    if (internalIdx === -1 || externalIdx === -1) return null;
    if (cells[internalIdx] === undefined || cells[externalIdx] === undefined) return null;

    // Try to parse internal as number
    let internal = cells[internalIdx];
    const numValue = Number(internal);
    if (!isNaN(numValue)) {
      internal = numValue;
    }

    return {
      internal,
      external: cells[externalIdx],
      description: descIdx >= 0 ? cells[descIdx] || '' : ''
    };
  }

  /**
   * Parses an inline enum row (table with Type column)
   * @param {string[]} cells - Cell values
   * @param {string[]} headers - Column headers
   * @returns {Object|null} - { typeName, value: { internal, external, description } }
   * @private
   */
  _parseInlineEnumRow(cells, headers) {
    const typeIdx = headers.indexOf('type');
    const internalIdx = headers.indexOf('internal');
    const externalIdx = headers.indexOf('external');
    const descIdx = headers.indexOf('description');

    if (typeIdx === -1 || internalIdx === -1 || externalIdx === -1) return null;
    if (!cells[typeIdx] || cells[internalIdx] === undefined || cells[externalIdx] === undefined) return null;

    // Try to parse internal as number
    let internal = cells[internalIdx];
    const numValue = Number(internal);
    if (!isNaN(numValue)) {
      internal = numValue;
    }

    return {
      typeName: cells[typeIdx],
      value: {
        internal,
        external: cells[externalIdx],
        description: descIdx >= 0 ? cells[descIdx] || '' : ''
      }
    };
  }

  /**
   * Flushes inline enums to registry
   * @param {Object} inlineEnums - { typeName: [values] }
   * @param {string} scope - Scope
   * @param {Object} types - Types accumulator
   * @private
   */
  _flushInlineEnums(inlineEnums, scope, types) {
    for (const [typeName, values] of Object.entries(inlineEnums)) {
      if (values.length > 0) {
        this.registry.registerEnum(typeName, values, scope);
        types[typeName] = {
          kind: 'enum',
          values: [...values]
        };
      }
    }
  }

  /**
   * Parses inline enum definition from entity attribute table
   * Format in Type column: "enum(1:Active,2:Inactive,3:Retired)"
   * @param {string} typeStr - Type string from attribute table
   * @returns {Object|null} - { kind: 'enum', values: [...] } or null
   */
  parseInlineEnum(typeStr) {
    const match = typeStr.match(/^enum\((.+)\)$/i);
    if (!match) return null;

    const values = [];
    const pairs = match[1].split(',');

    for (const pair of pairs) {
      const [internal, external] = pair.split(':');
      if (internal !== undefined && external !== undefined) {
        let internalVal = internal.trim();
        const numValue = Number(internalVal);
        if (!isNaN(numValue)) {
          internalVal = numValue;
        }
        values.push({
          internal: internalVal,
          external: external.trim(),
          description: ''
        });
      }
    }

    return values.length > 0 ? { kind: 'enum', values } : null;
  }

  /**
   * Parses inline pattern definition from entity attribute table
   * Format in Type column: "pattern(^[A-Z]{2}$)"
   * @param {string} typeStr - Type string from attribute table
   * @returns {Object|null} - { kind: 'pattern', pattern: '...' } or null
   */
  parseInlinePattern(typeStr) {
    const match = typeStr.match(/^pattern\((.+)\)$/i);
    if (!match) return null;

    return {
      kind: 'pattern',
      pattern: match[1]
    };
  }
}

// Export for Node.js
module.exports = { TypeParser };
