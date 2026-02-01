/**
 * Entity Explorer Component
 * Left panel with entity selector, table/tree view, and filters
 */
const EntityExplorer = {
  selector: null,
  selectorTrigger: null,
  selectorMenu: null,
  selectorValue: '',
  // View selector (separate dropdown)
  viewSelector: null,
  viewSelectorTrigger: null,
  viewSelectorMenu: null,
  viewSelectorValue: '',
  tableContainer: null,
  treeContainer: null,
  mapContainer: null,
  btnViewTable: null,
  btnViewTreeH: null,
  btnViewTreeV: null,
  btnViewMap: null,
  currentEntity: null,
  currentView: null, // null = entity mode, object = view mode { name, base, color }
  entityMetadata: {}, // Map of entity name -> { readonly, system, ... }
  records: [],
  selectedId: null,
  viewMode: 'tree-v', // 'table', 'tree-h', or 'tree-v'

  // Pagination state
  totalRecords: 0,
  isLoadingMore: false,
  hasMore: false,
  scrollObserver: null,
  currentFilter: '',
  currentSort: null,
  currentOrder: null,
  prefilterFields: null, // Array of column paths for prefilter dialog (shown when large)
  requiredFilterFields: null, // Array of column paths for required filter dialog (always shown)
  paginationConfig: null, // { threshold, pageSize } from config.json
  prefilterValues: {}, // { columnPath: selectedValue } for active prefilters

  /**
   * Get pagination config from server
   */
  async getPaginationConfig() {
    if (this.paginationConfig) return this.paginationConfig;
    try {
      const resp = await fetch('/api/config/pagination');
      if (resp.ok) {
        this.paginationConfig = await resp.json();
      } else {
        this.paginationConfig = { threshold: 500, pageSize: 200 };
      }
    } catch (e) {
      this.paginationConfig = { threshold: 500, pageSize: 200 };
    }
    return this.paginationConfig;
  },

  /**
   * Parse prefilter field spec: "field", "field:select", "field:year", "field:month"
   * @returns {{ field: string, type: 'text'|'select'|'year'|'month' }}
   */
  parsePrefilterField(fieldSpec) {
    const match = fieldSpec.match(/^(.+?):(\w+)$/);
    if (match) {
      return { field: match[1], type: match[2] };
    }
    return { field: fieldSpec, type: 'text' };
  },

  /**
   * Show prefilter dialog before loading data
   * Returns selected filter values or null if cancelled
   * Supports text input (LIKE matching) and select dropdown (exact match)
   * @param {string} contextName - Entity or view name for display
   * @param {string[]} prefilterFields - Array of field specs like "field" or "field:select"
   * @param {Object} options - { isView: boolean, viewName: string, viewSchema: object }
   */
  async showPrefilterDialog(contextName, prefilterFields, options = {}) {
    // Build dialog HTML
    const dialogId = 'prefilter-dialog';
    let existing = document.getElementById(dialogId);
    if (existing) existing.remove();

    const dialog = document.createElement('dialog');
    dialog.id = dialogId;
    dialog.className = 'prefilter-dialog';

    // Parse field specs and prepare data
    const parsedFields = [];
    for (const fieldSpec of prefilterFields) {
      const { field, type } = this.parsePrefilterField(fieldSpec);
      const fieldLabel = field.split('.').pop().replace(/_/g, ' ').replace(/\bid\b/i, '').trim() || field;
      const capitalizedLabel = fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1);

      const fieldData = { field, type, label: capitalizedLabel, options: [] };

      // For select, year, or month type, fetch distinct values
      if (type === 'select' || type === 'year' || type === 'month') {
        try {
          if (options.isView && options.viewName) {
            // Find the view column that matches this prefilter path
            // e.g., prefilter "meter.resource_type" → view column "resource" (from "meter.resource_type.name as resource")
            const viewCol = this.findViewColumnForPrefilter(field, options.viewSchema);
            if (viewCol) {
              const result = await ApiClient.getViewDistinctValues(options.viewName, viewCol.key, type);
              fieldData.options = result.values || [];
              fieldData.viewColumn = viewCol.key; // Store actual column name for filtering
            }
          } else {
            // Entity mode - get distinct values from entity (uses field_label column)
            const result = await ApiClient.getDistinctValues(contextName, field, type);
            fieldData.options = result || [];
            // For entities with year/month, the column is the date field itself
            if (type === 'year' || type === 'month') {
              fieldData.entityColumn = field;
            } else {
              // For select: the label column is field_label (e.g., "meter" → "meter_label")
              fieldData.entityColumn = field.replace(/\./g, '_') + '_label';
            }
          }
        } catch (e) {
          console.error(`Failed to get distinct values for ${field}:`, e);
        }
      }

      parsedFields.push(fieldData);
    }

    // Build field inputs
    let fieldsHtml = '<div class="prefilter-fields">';
    for (const f of parsedFields) {
      if ((f.type === 'select' || f.type === 'year' || f.type === 'month') && f.options.length > 0) {
        // Dropdown for select, year, or month
        const colAttr = f.viewColumn ? `data-view-column="${f.viewColumn}"` : (f.entityColumn ? `data-entity-column="${f.entityColumn}"` : '');
        const typeLabel = f.type === 'year' ? ' (Year)' : (f.type === 'month' ? ' (Month)' : '');
        fieldsHtml += `
          <div class="prefilter-field">
            <label>${f.label}${typeLabel}</label>
            <select data-field="${f.field}" data-type="${f.type}" ${colAttr} class="prefilter-select">
              <option value="">-- All --</option>
              ${f.options.map(v => `<option value="${DomUtils.escapeHtml(String(v))}">${DomUtils.escapeHtml(String(v))}</option>`).join('')}
            </select>
          </div>
        `;
      } else {
        // Text input
        fieldsHtml += `
          <div class="prefilter-field">
            <label>${f.label}</label>
            <input type="text" data-field="${f.field}" data-type="text" class="prefilter-input"
                   placeholder="Enter text to match...">
          </div>
        `;
      }
    }
    fieldsHtml += '</div>';

    dialog.innerHTML = `
      <div class="prefilter-header">
        <h3>Filter ${contextName}</h3>
        <p>${parsedFields.some(f => f.type === 'select') ? 'Select values to filter by' : 'Enter text to filter by (matches label field)'}</p>
      </div>
      ${fieldsHtml}
      <div class="prefilter-actions">
        <button type="button" class="btn-secondary" data-action="skip">Load All</button>
        <button type="button" class="btn-primary" data-action="apply">Apply Filter</button>
      </div>
    `;

    document.body.appendChild(dialog);

    // Show dialog and wait for user action
    const inputs = dialog.querySelectorAll('.prefilter-input, .prefilter-select');

    return new Promise((resolve) => {
      dialog.showModal();

      // Focus first input/select
      if (inputs.length > 0) {
        inputs[0].focus();
      }

      // Allow Enter to submit
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          dialog.querySelector('[data-action="apply"]').click();
        }
      });

      dialog.querySelector('[data-action="skip"]').addEventListener('click', () => {
        dialog.close();
        dialog.remove();
        resolve(null); // No filter, load all
      });

      dialog.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const filters = {};
        for (const input of inputs) {
          const value = input.value.trim();
          if (value) {
            filters[input.dataset.field] = {
              value,
              type: input.dataset.type,
              viewColumn: input.dataset.viewColumn || null,
              entityColumn: input.dataset.entityColumn || null
            };
          }
        }
        dialog.close();
        dialog.remove();
        resolve(Object.keys(filters).length > 0 ? filters : null);
      });

      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(null);
      });
    });
  },

  /**
   * Find the view column that corresponds to a prefilter path
   * e.g., prefilter "meter.resource_type" matches column with path "meter.resource_type.name"
   */
  findViewColumnForPrefilter(prefilterPath, viewSchema) {
    if (!viewSchema?.columns) return null;

    // Look for a column whose source path starts with the prefilter path
    // e.g., prefilter "meter.resource_type" matches column path "meter.resource_type.name"
    for (const col of viewSchema.columns) {
      if (col.path && col.path.startsWith(prefilterPath + '.')) {
        return col;
      }
      // Also match exact path
      if (col.path === prefilterPath) {
        return col;
      }
    }

    // Fallback: match by key containing the last part of the path
    const lastPart = prefilterPath.split('.').pop();
    for (const col of viewSchema.columns) {
      if (col.key.toLowerCase().includes(lastPart.toLowerCase().replace(/_/g, ''))) {
        return col;
      }
    }
    return null;
  },

  /**
   * Build filter string from prefilter values
   * For text type: Uses ~ prefix for LIKE matching on FK label columns
   * For select type: Uses exact match on view/entity column
   * For year type: Uses @Y prefix for strftime year extraction
   * For month type: Uses @M prefix for strftime year-month extraction
   * @param {Object} prefilterValues - { field: { value, type, viewColumn, entityColumn } }
   * @param {boolean} isView - Whether this is for a view (uses viewColumn) or entity (uses entityColumn)
   */
  buildPrefilterString(prefilterValues, isView = false) {
    if (!prefilterValues || Object.keys(prefilterValues).length === 0) return '';
    const parts = [];
    for (const [field, info] of Object.entries(prefilterValues)) {
      // Handle old format (string value) for backwards compat
      const value = typeof info === 'string' ? info : info.value;
      const type = typeof info === 'string' ? 'text' : info.type;
      const viewColumn = typeof info === 'object' ? info.viewColumn : null;
      const entityColumn = typeof info === 'object' ? info.entityColumn : null;

      // Determine the column name
      const colName = viewColumn || entityColumn || field.replace(/\./g, '_') + '_label';

      if (type === 'year') {
        // Year filter: @Y prefix for strftime year extraction
        parts.push(`@Y${colName}:${value}`);
      } else if (type === 'month') {
        // Month filter: @M prefix for strftime year-month extraction
        parts.push(`@M${colName}:${value}`);
      } else if (type === 'select' && viewColumn) {
        // Exact match on view column (Views mode)
        parts.push(`${viewColumn}:${value}`);
      } else if (type === 'select' && entityColumn) {
        // Exact match on entity label column (Entity mode with :select)
        // Use = prefix for exact match on view column
        parts.push(`=${entityColumn}:${value}`);
      } else if (isView && viewColumn) {
        // LIKE match on view column
        parts.push(`~${viewColumn}:${value}`);
      } else {
        // Entity mode: FK label columns are named field_label
        const colNameText = field.replace(/\./g, '_') + '_label';
        // Use ~ prefix for LIKE matching
        parts.push(`~${colNameText}:${value}`);
      }
    }
    // Join multiple filters with AND (using && separator)
    return parts.join('&&');
  },

  /**
   * Setup IntersectionObserver for infinite scroll
   */
  setupScrollObserver() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    const sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) return;

    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this.hasMore && !this.isLoadingMore) {
          this.loadMoreRecords();
        }
      },
      { root: this.tableContainer, threshold: 0.1 }
    );

    this.scrollObserver.observe(sentinel);
  },

  /**
   * Load more records for infinite scroll
   */
  async loadMoreRecords() {
    if (this.isLoadingMore || !this.hasMore) return;

    this.isLoadingMore = true;
    this.showLoadingIndicator(true);

    try {
      const config = await this.getPaginationConfig();
      const offset = this.records.length;
      const options = {
        limit: config.pageSize,
        offset: offset
      };

      // Add current filter/sort
      if (this.currentFilter) options.filter = this.currentFilter;
      if (this.currentSort) options.sort = this.currentSort;
      if (this.currentOrder) options.order = this.currentOrder;

      let result;
      if (this.currentView) {
        result = await ApiClient.getViewData(this.currentView.name, options);
      } else {
        result = await ApiClient.getAll(this.currentEntity, options);
      }

      const newRecords = result.data || [];
      this.records = this.records.concat(newRecords);
      this.hasMore = this.records.length < this.totalRecords;

      // Execute calculated fields
      if (this.currentView) {
        // For views: normalize keys and run calculations on all records
        const viewSchema = this.currentViewSchema;
        if (viewSchema) {
          this.normalizeRecordKeys(viewSchema);

          // Execute [CALCULATED] fields
          const calcCols = viewSchema.columns.filter(c => c.calculated);
          for (const col of calcCols) {
            try {
              const fn = new Function('data', col.calculated.code);
              fn(this.records);
              const lowercaseKey = col.key.toLowerCase().replace(/ /g, '_');
              if (lowercaseKey !== col.key) {
                for (const record of this.records) {
                  if (record[lowercaseKey] !== undefined) {
                    record[col.key] = record[lowercaseKey];
                  }
                }
              }
            } catch (e) {
              console.error(`Calculation error for ${col.key}:`, e);
            }
          }

          // Run calculator
          if (viewSchema.calculator) {
            try {
              const fn = new Function('data', 'schema', viewSchema.calculator);
              fn(this.records, viewSchema);
            } catch (e) {
              console.error(`Calculator error:`, e);
            }
          }
        }
      } else {
        await this.executeCalculatedFields();
      }

      // Re-render table with all records
      if (this.currentView) {
        await EntityTable.loadView(this.currentView.name, this.currentViewSchema, this.records);
      } else {
        await EntityTable.loadEntity(this.currentEntity, this.records);
      }

      this.updateRecordStatus();

      // Re-setup observer after table re-render
      this.setupScrollObserver();
    } catch (err) {
      console.error('Failed to load more records:', err);
      DomUtils.toastError(`Load error: ${err.message}`);
    } finally {
      this.isLoadingMore = false;
      this.showLoadingIndicator(false);
    }
  },

  /**
   * Show/hide loading indicator at bottom of table
   */
  showLoadingIndicator(show) {
    let indicator = document.getElementById('pagination-loading');
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pagination-loading';
        indicator.className = 'pagination-loading';
        indicator.innerHTML = '<span class="spinner"></span> Loading more...';
        this.tableContainer.appendChild(indicator);
      }
      indicator.style.display = 'flex';
    } else if (indicator) {
      indicator.style.display = 'none';
    }
  },

  async init() {
    this.selector = document.getElementById('entity-selector');
    this.selectorTrigger = this.selector.querySelector('.entity-selector-trigger');
    this.selectorMenu = this.selector.querySelector('.entity-selector-menu');
    this.viewSelector = document.getElementById('view-selector');
    this.viewSelectorTrigger = this.viewSelector.querySelector('.view-selector-trigger');
    this.viewSelectorMenu = this.viewSelector.querySelector('.view-selector-menu');
    this.tableContainer = document.getElementById('entity-table-container');
    this.treeContainer = document.getElementById('entity-tree-container');
    this.mapContainer = document.getElementById('entity-map-container');
    this.btnViewTable = document.getElementById('btn-view-table');
    this.btnViewTreeH = document.getElementById('btn-view-tree-h');
    this.btnViewTreeV = document.getElementById('btn-view-tree-v');
    this.btnViewMap = document.getElementById('btn-view-map');
    this.mapLabelsToggle = document.getElementById('map-labels-toggle');
    this.mapLabelsCheckbox = document.getElementById('map-show-labels');

    // Initialize components
    EntityTree.init('entity-tree-container');
    EntityTable.init('entity-table-container');

    // Restore view mode from session (note: 'map' mode is not restored, requires active view)
    const savedViewMode = sessionStorage.getItem('viewMode');
    if (savedViewMode && ['table', 'tree-h', 'tree-v'].includes(savedViewMode)) {
      this.viewMode = savedViewMode;
    } else if (savedViewMode === 'tree') {
      // Migration from old 2-mode system
      this.viewMode = 'tree-v';
    }
    this.updateViewToggle();

    // Load entity types and views
    await this.loadEntityTypes();
    await this.loadViews();

    // Event listeners for entity dropdown
    this.selectorTrigger.addEventListener('click', () => this.toggleDropdown());
    document.addEventListener('click', (e) => {
      if (!this.selector.contains(e.target)) {
        this.closeDropdown();
      }
      if (!this.viewSelector.contains(e.target)) {
        this.closeViewDropdown();
      }
    });

    // Event listeners for view dropdown
    this.viewSelectorTrigger.addEventListener('click', () => this.toggleViewDropdown());

    this.btnViewTable.addEventListener('click', () => this.setViewMode('table'));
    this.btnViewTreeH.addEventListener('click', () => this.setViewMode('tree-h'));
    this.btnViewTreeV.addEventListener('click', () => this.setViewMode('tree-v'));
    this.btnViewMap.addEventListener('click', () => this.setViewMode('map'));
    this.mapLabelsCheckbox.addEventListener('change', (e) => {
      EntityMap.togglePermanentLabels(e.target.checked);
    });

    // Refresh counts button
    const btnRefresh = document.getElementById('btn-refresh-counts');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this.refreshCounts());
    }

    // Open views dropdown on start if views exist, otherwise entity dropdown
    if (this.viewSelector.style.display !== 'none') {
      this.toggleViewDropdown();
    } else {
      this.openDropdown();
    }
  },

  toggleDropdown() {
    this.selector.classList.toggle('open');
  },

  openDropdown() {
    this.selector.classList.add('open');
  },

  closeDropdown() {
    this.selector.classList.remove('open');
  },

  toggleViewDropdown() {
    this.viewSelector.classList.toggle('open');
  },

  closeViewDropdown() {
    this.viewSelector.classList.remove('open');
  },

  async loadEntityTypes() {
    try {
      const { entities, areas } = await ApiClient.getEntityTypes();

      // Store entity metadata for readonly/system checks
      this.entityMetadata = {};
      entities.forEach(e => {
        this.entityMetadata[e.name] = {
          readonly: e.readonly || false,
          system: e.system || false
        };
      });

      // Group entities by area
      const grouped = {};
      entities.forEach(e => {
        if (!grouped[e.areaName]) {
          grouped[e.areaName] = { color: e.areaColor, entities: [] };
        }
        grouped[e.areaName].entities.push(e);
      });

      // Build custom dropdown menu
      let menuHtml = '';
      for (const [areaName, group] of Object.entries(grouped)) {
        menuHtml += `<div class="entity-selector-group">`;
        menuHtml += `<div class="entity-selector-group-label" style="background-color: ${group.color};">${areaName}</div>`;
        group.entities.forEach(e => {
          menuHtml += `<div class="entity-selector-item" data-value="${e.name}" data-color="${e.areaColor}" style="border-left-color: ${e.areaColor};">
            <span class="entity-name">${e.name}</span>
            <span class="entity-count">${e.count}</span>
          </div>`;
        });
        menuHtml += `</div>`;
      }

      this.selectorMenu.innerHTML = menuHtml;

      // Add click handlers for menu items
      this.selectorMenu.querySelectorAll('.entity-selector-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectEntityFromDropdown(item.dataset.value, item.dataset.color);
        });
      });
    } catch (err) {
      console.error('Failed to load entity types:', err);
    }
  },

  async refreshCounts() {
    const currentSelection = this.selectorValue;
    await this.loadEntityTypes();
    // Restore selection state in menu
    if (currentSelection) {
      this.selectorMenu.querySelectorAll('.entity-selector-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.value === currentSelection);
      });
    }
    // Keep dropdown open after refresh
    this.openDropdown();
  },

  async selectEntityFromDropdown(name, areaColor) {
    this.selectorValue = name;
    // Update trigger text
    const textSpan = this.selectorTrigger.querySelector('.entity-selector-text');
    if (textSpan) textSpan.textContent = name;
    this.selectorTrigger.style.backgroundColor = areaColor || '';

    // Update selected state in menu
    this.selectorMenu.querySelectorAll('.entity-selector-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === name);
    });

    this.closeDropdown();

    // Deselect view when an entity is selected
    this.currentView = null;
    this.viewSelectorValue = '';
    const viewText = this.viewSelectorTrigger.querySelector('.view-selector-text');
    if (viewText) viewText.textContent = 'Views';
    this.viewSelectorTrigger.style.backgroundColor = '';
    this.viewSelectorMenu.querySelectorAll('.view-selector-item').forEach(item => {
      item.classList.remove('selected');
    });

    await this.onEntityChange();
  },

  async selectEntity(entityName) {
    const item = this.selectorMenu.querySelector(`[data-value="${entityName}"]`);
    if (item) {
      await this.selectEntityFromDropdown(entityName, item.dataset.color);
    }
  },

  async loadViews() {
    try {
      const viewsData = await ApiClient.getViews();
      if (!viewsData.views || viewsData.views.length === 0) {
        this.viewSelector.style.display = 'none';
        return;
      }

      // Show view selector
      this.viewSelector.style.display = '';

      let menuHtml = '';
      let currentGroup = null;
      for (const entry of viewsData.groups) {
        if (entry.type === 'separator') {
          if (currentGroup) menuHtml += `</div>`;
          currentGroup = entry.label;
          menuHtml += `<div class="view-selector-group">`;
          menuHtml += `<div class="view-selector-group-label" style="background-color: ${entry.color};">${entry.label}</div>`;
        } else if (entry.type === 'view') {
          const view = viewsData.views.find(v => v.name === entry.name);
          if (view) {
            menuHtml += `<div class="view-selector-item" data-value="${view.name}" data-base="${view.base}" data-color="${view.color}" style="border-left-color: ${view.color};">
              <span class="view-name">${view.name}</span>
            </div>`;
          }
        }
      }
      if (currentGroup) menuHtml += `</div>`;

      this.viewSelectorMenu.innerHTML = menuHtml;

      // Add click handlers
      this.viewSelectorMenu.querySelectorAll('.view-selector-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectViewFromDropdown(item.dataset.value, item.dataset.base, item.dataset.color);
        });
      });
    } catch (err) {
      console.warn('Failed to load user views:', err);
      this.viewSelector.style.display = 'none';
    }
  },

  selectViewFromDropdown(viewName, baseName, color) {
    this.viewSelectorValue = viewName;
    // Update trigger text
    const viewText = this.viewSelectorTrigger.querySelector('.view-selector-text');
    if (viewText) viewText.textContent = viewName;
    this.viewSelectorTrigger.style.backgroundColor = color || '';

    // Update selected state in view menu
    this.viewSelectorMenu.querySelectorAll('.view-selector-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === viewName);
    });

    this.closeViewDropdown();

    // Deselect entity
    this.selectorValue = '';
    const entityText = this.selectorTrigger.querySelector('.entity-selector-text');
    if (entityText) entityText.textContent = i18n.t('select_entity');
    this.selectorTrigger.style.backgroundColor = '';
    this.selectorMenu.querySelectorAll('.entity-selector-item').forEach(item => {
      item.classList.remove('selected');
    });

    this.onViewChange(viewName, baseName, color);
  },

  async onEntityChange() {
    const entityName = this.selectorValue;

    // Restore tree buttons (may have been hidden in view mode), hide map controls
    this.btnViewTreeH.style.display = '';
    this.btnViewTreeV.style.display = '';
    this.btnViewMap.style.display = 'none';
    this.mapLabelsToggle.style.display = 'none';
    // If we were in map mode, switch back to default
    if (this.viewMode === 'map') {
      this.viewMode = 'tree-v';
    }
    this.updateViewToggle();

    if (!entityName) {
      this.currentEntity = null;
      this.records = [];
      this.prefilterFields = null;
      this.requiredFilterFields = null;
      this.renderCurrentView();
      this.updateRecordStatus();
      DetailPanel.clear();
      return;
    }

    this.currentEntity = entityName;
    this.selectedId = null;

    // Get prefilter, requiredFilter, and defaultSort from extended schema
    let defaultSort = null;
    try {
      const schema = await SchemaCache.getExtended(entityName);
      this.prefilterFields = schema.prefilter || null;
      this.requiredFilterFields = schema.requiredFilter || null;
      defaultSort = schema.ui?.tableOptions?.defaultSort || null;
    } catch (e) {
      this.prefilterFields = null;
      this.requiredFilterFields = null;
    }

    // Pass default sort to loadRecords
    const loadOptions = defaultSort
      ? { sort: defaultSort.column, order: defaultSort.order }
      : {};
    await this.loadRecords('', loadOptions);
    DetailPanel.clear();
  },

  async onViewChange(viewName, baseName, color) {
    this.currentView = { name: viewName, base: baseName, color };
    this.currentEntity = null;
    this.selectedId = null;
    this.records = [];
    this.prefilterFields = null;

    // Force table view, hide tree buttons, hide map controls (will show if hasGeo)
    this.btnViewTreeH.style.display = 'none';
    this.btnViewTreeV.style.display = 'none';
    this.btnViewMap.style.display = 'none';
    this.mapLabelsToggle.style.display = 'none';
    this.viewMode = 'table';
    this.updateViewToggle();

    DetailPanel.clear();

    // Reset pagination state
    this.records = [];
    this.hasMore = false;
    this.totalRecords = 0;
    this.currentFilter = '';
    this.currentSort = null;
    this.currentOrder = null;

    // Load view data with optional prefilter and pagination
    try {
      const viewSchema = await ApiClient.getViewSchema(viewName);
      this.currentViewSchema = viewSchema;  // Cache for loadMoreRecords
      this.prefilterFields = viewSchema.prefilter || null;
      this.requiredFilterFields = viewSchema.requiredFilter || null;

      // Show map button and labels toggle if view has geo column
      if (viewSchema.hasGeo) {
        this.btnViewMap.style.display = '';
        this.mapLabelsToggle.style.display = '';
      }

      const config = await this.getPaginationConfig();

      // First, get total count (for pagination threshold check)
      const countResult = await ApiClient.getViewData(viewName, { limit: 0 });
      this.totalRecords = countResult.total || 0;

      // Check if we need filter dialog (same logic as entities):
      // 1. requiredFilter: always show dialog (regardless of record count)
      // 2. prefilter: only show dialog when dataset is large
      const hasRequired = this.requiredFilterFields && this.requiredFilterFields.length > 0;
      const hasPrefilter = this.prefilterFields && this.prefilterFields.length > 0;
      const isLargeDataset = this.totalRecords > config.threshold;

      let filter = '';
      if (hasRequired || (hasPrefilter && isLargeDataset)) {
        const dialogFields = hasRequired ? this.requiredFilterFields : this.prefilterFields;
        const prefilterResult = await this.showPrefilterDialog(viewName, dialogFields, {
          isView: true,
          viewName: viewName,
          viewSchema: viewSchema
        });
        if (prefilterResult && Object.keys(prefilterResult).length > 0) {
          this.prefilterValues = prefilterResult;
          filter = this.buildPrefilterString(prefilterResult, true);
        }
      }

      this.currentFilter = filter;

      // Re-get total count with filter applied
      if (filter) {
        const filteredCount = await ApiClient.getViewData(viewName, { limit: 0, filter });
        this.totalRecords = filteredCount.total || 0;
      }

      // Determine if we need pagination
      const needsPagination = this.totalRecords > config.threshold;

      // Apply default sort from view config
      if (viewSchema.defaultSort) {
        this.currentSort = viewSchema.defaultSort.column;
        this.currentOrder = viewSchema.defaultSort.order;
      }

      const loadOptions = {};
      if (filter) loadOptions.filter = filter;
      if (this.currentSort) loadOptions.sort = this.currentSort;
      if (this.currentOrder) loadOptions.order = this.currentOrder;
      if (needsPagination) {
        loadOptions.limit = config.pageSize;
        loadOptions.offset = 0;
      }

      const result = await ApiClient.getViewData(viewName, loadOptions);
      this.records = result.data || [];
      this.hasMore = needsPagination && this.records.length < this.totalRecords;

      // Normalize keys: add lowercase aliases for calculated field compatibility
      // View columns may be titlecased (Value, Usage), but calculation code uses lowercase (value, usage)
      this.normalizeRecordKeys(viewSchema);

      // Execute [CALCULATED] fields from entity columns that are in the view
      const calcCols = viewSchema.columns.filter(c => c.calculated);
      for (const col of calcCols) {
        try {
          const fn = new Function('data', col.calculated.code);
          fn(this.records);
          // Copy calculated value from lowercase key back to titlecased view key
          const lowercaseKey = col.key.toLowerCase().replace(/ /g, '_');
          if (lowercaseKey !== col.key) {
            for (const record of this.records) {
              if (record[lowercaseKey] !== undefined) {
                record[col.key] = record[lowercaseKey];
              }
            }
          }
        } catch (e) {
          console.error(`Calculation error for ${col.key}:`, e);
          DomUtils.toastError(`Calculation error [${col.key}]: ${e.message}`);
        }
      }

      // Calculator: run client-side JS transform from Views.md (styling, etc.)
      if (viewSchema.calculator) {
        try {
          const fn = new Function('data', 'schema', viewSchema.calculator);
          fn(this.records, viewSchema);
        } catch (e) {
          console.error(`Calculator error in view "${viewName}":`, e);
          DomUtils.toastError(`Calculator error [${viewName}]: ${e.message}`);
        }
      }

      await EntityTable.loadView(viewName, viewSchema, this.records);
      this.updateRecordStatus();

      // Setup infinite scroll if paginated
      if (needsPagination) {
        setTimeout(() => this.setupScrollObserver(), 100);
      }
    } catch (err) {
      console.error('Failed to load view:', err);
      this.tableContainer.innerHTML = `<p class="empty-message">Error: ${err.message}</p>`;
    }
  },

  async loadRecords(filter = '', options = {}) {
    if (!this.currentEntity) return;

    // Reset pagination state
    this.currentFilter = filter;
    this.currentSort = options.sort || null;
    this.currentOrder = options.order || null;
    this.records = [];
    this.hasMore = false;
    this.totalRecords = 0;

    try {
      const config = await this.getPaginationConfig();

      // First, get total count with limit=0
      const countOptions = { limit: 0 };
      if (filter) countOptions.filter = filter;
      const countResult = await ApiClient.getAll(this.currentEntity, countOptions);
      this.totalRecords = countResult.total || 0;

      // Check if we need filter dialog:
      // 1. requiredFilter: always show dialog (regardless of record count)
      // 2. prefilter: only show dialog when dataset is large
      const hasRequired = this.requiredFilterFields && this.requiredFilterFields.length > 0;
      const hasPrefilter = this.prefilterFields && this.prefilterFields.length > 0;
      const isLargeDataset = this.totalRecords > config.threshold;

      if (!filter && (hasRequired || (hasPrefilter && isLargeDataset))) {
        // Combine required and prefilter fields for the dialog
        const dialogFields = hasRequired ? this.requiredFilterFields : this.prefilterFields;
        const prefilterResult = await this.showPrefilterDialog(this.currentEntity, dialogFields);
        if (prefilterResult && Object.keys(prefilterResult).length > 0) {
          this.prefilterValues = prefilterResult;
          const prefilterStr = this.buildPrefilterString(prefilterResult);
          // Reload with prefilter
          return this.loadRecords(prefilterStr, options);
        }
        // User skipped filter - continue loading (with pagination if large)
      }

      // Determine if we need pagination
      const needsPagination = this.totalRecords > config.threshold;

      const loadOptions = {};
      if (filter) loadOptions.filter = filter;
      if (options.sort) loadOptions.sort = options.sort;
      if (options.order) loadOptions.order = options.order;

      if (needsPagination) {
        // Load first page only
        loadOptions.limit = config.pageSize;
        loadOptions.offset = 0;
      }

      const result = await ApiClient.getAll(this.currentEntity, loadOptions);
      this.records = result.data || [];
      this.hasMore = needsPagination && this.records.length < this.totalRecords;

      // Execute [CALCULATED] fields from entity schema
      await this.executeCalculatedFields();

      this.renderCurrentView();
      this.updateRecordStatus();

      // Setup infinite scroll if paginated
      if (needsPagination && this.viewMode === 'table') {
        // Defer to allow DOM to settle
        setTimeout(() => this.setupScrollObserver(), 100);
      }
    } catch (err) {
      console.error('Failed to load records:', err);
      this.records = [];
      const message = `<p class="empty-message">${i18n.t('error_loading_records', { message: err.message })}</p>`;
      if (this.viewMode === 'table') {
        this.tableContainer.innerHTML = message;
      } else {
        this.treeContainer.innerHTML = message;
      }
    }
  },

  /**
   * Reload records with new filter/sort (server-side)
   */
  async reloadWithFilter(filter, sort, order) {
    this.currentFilter = filter;
    this.currentSort = sort;
    this.currentOrder = order;
    await this.loadRecords(filter, { sort, order });
  },

  setViewMode(mode) {
    const oldMode = this.viewMode;
    const wasTree = oldMode === 'tree-h' || oldMode === 'tree-v';
    const isTree = mode === 'tree-h' || mode === 'tree-v';

    this.viewMode = mode;
    sessionStorage.setItem('viewMode', this.viewMode);
    this.updateViewToggle();

    // Only re-render if switching between table and tree
    // Tree-to-tree switches are handled by setAttributeLayout() which preserves expanded nodes
    if (wasTree && isTree) {
      // Layout change already triggered re-render via setAttributeLayout()
      // No need to call renderCurrentView()
    } else {
      this.renderCurrentView();
    }
    this.updateRecordStatus();
  },

  updateViewToggle() {
    const isTree = this.viewMode === 'tree-h' || this.viewMode === 'tree-v';
    const isMap = this.viewMode === 'map';

    // Update button states
    this.btnViewTable.classList.toggle('active', this.viewMode === 'table');
    this.btnViewTreeH.classList.toggle('active', this.viewMode === 'tree-h');
    this.btnViewTreeV.classList.toggle('active', this.viewMode === 'tree-v');
    this.btnViewMap.classList.toggle('active', isMap);

    // Show/hide containers
    this.tableContainer.classList.toggle('hidden', this.viewMode !== 'table');
    this.treeContainer.classList.toggle('hidden', !isTree);
    this.mapContainer.classList.toggle('hidden', !isMap);

    // Update EntityTree attribute layout based on view mode
    // This will re-render the tree if layout changed, preserving expanded nodes
    if (isTree) {
      EntityTree.setAttributeLayout(this.viewMode === 'tree-h' ? 'row' : 'list');
    }
  },

  renderCurrentView() {
    if (this.viewMode === 'table') {
      this.renderTable();
    } else if (this.viewMode === 'map') {
      this.renderMap();
    } else {
      // Both tree-h and tree-v use the tree renderer
      this.renderTree();
    }
  },

  renderMap() {
    if (!this.currentView || !this.currentViewSchema) {
      this.mapContainer.innerHTML = `<p class="empty-message">Select a view with geo data</p>`;
      return;
    }

    if (this.records.length === 0) {
      this.mapContainer.innerHTML = `<p class="empty-message">${i18n.t('no_records_found')}</p>`;
      return;
    }

    // Delegate to EntityMap component
    EntityMap.loadView(this.currentViewSchema, this.records);
  },

  async renderTable() {
    // View mode: render view table
    if (this.currentView && this.currentViewSchema) {
      await EntityTable.loadView(this.currentView.name, this.currentViewSchema, this.records);
      return;
    }

    // Entity mode
    if (!this.currentEntity) {
      this.tableContainer.innerHTML = `<p class="empty-message">${i18n.t('select_entity_message')}</p>`;
      return;
    }

    await EntityTable.loadEntity(this.currentEntity, this.records);
  },

  renderList() {
    if (!this.currentEntity) {
      this.list.innerHTML = `<p class="empty-message">${i18n.t('select_entity_message')}</p>`;
      return;
    }

    if (this.records.length === 0) {
      this.list.innerHTML = `<p class="empty-message">${i18n.t('no_records_found')}</p>`;
      return;
    }

    // Get schema for display labels
    this.renderListWithSchema();
  },

  /**
   * Check if current entity is readonly (system entity)
   */
  isCurrentEntityReadonly() {
    return this.entityMetadata[this.currentEntity]?.readonly === true;
  },

  async renderListWithSchema() {
    const schema = await SchemaCache.getExtended(this.currentEntity);
    const labelFields = this.getLabelFields(schema);
    const isReadonly = this.isCurrentEntityReadonly();

    this.list.innerHTML = this.records.map(record => {
      const title = labelFields.primary ? record[labelFields.primary] || `#${record.id}` : `#${record.id}`;
      const subtitle = labelFields.secondary ? record[labelFields.secondary] : `ID: ${record.id}`;
      const isSelected = record.id === this.selectedId;

      // Hide edit/delete buttons for readonly entities
      const actionsHtml = isReadonly ? '' : `
          <div class="entity-row-actions">
            <button class="btn-row-action btn-edit" data-id="${record.id}" title="Edit">&#9998;</button>
            <button class="btn-row-action danger btn-delete" data-id="${record.id}" title="Delete">&#128465;</button>
          </div>`;

      return `
        <div class="entity-row ${isSelected ? 'selected' : ''}" data-id="${record.id}">
          <div class="entity-row-content">
            <div class="entity-row-title">${DomUtils.escapeHtml(String(title))}</div>
            <div class="entity-row-subtitle">${DomUtils.escapeHtml(String(subtitle))}</div>
          </div>
          ${actionsHtml}
        </div>
      `;
    }).join('');

    // Add event listeners
    this.list.querySelectorAll('.entity-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn-row-action')) {
          this.onRowClick(parseInt(row.dataset.id));
        }
      });
    });

    this.list.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onEditClick(parseInt(btn.dataset.id));
      });
    });

    this.list.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onDeleteClick(parseInt(btn.dataset.id));
      });
    });
  },

  async renderTree() {
    if (!this.currentEntity) {
      this.treeContainer.innerHTML = `<p class="empty-message">${i18n.t('select_entity_message')}</p>`;
      return;
    }

    if (this.records.length === 0) {
      this.treeContainer.innerHTML = `<p class="empty-message">${i18n.t('no_records_found')}</p>`;
      return;
    }

    // Pass selectedId to auto-expand the selected record and its outbound FKs
    const options = this.selectedId ? { selectedId: this.selectedId } : {};
    await EntityTree.loadEntity(this.currentEntity, this.records, options);
  },

  getLabelFields(schema) {
    let primary = null;
    let secondary = null;

    // Use UI metadata if available
    if (schema.ui?.labelFields && schema.ui.labelFields.length > 0) {
      primary = schema.ui.labelFields[0];
      if (schema.ui.labelFields.length > 1) {
        secondary = schema.ui.labelFields[1];
      }
    } else {
      // Fallback to heuristics
      const candidates = ['name', 'title', 'registration', 'designation', 'code'];
      for (const name of candidates) {
        if (schema.columns.find(c => c.name === name)) {
          primary = name;
          break;
        }
      }

      const subtitleCandidates = ['serial_number', 'description', 'country', 'icao_code'];
      for (const name of subtitleCandidates) {
        if (name !== primary && schema.columns.find(c => c.name === name)) {
          secondary = name;
          break;
        }
      }
    }

    return { primary, secondary };
  },

  onRowClick(id) {
    this.selectedId = id;
    this.updateSelection();
    const record = this.records.find(r => r.id === id);
    if (record) {
      DetailPanel.showRecord(this.currentEntity, record);
    }
  },

  onEditClick(id) {
    this.selectedId = id;
    this.updateSelection();
    const record = this.records.find(r => r.id === id);
    if (record) {
      DetailPanel.showEditForm(this.currentEntity, record);
    }
  },

  async onDeleteClick(id) {
    const record = this.records.find(r => r.id === id);
    if (!record) return;

    const confirmed = await ConfirmDialog.show(
      i18n.t('confirm_delete', { entity: this.currentEntity })
    );

    if (confirmed) {
      try {
        await ApiClient.delete(this.currentEntity, id);
        await this.loadRecords();
        if (this.selectedId === id) {
          this.selectedId = null;
          DetailPanel.clear();
        }
      } catch (err) {
        alert(i18n.t('delete_failed', { message: err.message }));
      }
    }
  },

  updateSelection() {
    // Update selection in both views
    const container = this.viewMode === 'table' ? this.tableContainer : this.treeContainer;
    if (!container) return;

    container.querySelectorAll('.entity-row, .tree-item').forEach(row => {
      const rowId = parseInt(row.dataset.id);
      row.classList.toggle('selected', rowId === this.selectedId);
    });
  },

  clearSelection() {
    this.selectedId = null;
    this.updateSelection();
  },

  async refresh() {
    await this.loadRecords();
  },

  updateRecordStatus(count = null) {
    const recordsEl = document.getElementById('sw-records');
    const sepEl = document.getElementById('sw-records-sep');
    if (!recordsEl) return;

    if (this.viewMode === 'table' && (this.currentEntity || this.currentView) && this.records.length > 0) {
      // Use provided count or get from EntityTable (which may be filtered)
      const displayCount = count !== null ? count : this.records.length;
      recordsEl.textContent = `${displayCount} records`;
      if (sepEl) sepEl.style.display = '';
    } else {
      recordsEl.textContent = '';
      if (sepEl) sepEl.style.display = 'none';
    }
  },

  /**
   * Show a record in horizontal tree view with specified expansion depth
   */
  async showInTreeView(recordId, expandLevels = 2) {
    this.selectedId = recordId;

    // Switch to tree-h mode
    this.viewMode = 'tree-h';
    sessionStorage.setItem('viewMode', this.viewMode);
    this.updateViewToggle();

    // Render tree with expanded levels
    const options = {
      selectedId: recordId,
      expandLevels: expandLevels
    };
    await EntityTree.loadEntity(this.currentEntity, this.records, options);
  },

  /**
   * Jump to base entity edit mode for a record (used by view row click)
   */
  async editInBaseEntity(entityName, recordId) {
    // Switch to the base entity
    this.selectEntity(entityName);

    // Wait for records to load, then open edit
    await this.loadRecords();
    this.selectedId = recordId;
    this.updateSelection();

    const record = this.records.find(r => r.id === recordId);
    if (record) {
      DetailPanel.showEditForm(entityName, record);
    }
  },

  /**
   * Normalize record keys: add lowercase aliases for calculated field compatibility
   * View columns may use titlecased keys (Value, Usage), but calculation code uses lowercase (value, usage)
   */
  normalizeRecordKeys(viewSchema) {
    if (!this.records.length) return;

    // Build a mapping from potential titlecased/aliased keys to lowercase equivalents
    // For columns where key differs from expected lowercase name
    const keyMap = {};
    for (const col of viewSchema.columns) {
      const key = col.key;
      const lowercase = key.toLowerCase().replace(/ /g, '_');
      if (key !== lowercase) {
        keyMap[key] = lowercase;
      }
      // Also handle the case where key ends with :N suffix (auto-hidden columns)
      const colonMatch = key.match(/^(.+?):\d+$/);
      if (colonMatch) {
        const baseName = colonMatch[1].toLowerCase() + '_id';
        keyMap[key] = baseName;
      }
    }

    // Add lowercase aliases to each record
    for (const record of this.records) {
      for (const [origKey, newKey] of Object.entries(keyMap)) {
        if (record[origKey] !== undefined && record[newKey] === undefined) {
          record[newKey] = record[origKey];
        }
      }
    }
  },

  /**
   * Execute [CALCULATED] fields defined in entity schema
   * These are client-side computations defined in Entity.md ## Calculations
   */
  async executeCalculatedFields() {
    if (!this.currentEntity || this.records.length === 0) return;

    try {
      const schema = await SchemaCache.getExtended(this.currentEntity);
      const calcFields = schema.columns.filter(c => c.calculated);

      for (const field of calcFields) {
        try {
          const fn = new Function('data', field.calculated.code);
          fn(this.records);
        } catch (e) {
          console.error(`Calculation error for ${this.currentEntity}.${field.name}:`, e);
          DomUtils.toastError(`Calculation error [${this.currentEntity}.${field.name}]: ${e.message}`);
        }
      }
    } catch (e) {
      console.error('Failed to execute calculated fields:', e);
    }
  },

};
