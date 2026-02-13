/**
 * ObjectValidator - Rule-based object validation
 * Works on server (Node.js) and client (browser)
 */

class ObjectValidator {
  constructor() {
    // Determine ValidationError reference (browser or Node.js)
    this.ValidationError = this._getValidationError();

    /**
     * Rule registry
     * @type {Map<string, Object>} - entityType -> { fieldName: rules }
     */
    this.rules = new Map();

    /**
     * Available rule types and their validators
     */
    this.validators = {
      type: this._validateType.bind(this),
      required: this._validateRequired.bind(this),
      pattern: this._validatePattern.bind(this),
      maxLength: this._validateMaxLength.bind(this),
      minLength: this._validateMinLength.bind(this),
      min: this._validateMin.bind(this),
      max: this._validateMax.bind(this),
      enum: this._validateEnum.bind(this),
      email: this._validateEmail.bind(this),
      json: this._validateJson.bind(this),
      minItems: this._validateMinItems.bind(this),
      maxItems: this._validateMaxItems.bind(this),
      itemType: this._validateItemType.bind(this),
      itemRules: this._validateItemRules.bind(this)
    };

    /**
     * Available transformations
     */
    this.transformers = {
      trim: this._transformTrim.bind(this),
      round: this._transformRound.bind(this),
      uppercase: this._transformUppercase.bind(this),
      lowercase: this._transformLowercase.bind(this)
    };
  }

  /**
   * Determines ValidationError class (browser or Node.js)
   * @private
   */
  _getValidationError() {
    if (typeof window !== 'undefined' && window.ValidationError) {
      // Browser: use global ValidationError
      return window.ValidationError;
    } else if (typeof require !== 'undefined') {
      // Node.js: Require ValidationError
      return require('./ValidationError.js');
    }
    throw new Error('ValidationError not available');
  }

  /**
   * Checks if rules for an entity type are already defined
   * @param {string} entityType - Name of the entity type
   * @returns {boolean}
   */
  hasRules(entityType) {
    return this.rules.has(entityType);
  }

  /**
   * Defines validation rules for an entity type
   * @param {string} entityType - Name of the entity type (e.g. 'Aircraft')
   * @param {Object} fieldRules - Object with fieldName -> rules mapping
   * @param {boolean} allowOverwrite - Allow overwriting existing rules (default: false)
   * @throws {Error} - If rules already exist and allowOverwrite=false
   */
  defineRules(entityType, fieldRules, allowOverwrite = false) {
    if (this.rules.has(entityType) && !allowOverwrite) {
      throw new Error(`Validation rules for entity type "${entityType}" are already defined. Set allowOverwrite=true to replace.`);
    }
    this.rules.set(entityType, fieldRules);
  }

  /**
   * Returns all rules for an entity type
   * @param {string} entityType - Name of the entity type
   * @returns {Object|null}
   */
  getRules(entityType) {
    return this.rules.get(entityType) || null;
  }

  /**
   * Returns all defined rules (for client prefetch)
   * @returns {Object} - { entityType: rules }
   */
  getAllRules() {
    const allRules = {};
    for (const [entityType, rules] of this.rules.entries()) {
      allRules[entityType] = rules;
    }
    return allRules;
  }

  /**
   * Loads rules from JSON (for client)
   * @param {Object} rulesData - { entityType: rules }
   */
  loadRules(rulesData) {
    for (const [entityType, rules] of Object.entries(rulesData)) {
      this.defineRules(entityType, rules);
    }
  }

  /**
   * Validates an object against defined rules
   * @param {string} entityType - Entity type
   * @param {Object} obj - Object to validate
   * @returns {Object} - Validated and transformed object
   * @throws {ValidationError} - On validation errors
   */
  validate(entityType, obj) {
    const rules = this.rules.get(entityType);

    if (!rules) {
      throw new Error(`No validation rules defined for entity type: ${entityType}`);
    }

    const errors = [];
    const transformed = { ...obj };

    // Phase 1: Validation (collect all errors)
    for (const [fieldName, fieldRules] of Object.entries(rules)) {
      const value = obj[fieldName];
      const fieldErrors = this._validateField(fieldName, value, fieldRules);
      errors.push(...fieldErrors);
    }

    // On errors: abort before transformation
    if (errors.length > 0) {
      throw new this.ValidationError(errors);
    }

    // Phase 2: Transformation (only on successful validation)
    for (const [fieldName, fieldRules] of Object.entries(rules)) {
      transformed[fieldName] = this._transformField(obj[fieldName], fieldRules);
    }

    return transformed;
  }

  /**
   * Validates only the provided fields (for partial updates).
   * Skips required-check for fields not present in obj.
   * @param {string} entityType - Entity type
   * @param {Object} obj - Partial object to validate
   * @returns {Object} - Validated and transformed partial object
   * @throws {ValidationError} - On validation errors
   */
  validatePartial(entityType, obj) {
    const rules = this.rules.get(entityType);

    if (!rules) {
      throw new Error(`No validation rules defined for entity type: ${entityType}`);
    }

    const errors = [];
    const transformed = { ...obj };

    // Only validate fields that are present in the input
    for (const [fieldName, value] of Object.entries(obj)) {
      const fieldRules = rules[fieldName];
      if (!fieldRules) continue; // ignore unknown fields (will be filtered out by repository)
      const fieldErrors = this._validateField(fieldName, value, fieldRules);
      errors.push(...fieldErrors);
    }

    if (errors.length > 0) {
      throw new this.ValidationError(errors);
    }

    // Transform only the provided fields
    for (const [fieldName] of Object.entries(obj)) {
      const fieldRules = rules[fieldName];
      if (!fieldRules) continue;
      transformed[fieldName] = this._transformField(obj[fieldName], fieldRules);
    }

    return transformed;
  }

  /**
   * Validates a single field (for client UI)
   * @param {string} entityType - Entity type
   * @param {string} fieldName - Field name
   * @param {*} value - Value
   * @throws {ValidationError} - On validation errors
   */
  validateField(entityType, fieldName, value) {
    const rules = this.rules.get(entityType);

    if (!rules || !rules[fieldName]) {
      throw new Error(`No validation rules defined for ${entityType}.${fieldName}`);
    }

    const errors = this._validateField(fieldName, value, rules[fieldName]);

    if (errors.length > 0) {
      throw new this.ValidationError(errors);
    }
  }

  /**
   * Returns a specific rule for a field
   * @param {string} entityType - Entity type
   * @param {string} fieldName - Field name
   * @param {string} ruleName - Rule name (e.g. 'maxLength')
   * @returns {*} - Rule value or undefined
   */
  getRule(entityType, fieldName, ruleName) {
    const rules = this.rules.get(entityType);
    if (!rules || !rules[fieldName]) return undefined;
    return rules[fieldName][ruleName];
  }

  // ==================== Internal validation methods ====================

  /**
   * Validates a single field
   * @private
   */
  _validateField(fieldName, value, fieldRules) {
    const errors = [];

    // Trim BEFORE validation (if trim: true)
    let workingValue = value;
    if (fieldRules.trim && typeof value === 'string') {
      workingValue = value.trim();
    }

    // Order matters: required first
    if (fieldRules.required !== undefined) {
      const error = this.validators.required(fieldName, workingValue, fieldRules.required);
      if (error) {
        errors.push(error);
        return errors; // On required error, no further checks
      }
    }

    // If not required and empty/undefined, skip
    if (workingValue === undefined || workingValue === null || workingValue === '') {
      return errors;
    }

    // All other validations (with trimmed value)
    const skipRules = ['required', 'default', 'trim', 'transform', 'message', 'patternDescription', 'patternExample'];

    for (const [ruleName, ruleValue] of Object.entries(fieldRules)) {
      if (skipRules.includes(ruleName)) continue;

      const validator = this.validators[ruleName];
      if (validator) {
        // Pass fieldRules as 4th parameter for validators that need additional context
        const error = validator(fieldName, workingValue, ruleValue, fieldRules);
        if (error) errors.push(error);
      }
    }

    return errors;
  }

  /**
   * Transforms a field
   * @private
   */
  _transformField(value, fieldRules) {
    let transformed = value;

    // Default value if empty
    if ((value === undefined || value === null || value === '') && fieldRules.default !== undefined) {
      return fieldRules.default;
    }

    // Trim
    if (fieldRules.trim && typeof transformed === 'string') {
      transformed = this.transformers.trim(transformed);
    }

    // Other transformations
    if (fieldRules.transform) {
      const transformer = this.transformers[fieldRules.transform];
      if (transformer) {
        transformed = transformer(transformed);
      }
    }

    return transformed;
  }

  // ==================== Validator implementations ====================

  _validateType(fieldName, value, expectedType) {
    const actualType = typeof value;

    if (expectedType === 'number' && actualType !== 'number') {
      return {
        field: fieldName,
        code: 'INVALID_TYPE',
        message: `Field "${fieldName}" must be a number`,
        value
      };
    }

    if (expectedType === 'string' && actualType !== 'string') {
      return {
        field: fieldName,
        code: 'INVALID_TYPE',
        message: `Field "${fieldName}" must be a string`,
        value
      };
    }

    if (expectedType === 'boolean' && actualType !== 'boolean') {
      return {
        field: fieldName,
        code: 'INVALID_TYPE',
        message: `Field "${fieldName}" must be a boolean`,
        value
      };
    }

    if (expectedType === 'array' && !Array.isArray(value)) {
      return {
        field: fieldName,
        code: 'INVALID_TYPE',
        message: `Field "${fieldName}" must be an array`,
        value
      };
    }

    // JSON type: accept objects or valid JSON strings
    if (expectedType === 'json') {
      if (typeof value === 'object') return null; // Already an object
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return null;
        } catch {
          return {
            field: fieldName,
            code: 'INVALID_JSON',
            message: `Field "${fieldName}" must be valid JSON`,
            value
          };
        }
      }
      return {
        field: fieldName,
        code: 'INVALID_JSON',
        message: `Field "${fieldName}" must be valid JSON`,
        value
      };
    }

    return null;
  }

  _validateRequired(fieldName, value, isRequired) {
    if (!isRequired) return null;

    if (value === undefined || value === null) {
      return {
        field: fieldName,
        code: 'REQUIRED',
        message: `Field "${fieldName}" is required`,
        value
      };
    }

    if (typeof value === 'string' && value.trim().length === 0) {
      return {
        field: fieldName,
        code: 'REQUIRED',
        message: `Field "${fieldName}" must not be empty`,
        value
      };
    }

    return null;
  }

  _validatePattern(fieldName, value, pattern, fieldRules = {}) {
    if (typeof value !== 'string') return null;

    const regex = new RegExp(pattern);
    if (!regex.test(value)) {
      // Build informative error message using pattern metadata if available
      let message;
      const description = fieldRules.patternDescription;
      const example = fieldRules.patternExample;

      if (description) {
        // Description already includes example info, just use it
        message = `${fieldName}: ${description}`;
      } else if (example) {
        message = `${fieldName} must match format: ${example}`;
      } else {
        message = `Field "${fieldName}" has an invalid format`;
      }

      return {
        field: fieldName,
        code: 'PATTERN_MISMATCH',
        message,
        value,
        // Include metadata for client-side formatting if needed
        pattern,
        example,
        description
      };
    }

    return null;
  }

  _validateMaxLength(fieldName, value, maxLength) {
    if (typeof value !== 'string') return null;

    if (value.length > maxLength) {
      return {
        field: fieldName,
        code: 'MAX_LENGTH_EXCEEDED',
        message: `Field "${fieldName}" must not exceed ${maxLength} characters`,
        value
      };
    }

    return null;
  }

  _validateMinLength(fieldName, value, minLength) {
    if (typeof value !== 'string') return null;

    if (value.length < minLength) {
      return {
        field: fieldName,
        code: 'MIN_LENGTH_NOT_REACHED',
        message: `Field "${fieldName}" must have at least ${minLength} characters`,
        value
      };
    }

    return null;
  }

  _validateMin(fieldName, value, min) {
    if (typeof value !== 'number') return null;

    if (value < min) {
      return {
        field: fieldName,
        code: 'MIN_VALUE_NOT_REACHED',
        message: `Field "${fieldName}" must be at least ${min}`,
        value
      };
    }

    return null;
  }

  _validateMax(fieldName, value, max) {
    if (typeof value !== 'number') return null;

    if (value > max) {
      return {
        field: fieldName,
        code: 'MAX_VALUE_EXCEEDED',
        message: `Field "${fieldName}" must be at most ${max}`,
        value
      };
    }

    return null;
  }

  _validateEnum(fieldName, value, enumDef) {
    const validValues = Array.isArray(enumDef)
      ? enumDef
      : enumDef.values.map(v => v.value);

    if (!validValues.includes(value)) {
      return {
        field: fieldName,
        code: 'INVALID_ENUM_VALUE',
        message: `Field "${fieldName}" has an invalid value`,
        value
      };
    }

    return null;
  }

  _validateEmail(fieldName, value, isEmail) {
    if (!isEmail) return null;
    if (typeof value !== 'string') return null;

    // RFC 5322 compliant email RegEx (simplified but robust)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(value)) {
      return {
        field: fieldName,
        code: 'INVALID_EMAIL',
        message: `Field "${fieldName}" must be a valid email address`,
        value
      };
    }

    return null;
  }

  _validateJson(fieldName, value, isJson) {
    if (!isJson) return null;
    if (value === null || value === undefined) return null;

    // Objects are valid JSON
    if (typeof value === 'object') return null;

    // Strings must be parseable as JSON
    if (typeof value === 'string') {
      try {
        JSON.parse(value);
        return null;
      } catch {
        return {
          field: fieldName,
          code: 'INVALID_JSON',
          message: `Field "${fieldName}" must be valid JSON`,
          value
        };
      }
    }

    return {
      field: fieldName,
      code: 'INVALID_JSON',
      message: `Field "${fieldName}" must be valid JSON`,
      value
    };
  }

  // ==================== Array validator implementations ====================

  _validateMinItems(fieldName, value, minItems) {
    if (!Array.isArray(value)) return null;

    if (value.length < minItems) {
      return {
        field: fieldName,
        code: 'MIN_ITEMS_NOT_REACHED',
        message: `Field "${fieldName}" must contain at least ${minItems} item(s)`,
        value
      };
    }

    return null;
  }

  _validateMaxItems(fieldName, value, maxItems) {
    if (!Array.isArray(value)) return null;

    if (value.length > maxItems) {
      return {
        field: fieldName,
        code: 'MAX_ITEMS_EXCEEDED',
        message: `Field "${fieldName}" must contain at most ${maxItems} item(s)`,
        value
      };
    }

    return null;
  }

  _validateItemType(fieldName, value, itemType) {
    if (!Array.isArray(value)) return null;

    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const actualType = typeof item;

      if (itemType === 'string' && actualType !== 'string') {
        return {
          field: fieldName,
          code: 'INVALID_ITEM_TYPE',
          message: `Field "${fieldName}[${i}]" must be a string`,
          value: item
        };
      }

      if (itemType === 'number' && actualType !== 'number') {
        return {
          field: fieldName,
          code: 'INVALID_ITEM_TYPE',
          message: `Field "${fieldName}[${i}]" must be a number`,
          value: item
        };
      }

      if (itemType === 'boolean' && actualType !== 'boolean') {
        return {
          field: fieldName,
          code: 'INVALID_ITEM_TYPE',
          message: `Field "${fieldName}[${i}]" must be a boolean`,
          value: item
        };
      }

      if (itemType === 'object' && (actualType !== 'object' || item === null || Array.isArray(item))) {
        return {
          field: fieldName,
          code: 'INVALID_ITEM_TYPE',
          message: `Field "${fieldName}[${i}]" must be an object`,
          value: item
        };
      }
    }

    return null;
  }

  _validateItemRules(fieldName, value, itemRules) {
    if (!Array.isArray(value)) return null;

    for (let i = 0; i < value.length; i++) {
      const item = value[i];

      // Validate each item against the itemRules
      for (const [ruleName, ruleValue] of Object.entries(itemRules)) {
        if (ruleName === 'message') continue;

        const validator = this.validators[ruleName];
        if (validator) {
          const error = validator(`${fieldName}[${i}]`, item, ruleValue);
          if (error) return error;
        }
      }
    }

    return null;
  }

  // ==================== Transformer implementations ====================

  _transformTrim(value) {
    return typeof value === 'string' ? value.trim() : value;
  }

  _transformRound(value) {
    return typeof value === 'number' ? Math.round(value) : value;
  }

  _transformUppercase(value) {
    return typeof value === 'string' ? value.toUpperCase() : value;
  }

  _transformLowercase(value) {
    return typeof value === 'string' ? value.toLowerCase() : value;
  }
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ObjectValidator;
} else if (typeof window !== 'undefined') {
  window.ObjectValidator = ObjectValidator;
}
