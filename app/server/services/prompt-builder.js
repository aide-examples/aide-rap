/**
 * Prompt Builder Service
 * Builds AI prompts for seed data generation and parses AI responses.
 * Stateless module — no LLM provider dependencies.
 */

const path = require('path');
const fs = require('fs');
const { parseSeedContext } = require('../utils/instruction-parser');
const SeedManager = require('../utils/SeedManager');

/**
 * Shuffle array randomly (Fisher-Yates)
 */
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Parse [FKLIMIT=n] directive from instruction
 * @param {string} instruction - Data generator instruction
 * @returns {{ cleanInstruction: string, fkLimit: number|null }}
 */
function parseFkLimit(instruction) {
  const match = instruction.match(/\[FKLIMIT=(\d+)\]/i);
  if (match) {
    const limit = parseInt(match[1], 10);
    const cleanInstruction = instruction.replace(/\s*\[FKLIMIT=\d+\]/gi, '').trim();
    return { cleanInstruction, fkLimit: limit };
  }
  return { cleanInstruction: instruction, fkLimit: null };
}

/**
 * Build the prompt for AI-based seed data generation
 * @param {string} entityName - Name of entity to generate
 * @param {Object} schema - Entity schema with columns and types
 * @param {string} instruction - Data generator instruction
 * @param {Object} existingData - FK reference data
 * @param {Object} contextData - Seed context data (validation/constraint entities)
 * @param {Object} backRefData - Back-reference data (entities that reference this one)
 */
function buildPrompt(entityName, schema, instruction, existingData, contextData = {}, backRefData = {}) {
  // Parse [FKLIMIT=n] from instruction
  const { cleanInstruction, fkLimit } = parseFkLimit(instruction);
  // System columns that should be excluded from AI prompt (auto-managed by database)
  const systemColumns = new Set(['id', '_created_at', '_updated_at', '_version']);

  // Filter out computed columns (DAILY, IMMEDIATE, HOURLY, ON_DEMAND annotations)
  // Exception: computed FK columns are kept — they provide relationship context for the AI
  const isComputedColumn = (col) => {
    if (col.foreignKey) return false;
    if (col.computed) return true;
    const desc = col.description || '';
    return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
  };

  // Prepare column info with types (excluding computed and system columns)
  const columnInfo = schema.columns
    .filter(col => !isComputedColumn(col) && !systemColumns.has(col.name))
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

  const typeDefinitions = schema.types || {};

  // Build FK reference summary (with optional limit)
  const fkSummary = {};
  for (const [refEntity, entityData] of Object.entries(existingData)) {
    let records = Array.isArray(entityData) ? entityData : entityData.records;
    const labelFields = Array.isArray(entityData) ? null : entityData.labelFields;
    const hasComputedLabel = entityData?.hasComputedLabel || false;

    if (records && records.length > 0) {
      // Apply fkLimit: random selection of N records
      if (fkLimit && records.length > fkLimit) {
        records = shuffleArray(records).slice(0, fkLimit);
      }

      fkSummary[refEntity] = records.map(r => {
        let label = null;
        // Priority 1: Use computed _label if entity has labelExpression
        if (hasComputedLabel && r._label) {
          label = r._label;
        }
        // Priority 2: Use configured labelFields
        if (!label) {
          const primaryField = labelFields?.primary || (Array.isArray(labelFields) ? labelFields[0] : null);
          if (primaryField) {
            label = r[primaryField];
          }
        }
        // Priority 3: Fallback to common field names
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
${cleanInstruction}

## Available Foreign Key References
${Object.keys(fkSummary).length > 0 ? JSON.stringify(fkSummary, null, 2) : 'None - no referenced entities have seed data yet.'}
${buildBackReferenceSection(entityName, backRefData)}${buildSeedContextSection(contextData)}
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

## Output Format
Return ONLY a valid JSON array. No markdown, no explanation. Use compact JSON (no pretty-printing).`;
}

/**
 * Build the prompt for AI-based seed data completion (filling missing attributes)
 * @param {string} entityName - Name of entity to complete
 * @param {Object} schema - Entity schema with columns and types
 * @param {string} instruction - Data completer instruction
 * @param {Array} existingRecords - Current records to complete (with IDs)
 * @param {Object} fkData - FK reference data
 * @param {Object} contextData - Seed context data (validation/constraint entities)
 */
function buildCompletePrompt(entityName, schema, instruction, existingRecords, fkData = {}, contextData = {}) {
  // System columns that should be excluded from AI prompt (auto-managed by database)
  const systemColumns = new Set(['id', '_created_at', '_updated_at', '_version']);

  // Filter out computed columns (same logic as buildPrompt)
  const isComputedColumn = (col) => {
    if (col.foreignKey) return false;
    if (col.computed) return true;
    const desc = col.description || '';
    return /\[(DAILY|IMMEDIATE|HOURLY|ON_DEMAND)=/.test(desc);
  };

  const columnInfo = schema.columns
    .filter(col => !isComputedColumn(col) && !systemColumns.has(col.name))
    .map(col => {
      const info = { name: col.name, type: col.type, nullable: col.nullable };
      if (col.foreignKey) info.foreignKey = col.foreignKey;
      return info;
    });

  const typeDefinitions = schema.types || {};

  // Build FK reference summary (same as buildPrompt)
  const fkSummary = {};
  for (const [refEntity, entityData] of Object.entries(fkData)) {
    const records = Array.isArray(entityData) ? entityData : entityData.records;
    const labelFields = Array.isArray(entityData) ? null : entityData.labelFields;
    const hasComputedLabel = entityData?.hasComputedLabel || false;

    if (records && records.length > 0) {
      fkSummary[refEntity] = records.map(r => {
        let label = null;
        // Priority 1: Use computed _label if entity has labelExpression
        if (hasComputedLabel && r._label) {
          label = r._label;
        }
        // Priority 2: Use configured labelFields
        if (!label) {
          const primaryField = labelFields?.primary || (Array.isArray(labelFields) ? labelFields[0] : null);
          if (primaryField) label = r[primaryField];
        }
        // Priority 3: Fallback to common field names
        if (!label) {
          label = r.name || r.title || r.designation || r.registration || r.serial_number || r.icao_code || `#${r.id}`;
        }
        return { id: r.id, label };
      });
    }
  }

  return `Complete missing data for the entity "${entityName}".

## Entity Schema
${JSON.stringify(columnInfo, null, 2)}

## Type Definitions (patterns and enums must be respected!)
${JSON.stringify(typeDefinitions, null, 2)}

## Instruction
${instruction}

## Available Foreign Key References
${Object.keys(fkSummary).length > 0 ? JSON.stringify(fkSummary, null, 2) : 'None - no referenced entities have data.'}
${buildSeedContextSection(contextData)}
## Existing Records to Complete
The following records need completion. Fill in NULL or missing values as instructed.
IMPORTANT: Keep the "id" field unchanged for each record!

${JSON.stringify(existingRecords, null, 2)}

## Requirements
- Return the COMPLETE list of records with filled-in values
- Keep ALL existing "id" values unchanged - this is critical for database updates
- Only modify fields that are NULL or missing (unless instruction says otherwise)
- Respect all type constraints (patterns, enums)
- For foreign keys, use LABEL values (not IDs) - they will be resolved automatically
- Generate realistic, plausible values based on the instruction and other field values

## Output Format
Return ONLY a valid JSON array containing ALL records (with their original IDs). No markdown, no explanation. Use compact JSON (no pretty-printing).`;
}

/**
 * Build the Seed Context section of the prompt
 * @param {Object} contextData - { EntityName: { records, attributes } }
 * @returns {string} Formatted context section or empty string
 */
function buildSeedContextSection(contextData) {
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
 * Build the Back-Reference section of the prompt
 * @param {string} entityName - Name of entity being generated
 * @param {Object} backRefData - { EntityName: { records: [...], referencingColumn: "..." } }
 * @returns {string} Formatted back-reference section or empty string
 */
function buildBackReferenceSection(entityName, backRefData) {
  if (!backRefData || Object.keys(backRefData).length === 0) {
    return '';
  }

  let section = `\n## Referencing Entities (Context)\n`;
  section += `The following entities have foreign key columns that can reference ${entityName}.\n`;
  section += `These records already exist and may want to link to the new ${entityName} records you generate.\n`;
  section += `Consider their business keys when generating compatible data:\n\n`;
  section += JSON.stringify(backRefData, null, 2);
  section += '\n\n';

  return section;
}

/**
 * Load context data for seed generation (non-FK validation entities)
 * @param {Array<{entity: string, attributes: string[]|null}>} contextSpecs
 * @param {Function} getDatabase - Function to get database connection
 * @param {Object} fullSchema - Full schema with all entities
 * @returns {Object} { EntityName: { records: [...], attributes: [...] } }
 */
function loadSeedContext(contextSpecs, getDatabase, fullSchema) {
  if (!contextSpecs || contextSpecs.length === 0 || !getDatabase) {
    return {};
  }

  const db = getDatabase();
  const contextData = {};

  for (const spec of contextSpecs) {
    const entity = fullSchema?.entities?.[spec.entity];
    if (!entity) continue;

    try {
      const viewName = entity.tableName + '_view';
      const records = db.prepare(`SELECT * FROM ${viewName}`).all();

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
 * Parse AI response text and extract JSON array
 * Handles markdown code blocks, surrounding text, and truncation detection.
 * @param {string} text - Raw AI response text
 * @returns {Array} Parsed array of record objects (without 'id' fields)
 */
function parseResponse(text) {
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
    throw new Error('No valid JSON array found in response');
  }

  try {
    const data = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(data)) {
      throw new Error('Response is not an array');
    }
    // Remove 'id' fields — they should be auto-generated by the database
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
function loadExistingDataForFKs(entitySchema, getDatabase, fullSchema = null) {
  const fkColumns = entitySchema.columns.filter(c => c.foreignKey);
  const existingData = {};
  const seedOnlyFKs = []; // FK entities loaded from seed file (not in DB)

  for (const col of fkColumns) {
    const refEntity = col.foreignKey.entity;
    const refTable = col.foreignKey.table;
    let records = [];
    let labelFields = null;
    let hasComputedLabel = false;
    let fromSeed = false;

    if (fullSchema && fullSchema.entities && fullSchema.entities[refEntity]) {
      labelFields = fullSchema.entities[refEntity].ui?.labelFields;
      hasComputedLabel = fullSchema.entities[refEntity].ui?.hasComputedLabel || false;
    }

    // Try to load from database first - use VIEW to get computed _label
    if (getDatabase) {
      try {
        const db = getDatabase();
        const viewName = refTable + '_view';
        // Try view first (has _label for computed labels), fall back to table
        try {
          records = db.prepare(`SELECT * FROM ${viewName}`).all() || [];
        } catch (viewErr) {
          records = db.prepare(`SELECT * FROM ${refTable}`).all() || [];
        }
      } catch (e) {
        // Table might not exist yet, ignore
      }
    }

    // Fallback: load from seed JSON file if database is empty
    if (records.length === 0) {
      try {
        const seedDir = SeedManager.getSeedDir();
        const seedFile = path.join(seedDir, `${refEntity}.json`);
        if (fs.existsSync(seedFile)) {
          const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
          if (Array.isArray(seedData) && seedData.length > 0) {
            records = seedData.map((r, idx) => ({ id: idx + 1, ...r }));
            fromSeed = true;
          }
        }
      } catch (e) {
        // Seed file might not exist or be invalid, ignore
      }
    }

    if (records.length > 0) {
      existingData[refEntity] = {
        records,
        labelFields,
        hasComputedLabel
      };
      if (fromSeed) {
        seedOnlyFKs.push(refEntity);
      }
    }
  }

  return { existingData, seedOnlyFKs };
}

/**
 * Load data from entities that REFERENCE the target entity (back-references).
 * Provides context for the AI about what data might want to link to the new records.
 * @param {string} entityName - Name of the entity being generated
 * @param {Function} getDatabase - Function to get database connection
 * @param {Object} fullSchema - Full schema with inverseRelationships
 */
function loadBackReferenceData(entityName, getDatabase, fullSchema) {
  if (!getDatabase || !fullSchema) {
    return {};
  }

  const db = getDatabase();
  const inverseRels = fullSchema.inverseRelationships?.[entityName] || [];
  const backRefData = {};

  for (const rel of inverseRels) {
    const refEntityDef = fullSchema.entities[rel.entity];
    if (!refEntityDef) continue;

    try {
      const records = db.prepare(`SELECT * FROM ${refEntityDef.tableName}`).all();
      if (records && records.length > 0) {
        // labelFields can be object {primary, secondary} or array
        const labelFieldsObj = refEntityDef.ui?.labelFields;
        const labelFieldsArr = labelFieldsObj?.primary
          ? [labelFieldsObj.primary, labelFieldsObj.secondary].filter(Boolean)
          : (Array.isArray(labelFieldsObj) ? labelFieldsObj : []);
        const fallbackFields = ['name', 'title', 'designation', 'serial_number', 'registration', 'icao_code'];

        backRefData[rel.entity] = {
          records: records.map(r => {
            let label = null;
            for (const field of [...labelFieldsArr, ...fallbackFields]) {
              if (r[field]) {
                label = r[field];
                break;
              }
            }
            return { id: r.id, label: label || `#${r.id}` };
          }),
          referencingColumn: rel.column
        };
      }
    } catch (e) {
      // Table might not exist yet, ignore
    }
  }

  return backRefData;
}

module.exports = {
  buildPrompt,
  buildCompletePrompt,
  buildSeedContextSection,
  buildBackReferenceSection,
  loadSeedContext,
  parseResponse,
  loadExistingDataForFKs,
  loadBackReferenceData
};
