/**
 * API Client - REST API Wrapper for Entity CRUD operations
 */
const ApiClient = {
  baseUrl: '/api/entities',

  /**
   * Make a fetch request with error handling
   */
  async request(url, options = {}) {
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error?.message || 'Request failed');
      error.status = response.status;
      error.code = data.error?.code;
      error.details = data.error?.details;
      throw error;
    }

    return data;
  },

  /**
   * Get list of available entity types with area info
   */
  async getEntityTypes() {
    const data = await this.request(this.baseUrl);
    return { entities: data.entities, areas: data.areas };
  },

  /**
   * Get schema for an entity type
   */
  async getSchema(entityName) {
    return this.request(`${this.baseUrl}/${entityName}/schema`);
  },

  /**
   * Get extended schema with UI metadata
   */
  async getExtendedSchema(entityName) {
    return this.request(`${this.baseUrl}/${entityName}/schema/extended`);
  },

  /**
   * Get back-references to a specific record
   */
  async getBackReferences(entityName, id) {
    return this.request(`${this.baseUrl}/${entityName}/${id}/references`);
  },

  /**
   * Get all records for an entity type
   * @param {string} entityName
   * @param {Object} options - { filter, sort, order, limit, offset }
   */
  async getAll(entityName, options = {}) {
    const params = new URLSearchParams();
    if (options.filter) params.set('filter', options.filter);
    if (options.sort) params.set('sort', options.sort);
    if (options.order) params.set('order', options.order);
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);

    const queryString = params.toString();
    const url = queryString
      ? `${this.baseUrl}/${entityName}?${queryString}`
      : `${this.baseUrl}/${entityName}`;

    return this.request(url);
  },

  /**
   * Get a single record by ID
   */
  async getById(entityName, id) {
    return this.request(`${this.baseUrl}/${entityName}/${id}`);
  },

  /**
   * Create a new record
   */
  async create(entityName, data) {
    return this.request(`${this.baseUrl}/${entityName}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Update an existing record
   */
  async update(entityName, id, data) {
    return this.request(`${this.baseUrl}/${entityName}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete a record
   */
  async delete(entityName, id) {
    return this.request(`${this.baseUrl}/${entityName}/${id}`, {
      method: 'DELETE',
    });
  },
};

// Schema cache to avoid repeated fetches
const SchemaCache = {
  cache: {},
  extendedCache: {},

  async get(entityName) {
    if (!this.cache[entityName]) {
      this.cache[entityName] = await ApiClient.getSchema(entityName);
    }
    return this.cache[entityName];
  },

  async getExtended(entityName) {
    if (!this.extendedCache[entityName]) {
      this.extendedCache[entityName] = await ApiClient.getExtendedSchema(entityName);
    }
    return this.extendedCache[entityName];
  },

  clear() {
    this.cache = {};
    this.extendedCache = {};
  },
};

/**
 * ValueFormatter - Format values for UI display
 * Handles enum internal->external conversion
 */
const ValueFormatter = {
  /**
   * Format a value for display based on column definition
   * For enum fields, converts internal value to external representation
   *
   * @param {*} value - The raw value from the database
   * @param {string} columnName - The column name
   * @param {Object} schema - The entity schema (must have enumFields)
   * @returns {string} - Formatted display value
   */
  format(value, columnName, schema) {
    if (value === null || value === undefined) {
      return null;
    }

    // Check if this is an enum field
    const enumDef = schema.enumFields?.[columnName];
    if (enumDef && enumDef.values) {
      // Find matching enum value by internal value
      const match = enumDef.values.find(v =>
        String(v.internal) === String(value)
      );
      if (match) {
        return match.external;
      }
    }

    return String(value);
  },

  /**
   * Format a value for display, returning null display text for null values
   *
   * @param {*} value - The raw value
   * @param {string} columnName - The column name
   * @param {Object} schema - The entity schema
   * @returns {string} - Formatted display value or '<em>null</em>' for null
   */
  formatWithNull(value, columnName, schema) {
    if (value === null || value === undefined) {
      return '<em class="null-value">null</em>';
    }
    return this.format(value, columnName, schema);
  },

  /**
   * Check if a column is an enum field
   *
   * @param {string} columnName - The column name
   * @param {Object} schema - The entity schema
   * @returns {boolean}
   */
  isEnumField(columnName, schema) {
    return !!schema.enumFields?.[columnName];
  },

  /**
   * Get enum values for a column (for dropdowns etc.)
   *
   * @param {string} columnName - The column name
   * @param {Object} schema - The entity schema
   * @returns {Array|null} - Array of {internal, external, description} or null
   */
  getEnumValues(columnName, schema) {
    return schema.enumFields?.[columnName]?.values || null;
  }
};
