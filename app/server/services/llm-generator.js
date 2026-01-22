/**
 * LLM Generator Service
 * Supports multiple AI providers (Gemini, Anthropic) for generating seed data
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const SEED_GENERATED_DIR = path.join(__dirname, '..', '..', 'data', 'seed_generated');

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
   */
  async generateSeedData(entityName, schema, instruction, existingData = {}) {
    if (!this.enabled) {
      throw new Error('LLM Generator not configured. Add llm configuration to config.json');
    }

    const prompt = this.buildPrompt(entityName, schema, instruction, existingData);

    try {
      const response = await this.provider.generate(prompt);
      return this.parseResponse(response);
    } catch (error) {
      throw new Error(`${this.activeProvider} API error: ${error.message}`);
    }
  }

  /**
   * Build the prompt for the LLM
   */
  buildPrompt(entityName, schema, instruction, existingData) {
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
    for (const [refEntity, records] of Object.entries(existingData)) {
      if (records && records.length > 0) {
        // Show all records with id and identifying label
        fkSummary[refEntity] = records.map(r => ({
          id: r.id,
          label: r.name || r.title || r.designation || r.icao_code || `#${r.id}`
        }));
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
- Keep field values concise to fit within response limits
${this.provider.getMaxRecords() ? `- IMPORTANT: Generate at most ${this.provider.getMaxRecords()} records to avoid response truncation` : ''}

## Output Format
Return ONLY a valid JSON array. No markdown, no explanation. Use compact JSON (no pretty-printing).`;
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
   */
  loadExistingDataForFKs(schema, getDatabase) {
    const fkColumns = schema.columns.filter(c => c.foreignKey);
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
          existingData[refEntity] = records;
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
    if (!fs.existsSync(SEED_GENERATED_DIR)) {
      fs.mkdirSync(SEED_GENERATED_DIR, { recursive: true });
    }

    const filePath = path.join(SEED_GENERATED_DIR, `${entityName}.json`);
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
