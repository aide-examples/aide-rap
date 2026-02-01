/**
 * API Client - REST API Wrapper for Entity CRUD operations
 */
const ApiClient = {
  baseUrl: '/api/entities',

  /**
   * Get the correct API base URL for an entity
   * System entities like AuditTrail have their own endpoints
   */
  getEntityUrl(entityName) {
    if (entityName === 'AuditTrail') {
      return '/api/audit';
    }
    return `${this.baseUrl}/${entityName}`;
  },

  // --- Internal helpers for unified logic ---

  /**
   * Build query params for data requests (shared by getAll and getViewData)
   * @private
   */
  _buildDataParams(options) {
    const params = new URLSearchParams();
    if (options.filter) params.set('filter', options.filter);
    if (options.sort) params.set('sort', options.sort);
    if (options.order) params.set('order', options.order);
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);
    return params;
  },

  /**
   * Fetch data from a base URL with optional query params
   * @private
   */
  _fetchData(baseUrl, options = {}) {
    const params = this._buildDataParams(options);
    const queryString = params.toString();
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    return this.request(url);
  },

  /**
   * Fetch distinct values from a base URL
   * @private
   */
  _fetchDistinct(baseUrl, columnPath, type = 'select') {
    const params = new URLSearchParams();
    if (type && type !== 'select') params.set('type', type);
    const queryString = params.toString();
    const url = queryString
      ? `${baseUrl}/distinct/${encodeURIComponent(columnPath)}?${queryString}`
      : `${baseUrl}/distinct/${encodeURIComponent(columnPath)}`;
    return this.request(url);
  },

  /**
   * Make a fetch request with error handling
   */
  async request(url, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };

    // Merge headers properly (don't overwrite Content-Type)
    const mergedOptions = {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
    };

    const response = await fetch(url, mergedOptions);

    // Handle 401 Unauthorized - session expired or not authenticated
    if (response.status === 401) {
      if (typeof LoginDialog !== 'undefined') {
        // Show login dialog and reload page after login
        await LoginDialog.show();
        return; // Execution stops here, page will reload
      }
    }

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
    return this.request(`${this.getEntityUrl(entityName)}/schema`);
  },

  /**
   * Get extended schema with UI metadata
   */
  async getExtendedSchema(entityName) {
    return this.request(`${this.getEntityUrl(entityName)}/schema/extended`);
  },

  /**
   * Get back-references to a specific record
   */
  async getBackReferences(entityName, id) {
    return this.request(`${this.getEntityUrl(entityName)}/${id}/references`);
  },

  /**
   * Get distinct values for a column (for prefilter dropdowns)
   * @param {string} entityName - Entity name
   * @param {string} columnPath - Column path (e.g., "meter" or "reading_at")
   * @param {string} type - Extraction type: 'select' (default), 'year', or 'month'
   */
  async getDistinctValues(entityName, columnPath, type = 'select') {
    return this._fetchDistinct(this.getEntityUrl(entityName), columnPath, type);
  },

  /**
   * Get all records for an entity type
   * @param {string} entityName
   * @param {Object} options - { filter, sort, order, limit, offset }
   */
  async getAll(entityName, options = {}) {
    return this._fetchData(this.getEntityUrl(entityName), options);
  },

  /**
   * Get a single record by ID
   */
  async getById(entityName, id) {
    return this.request(`${this.getEntityUrl(entityName)}/${id}`);
  },

  /**
   * Create a new record
   */
  async create(entityName, data) {
    return this.request(this.getEntityUrl(entityName), {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Update an existing record
   * @param {string} entityName - Entity name
   * @param {number} id - Record ID
   * @param {Object} data - Data to update
   * @param {number} version - Expected version for OCC (optional)
   */
  async update(entityName, id, data, version = null) {
    const headers = {};
    if (version !== null) {
      headers['If-Match'] = `"${entityName}:${id}:${version}"`;
    }
    return this.request(`${this.getEntityUrl(entityName)}/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete a record
   */
  async delete(entityName, id) {
    return this.request(`${this.getEntityUrl(entityName)}/${id}`, {
      method: 'DELETE',
    });
  },

  // --- User Views ---

  /**
   * Get list of user views with groups
   */
  async getViews() {
    return this.request('/api/views');
  },

  /**
   * Get view data with optional filter/sort/pagination
   * @param {string} viewName - View display name
   * @param {Object} options - { filter, sort, order, limit, offset }
   */
  async getViewData(viewName, options = {}) {
    return this._fetchData(`/api/views/${encodeURIComponent(viewName)}`, options);
  },

  /**
   * Get view schema (column metadata)
   * @param {string} viewName - View display name
   */
  async getViewSchema(viewName) {
    return this.request(`/api/views/${encodeURIComponent(viewName)}/schema`);
  },

  /**
   * Get distinct values for a view column (for prefilter dropdowns)
   * @param {string} viewName - View display name
   * @param {string} columnName - Column label or sqlAlias
   * @param {string} type - Extraction type: 'select' (default), 'year', or 'month'
   */
  async getViewDistinctValues(viewName, columnName, type = 'select') {
    return this._fetchDistinct(`/api/views/${encodeURIComponent(viewName)}`, columnName, type);
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
      return '';
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
  },

  /**
   * Format a value as HTML for display, handling special types
   * Centralized formatting to reduce redundancy across components
   *
   * @param {*} value - The raw value
   * @param {Object} col - Column definition with name, customType, etc.
   * @param {Object} schema - Entity schema for enum lookup
   * @param {Object} options - { size: 'tiny'|'small'|'medium' } for media
   * @returns {string} - HTML string for display
   */
  formatDisplayHtml(value, col, schema = null, options = {}) {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    // Media: thumbnail with link
    if (col.customType === 'media') {
      const size = options.size || 'tiny';
      const thumbClass = size === 'small' ? 'media-thumb-small' : 'media-thumb-tiny';
      return `<a href="/api/media/${DomUtils.escapeHtml(value)}/file" target="_blank" rel="noopener" class="media-link">
        <img src="/api/media/${DomUtils.escapeHtml(value)}/thumbnail" class="${thumbClass}"
             onerror="this.onerror=null; this.src='/icons/file.svg'; this.classList.add('media-thumb-fallback')">
      </a>`;
    }

    // URL: clickable link
    if (col.customType === 'url' && value) {
      const escaped = DomUtils.escapeHtml(String(value));
      return `<a href="${escaped}" target="_blank" rel="noopener" class="url-link">${escaped}</a>`;
    }

    // JSON: formatted preview
    if (col.customType === 'json' && value) {
      const jsonStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const truncated = jsonStr.length > 50 ? jsonStr.substring(0, 47) + '...' : jsonStr;
      return `<span class="json-value" title="${DomUtils.escapeHtml(jsonStr)}">${DomUtils.escapeHtml(truncated)}</span>`;
    }

    // Enum: internal -> external conversion
    if (schema) {
      const formatted = this.format(value, col.name, schema);
      return DomUtils.escapeHtml(formatted);
    }

    return DomUtils.escapeHtml(String(value));
  }
};
