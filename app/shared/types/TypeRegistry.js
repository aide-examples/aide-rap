/**
 * TypeRegistry - Central registry for custom type definitions
 * Works on server (Node.js) and client (browser)
 *
 * Supports:
 * - Built-in types (int, string, date, boolean)
 * - Pattern types (regex validation)
 * - Enum types (internal/external value mapping)
 *
 * Type resolution order:
 * 1. Entity-local types (highest priority)
 * 2. Global types (from Types.md)
 * 3. Built-in types
 */

class TypeRegistry {
  constructor() {
    /**
     * Type storage
     * Key format:
     *   - Global: "TypeName"
     *   - Entity-local: "entity:EntityName:TypeName"
     * @type {Map<string, Object>}
     */
    this.types = new Map();

    /**
     * Built-in type names
     */
    this.builtInTypes = ['int', 'string', 'date', 'bool', 'boolean'];

    /**
     * Built-in type definitions
     */
    this.builtInDefs = {
      int: {
        kind: 'builtin',
        sqlType: 'INTEGER',
        jsType: 'number',
        validation: { type: 'number' }
      },
      string: {
        kind: 'builtin',
        sqlType: 'TEXT',
        jsType: 'string',
        validation: { type: 'string' }
      },
      date: {
        kind: 'builtin',
        sqlType: 'TEXT',
        jsType: 'string',
        validation: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
      },
      bool: {
        kind: 'builtin',
        sqlType: 'INTEGER',
        jsType: 'boolean',
        validation: { type: 'boolean' }
      },
      boolean: {
        kind: 'builtin',
        sqlType: 'INTEGER',
        jsType: 'boolean',
        validation: { type: 'boolean' }
      }
    };
  }

  /**
   * Registers a type definition
   * @param {string} name - Type name (e.g. 'TailSign')
   * @param {Object} definition - Type definition
   * @param {string} definition.kind - 'pattern' | 'enum'
   * @param {string} [definition.pattern] - Regex pattern (for kind='pattern')
   * @param {Array} [definition.values] - Enum values (for kind='enum')
   * @param {string} [definition.description] - Human-readable description
   * @param {string} [definition.example] - Example value
   * @param {string} [scope='global'] - 'global' or 'entity:EntityName'
   */
  register(name, definition, scope = 'global') {
    const key = scope === 'global' ? name : `${scope}:${name}`;
    this.types.set(key, { ...definition, name, scope });
  }

  /**
   * Registers a pattern type
   * @param {string} name - Type name
   * @param {string} pattern - Regex pattern
   * @param {Object} options - Additional options
   * @param {string} [options.description] - Description
   * @param {string} [options.example] - Example value
   * @param {string} [scope='global'] - Scope
   */
  registerPattern(name, pattern, options = {}, scope = 'global') {
    this.register(name, {
      kind: 'pattern',
      pattern,
      description: options.description || '',
      example: options.example || ''
    }, scope);
  }

  /**
   * Registers an enum type
   * @param {string} name - Type name
   * @param {Array<Object>} values - Array of { internal, external, description }
   * @param {string} [scope='global'] - Scope
   */
  registerEnum(name, values, scope = 'global') {
    this.register(name, {
      kind: 'enum',
      values: values.map(v => ({
        internal: v.internal,
        external: v.external,
        description: v.description || ''
      }))
    }, scope);
  }

  /**
   * Checks if a type exists
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context for local types
   * @returns {boolean}
   */
  has(name, entityName = null) {
    return this.resolve(name, entityName) !== null;
  }

  /**
   * Resolves a type by name with precedence:
   * 1. Entity-local type
   * 2. Global type
   * 3. Built-in type
   *
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context for local type lookup
   * @returns {Object|null} - Type definition or null
   */
  resolve(name, entityName = null) {
    // 1. Entity-local type
    if (entityName) {
      const localKey = `entity:${entityName}:${name}`;
      if (this.types.has(localKey)) {
        return this.types.get(localKey);
      }
    }

    // 2. Global type
    if (this.types.has(name)) {
      return this.types.get(name);
    }

    // 3. Built-in type
    if (this.builtInTypes.includes(name)) {
      return this.builtInDefs[name];
    }

    return null;
  }

  /**
   * Checks if a type is built-in
   * @param {string} name - Type name
   * @returns {boolean}
   */
  isBuiltIn(name) {
    return this.builtInTypes.includes(name);
  }

  /**
   * Checks if a type is an enum
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context
   * @returns {boolean}
   */
  isEnum(name, entityName = null) {
    const type = this.resolve(name, entityName);
    return type && type.kind === 'enum';
  }

  /**
   * Checks if a type is a pattern type
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context
   * @returns {boolean}
   */
  isPattern(name, entityName = null) {
    const type = this.resolve(name, entityName);
    return type && type.kind === 'pattern';
  }

  /**
   * Gets the SQL type for a custom type
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context
   * @returns {string} - SQL type (INTEGER, TEXT, etc.)
   */
  getSqlType(name, entityName = null) {
    const type = this.resolve(name, entityName);
    if (!type) return 'TEXT';

    if (type.kind === 'builtin') {
      return type.sqlType;
    }

    if (type.kind === 'enum') {
      // Check if internal values are numbers or strings
      const firstValue = type.values[0];
      if (firstValue && typeof firstValue.internal === 'number') {
        return 'INTEGER';
      }
      return 'TEXT';
    }

    // Pattern types are always TEXT
    return 'TEXT';
  }

  /**
   * Generates validation rules for ObjectValidator
   * @param {string} name - Type name
   * @param {string} [entityName] - Entity context
   * @returns {Object|null} - Validation rules or null
   */
  toValidationRules(name, entityName = null) {
    const type = this.resolve(name, entityName);
    if (!type) return null;

    if (type.kind === 'builtin') {
      return { ...type.validation };
    }

    if (type.kind === 'pattern') {
      const rules = {
        type: 'string',
        pattern: type.pattern
      };
      // Include description and example for better error messages
      if (type.description) {
        rules.patternDescription = type.description;
      }
      if (type.example) {
        rules.patternExample = type.example;
      }
      return rules;
    }

    if (type.kind === 'enum') {
      return {
        enum: {
          values: type.values.map(v => ({
            value: v.internal,
            label: v.external
          }))
        }
      };
    }

    return null;
  }

  /**
   * Converts internal value to external (display) value for enums
   * @param {string} typeName - Type name
   * @param {*} internalValue - Internal value stored in DB
   * @param {string} [entityName] - Entity context
   * @returns {*} - External value or original if not an enum
   */
  toExternal(typeName, internalValue, entityName = null) {
    const type = this.resolve(typeName, entityName);
    if (!type || type.kind !== 'enum') return internalValue;

    const match = type.values.find(v => v.internal === internalValue);
    return match ? match.external : internalValue;
  }

  /**
   * Converts external (display) value to internal value for enums
   * @param {string} typeName - Type name
   * @param {*} externalValue - External value from user input
   * @param {string} [entityName] - Entity context
   * @returns {*} - Internal value or original if not an enum
   */
  toInternal(typeName, externalValue, entityName = null) {
    const type = this.resolve(typeName, entityName);
    if (!type || type.kind !== 'enum') return externalValue;

    const match = type.values.find(v => v.external === externalValue);
    return match ? match.internal : externalValue;
  }

  /**
   * Gets all enum values for a type
   * @param {string} typeName - Type name
   * @param {string} [entityName] - Entity context
   * @returns {Array|null} - Array of { internal, external, description } or null
   */
  getEnumValues(typeName, entityName = null) {
    const type = this.resolve(typeName, entityName);
    if (!type || type.kind !== 'enum') return null;
    return [...type.values];
  }

  /**
   * Gets the pattern for a pattern type
   * @param {string} typeName - Type name
   * @param {string} [entityName] - Entity context
   * @returns {string|null} - Pattern or null
   */
  getPattern(typeName, entityName = null) {
    const type = this.resolve(typeName, entityName);
    if (!type || type.kind !== 'pattern') return null;
    return type.pattern;
  }

  /**
   * Validates a value against a type
   * @param {string} typeName - Type name
   * @param {*} value - Value to validate
   * @param {string} [entityName] - Entity context
   * @returns {Object} - { valid: boolean, error?: string }
   */
  validate(typeName, value, entityName = null) {
    const type = this.resolve(typeName, entityName);

    if (!type) {
      return { valid: false, error: `Unknown type: ${typeName}` };
    }

    if (value === null || value === undefined) {
      return { valid: true }; // Required check is separate
    }

    if (type.kind === 'builtin') {
      const jsType = type.jsType;
      if (jsType === 'number' && typeof value !== 'number') {
        return { valid: false, error: `Expected number, got ${typeof value}` };
      }
      if (jsType === 'string' && typeof value !== 'string') {
        return { valid: false, error: `Expected string, got ${typeof value}` };
      }
      if (jsType === 'boolean' && typeof value !== 'boolean') {
        return { valid: false, error: `Expected boolean, got ${typeof value}` };
      }
      return { valid: true };
    }

    if (type.kind === 'pattern') {
      if (typeof value !== 'string') {
        return { valid: false, error: `Pattern type requires string value` };
      }
      const regex = new RegExp(type.pattern);
      if (!regex.test(value)) {
        return { valid: false, error: `Value does not match pattern: ${type.pattern}` };
      }
      return { valid: true };
    }

    if (type.kind === 'enum') {
      const validValues = type.values.map(v => v.internal);
      if (!validValues.includes(value)) {
        return {
          valid: false,
          error: `Invalid enum value. Valid values: ${validValues.join(', ')}`
        };
      }
      return { valid: true };
    }

    return { valid: true };
  }

  /**
   * Returns all registered types (for debugging/export)
   * @returns {Object} - { typeName: definition }
   */
  getAllTypes() {
    const result = {};
    for (const [key, def] of this.types.entries()) {
      result[key] = def;
    }
    return result;
  }

  /**
   * Returns all global types
   * @returns {Object}
   */
  getGlobalTypes() {
    const result = {};
    for (const [key, def] of this.types.entries()) {
      if (def.scope === 'global') {
        result[key] = def;
      }
    }
    return result;
  }

  /**
   * Returns all types for a specific entity (local + global fallback)
   * @param {string} entityName - Entity name
   * @returns {Object}
   */
  getTypesForEntity(entityName) {
    const result = {};

    // Add global types first
    for (const [key, def] of this.types.entries()) {
      if (def.scope === 'global') {
        result[def.name] = def;
      }
    }

    // Override with entity-local types
    const prefix = `entity:${entityName}:`;
    for (const [key, def] of this.types.entries()) {
      if (key.startsWith(prefix)) {
        result[def.name] = def;
      }
    }

    return result;
  }

  /**
   * Clears all registered types (useful for testing)
   */
  clear() {
    this.types.clear();
  }

  /**
   * Serializes registry to JSON (for client transfer)
   * @returns {Object}
   */
  toJSON() {
    return {
      types: Object.fromEntries(this.types)
    };
  }

  /**
   * Loads types from JSON (on client)
   * @param {Object} data - { types: { key: definition } }
   */
  loadFromJSON(data) {
    if (data.types) {
      for (const [key, def] of Object.entries(data.types)) {
        this.types.set(key, def);
      }
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Gets the singleton TypeRegistry instance
 * @returns {TypeRegistry}
 */
function getTypeRegistry() {
  if (!instance) {
    instance = new TypeRegistry();
  }
  return instance;
}

/**
 * Resets the singleton (for testing)
 */
function resetTypeRegistry() {
  instance = null;
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TypeRegistry, getTypeRegistry, resetTypeRegistry };
} else if (typeof window !== 'undefined') {
  window.TypeRegistry = TypeRegistry;
  window.getTypeRegistry = getTypeRegistry;
  window.resetTypeRegistry = resetTypeRegistry;
}
