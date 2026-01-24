/**
 * LLM Generator Service
 * Supports multiple AI providers (Gemini, Anthropic) for generating seed data
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const { parseSeedContext } = require('../utils/instruction-parser');

const SEED_DIR = path.join(__dirname, '..', '..', 'data', 'seed');

/**
 * Base class for LLM providers
 */
class BaseLLMProvider {
  constructor(config) {
    this.config = config;
    this.maxRecords = config.maxRecords || null;
  }

  async generate(prompt) {
    throw new Error('generate() must be implemented by subclass');
  }

  getProviderName() {
    return 'unknown';
  }

  getMaxRecords() {
    return this.maxRecords;
  }
}

/**
 * Google Gemini Provider
 */
class GeminiProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: config.model || 'gemini-2.0-flash-lite'
    });
    this.maxRecords = config.maxRecords || null;
  }

  async generate(prompt) {
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  getProviderName() {
    return 'gemini';
  }
}

/**
 * Anthropic Claude Provider
 */
class AnthropicProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey
    });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxRecords = config.maxRecords || null;
  }

  async generate(prompt) {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ]
    });
    // Extract text from response
    const textBlock = message.content.find(block => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  getProviderName() {
    return 'anthropic';
  }
}

/**
 * Main LLM Generator class
 */
class LLMGenerator {
  constructor(config) {
    this.enabled = false;
    this.provider = null;
    this.activeProvider = null;

    if (!config) return;

    // Support both old format (single provider) and new format (multiple providers)
    if (config.providers && config.active) {
      // New format: { active: "gemini", providers: { gemini: {...}, anthropic: {...} } }
      this.activeProvider = config.active;
      const providerConfig = config.providers[config.active];

      if (providerConfig?.apiKey) {
        this.provider = this.createProvider(config.active, providerConfig);
        this.enabled = true;
      }
    } else if (config.apiKey) {
      // Old format: { provider: "gemini", apiKey: "...", model: "..." }
      this.activeProvider = config.provider || 'gemini';
      this.provider = this.createProvider(this.activeProvider, config);
      this.enabled = true;
    }
  }

  createProvider(name, config) {
    switch (name) {
      case 'gemini':
        return new GeminiProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      default:
        throw new Error(`Unknown LLM provider: ${name}`);
    }
  }

  /**
   * Check if the generator is enabled (API key configured)
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get the active provider name
   */
  getActiveProvider() {
    return this.activeProvider;
  }

  /**
   * Generate seed data for an entity
   * @param {string} entityName - Entity name
   * @param {Object} schema - Entity schema
   * @param {string} instruction - Data generator instruction
   * @param {Object} existingData - FK reference data
   * @param {Object} contextData - Seed context data (validation entities)
   */
  async generateSeedData(entityName, schema, instruction, existingData = {}, contextData = {}) {
    if (!this.enabled) {
      throw new Error('LLM Generator not configured. Add llm configuration to config.json');
    }

    const prompt = this.buildPrompt(entityName, schema, instruction, existingData, contextData);

    try {
      const response = await this.provider.generate(prompt);
      return this.parseResponse(response);
    } catch (error) {
      throw new Error(`${this.activeProvider} API error: ${error.message}`);
    }
  }

  /**
   * Build the prompt for the LLM
   * @param {string} entityName - Name of entity to generate
   * @param {Object} schema - Entity schema with columns
   * @param {string} instruction - Data generator instruction
   * @param {Object} existingData - FK reference data
   * @param {Object} contextData - Seed context data (validation/constraint entities)
   */
  buildPrompt(entityName, schema, instruction, existingData, contextData = {}) {
    // Filter out computed columns (DAILY, IMMEDIATE, HOURLY, ON_DEMAND annotations)
    // These are auto-calculated and should not be generated
    const isComputedColumn = (col) => {
      if (col.computed) return true;  // Schema already parsed
      // Fallback: check description for annotations (before SchemaGenerator parses them)
      const desc = col.description || '';
      return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
    };

    // Prepare column info with types (excluding computed columns)
    const columnInfo = schema.columns
      .filter(col => !isComputedColumn(col))
      .map(col => {
        const info = {
          name: col.name,
          type: col.type,
          nullable: col.nullable
        };
        if (col.foreignKey) {
          info.foreignKey = col.foreignKey;
        }
        return info;
      });

    // Prepare type definitions if available
    const typeDefinitions = schema.types || {};

    // Build FK reference summary with ALL records (not just examples)
    const fkSummary = {};
    for (const [refEntity, entityData] of Object.entries(existingData)) {
      // Support both old format (array) and new format ({ records, labelFields })
      const records = Array.isArray(entityData) ? entityData : entityData.records;
      const labelFields = Array.isArray(entityData) ? null : entityData.labelFields;

      if (records && records.length > 0) {
        // Show all records with id and identifying label
        fkSummary[refEntity] = records.map(r => {
          // Use labelFields from schema if available
          let label = null;
          if (labelFields && labelFields.length > 0) {
            label = r[labelFields[0]];
          }
          // Fallback to common field names
          if (!label) {
            label = r.name || r.title || r.designation || r.registration || r.serial_number || r.icao_code || `#${r.id}`;
          }
          return { id: r.id, label };
        });
      }
    }

    return `Generate test data for the entity "${entityName}".

## Entity Schema
${JSON.stringify(columnInfo, null, 2)}

## Type Definitions (patterns and enums must be respected!)
${JSON.stringify(typeDefinitions, null, 2)}

## Instruction
${instruction}

## Available Foreign Key References
${Object.keys(fkSummary).length > 0 ? JSON.stringify(fkSummary, null, 2) : 'None - no referenced entities have seed data yet.'}
${this.buildSeedContextSection(contextData)}
## Requirements
- Generate a valid JSON array of objects
- Each object must have all non-nullable columns
- Respect all type constraints:
  - Pattern types: values must match the regex pattern
  - Enum types: use the INTERNAL value (first in mapping)
- IMPORTANT: For foreign keys, use the LABEL value (not the ID)!
  - The "Available Foreign Key References" section shows all existing records
  - Use the conceptual field name without "_id" suffix (e.g., use "type" instead of "type_id")
  - Example: Instead of "type_id": 3, write "type": "A320neo"
  - The system will automatically resolve labels to IDs
  - Only create records that reference existing labels from the list above
- Generate realistic, consistent data
- Do NOT include the "id" field if it's auto-generated (READONLY)
- Do NOT add extra columns like "#", "row", "index" or any fields not in the schema
- Keep field values concise to fit within response limits
${this.provider?.getMaxRecords() ? `- IMPORTANT: Generate at most ${this.provider.getMaxRecords()} records to avoid response truncation` : ''}

## Output Format
Return ONLY a valid JSON array. No markdown, no explanation. Use compact JSON (no pretty-printing).`;
  }

  /**
   * Build the Seed Context section of the prompt
   * @param {Object} contextData - { EntityName: { records, attributes } }
   * @returns {string} Formatted context section or empty string
   */
  buildSeedContextSection(contextData) {
    if (!contextData || Object.keys(contextData).length === 0) {
      return '';
    }

    let section = '\n## Seed Context (Validation/Constraint Data)\n';
    section += 'Use this data to ensure generated records are valid:\n\n';

    for (const [ctxEntity, data] of Object.entries(contextData)) {
      const attrInfo = data.attributes
        ? ` (${data.attributes.join(', ')})`
        : '';
      section += `### ${ctxEntity}${attrInfo}\n`;
      section += JSON.stringify(data.records, null, 2);
      section += '\n\n';
    }

    return section;
  }

  /**
   * Load context data for seed generation (non-FK validation entities)
   * @param {Array<{entity: string, attributes: string[]|null}>} contextSpecs
   * @param {Function} getDatabase - Function to get database connection
   * @param {Object} fullSchema - Full schema with all entities
   * @returns {Object} { EntityName: { records: [...], attributes: [...] } }
   */
  loadSeedContext(contextSpecs, getDatabase, fullSchema) {
    if (!contextSpecs || contextSpecs.length === 0 || !getDatabase) {
      return {};
    }

    const db = getDatabase();
    const contextData = {};

    for (const spec of contextSpecs) {
      const entity = fullSchema?.entities?.[spec.entity];
      if (!entity) continue;

      try {
        // Query with view for label resolution
        const viewName = entity.tableName + '_view';
        const records = db.prepare(`SELECT * FROM ${viewName}`).all();

        // Filter to only requested attributes
        const filteredRecords = records.map(r => {
          if (!spec.attributes) {
            // All attributes (except id)
            const { id, ...rest } = r;
            return rest;
          }
          // Only specified attributes
          const filtered = {};
          for (const attr of spec.attributes) {
            if (r[attr] !== undefined) {
              filtered[attr] = r[attr];
            }
          }
          return filtered;
        });

        contextData[spec.entity] = {
          records: filteredRecords,
          attributes: spec.attributes
        };
      } catch (e) {
        // View might not exist, try table directly
        try {
          const records = db.prepare(`SELECT * FROM ${entity.tableName}`).all();
          const filteredRecords = records.map(r => {
            if (!spec.attributes) {
              const { id, ...rest } = r;
              return rest;
            }
            const filtered = {};
            for (const attr of spec.attributes) {
              if (r[attr] !== undefined) {
                filtered[attr] = r[attr];
              }
            }
            return filtered;
          });
          contextData[spec.entity] = {
            records: filteredRecords,
            attributes: spec.attributes
          };
        } catch (e2) {
          // Table doesn't exist, skip
        }
      }
    }

    return contextData;
  }

  /**
   * Parse the LLM response and extract JSON
   */
  parseResponse(text) {
    let jsonText = text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonText = match[1].trim();
      } else {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '');
      }
    }

    // Find JSON array
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      if (jsonText.includes('[') && !jsonText.includes(']')) {
        throw new Error('Response was truncated. Try a simpler instruction or request fewer records.');
      }
      throw new Error('No valid JSON array found in LLM response');
    }

    try {
      const data = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(data)) {
        throw new Error('Response is not an array');
      }
      // Remove 'id' fields - they should be auto-generated by the database
      for (const record of data) {
        delete record.id;
      }
      return data;
    } catch (parseError) {
      if (arrayMatch[0].endsWith(',') || arrayMatch[0].endsWith('{')) {
        throw new Error('Response was truncated. Try requesting fewer records.');
      }
      throw new Error(`Failed to parse JSON: ${parseError.message}`);
    }
  }

  /**
   * Load existing data from database for foreign key references
   * @param {Object} entitySchema - Schema of the entity being generated (with columns)
   * @param {Function} getDatabase - Function to get database connection
   * @param {Object} fullSchema - Full schema with all entities (for labelFields lookup)
   */
  loadExistingDataForFKs(entitySchema, getDatabase, fullSchema = null) {
    const fkColumns = entitySchema.columns.filter(c => c.foreignKey);
    const existingData = {};

    if (!getDatabase) {
      return existingData;
    }

    const db = getDatabase();
    for (const col of fkColumns) {
      const refEntity = col.foreignKey.entity;
      const refTable = col.foreignKey.table;
      try {
        const records = db.prepare(`SELECT * FROM ${refTable}`).all();
        if (records && records.length > 0) {
          // Get labelFields from the referenced entity's schema if available
          let labelFields = null;
          if (fullSchema && fullSchema.entities && fullSchema.entities[refEntity]) {
            labelFields = fullSchema.entities[refEntity].ui?.labelFields;
          }
          existingData[refEntity] = {
            records,
            labelFields
          };
        }
      } catch (e) {
        // Table might not exist yet, ignore
      }
    }

    return existingData;
  }

  /**
   * Save generated data to seed file
   */
  saveGeneratedData(entityName, data) {
    if (!fs.existsSync(SEED_DIR)) {
      fs.mkdirSync(SEED_DIR, { recursive: true });
    }

    const filePath = path.join(SEED_DIR, `${entityName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

    return filePath;
  }
}

// Singleton instance
let instance = null;

function getGenerator(config) {
  if (!instance) {
    instance = new LLMGenerator(config);
  }
  return instance;
}

function resetGenerator() {
  instance = null;
}

module.exports = {
  LLMGenerator,
  getGenerator,
  resetGenerator
};
