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
  btnViewTable: null,
  btnViewTreeH: null,
  btnViewTreeV: null,
  currentEntity: null,
  currentView: null, // null = entity mode, object = view mode { name, base, color }
  records: [],
  selectedId: null,
  viewMode: 'tree-v', // 'table', 'tree-h', or 'tree-v'

  async init() {
    this.selector = document.getElementById('entity-selector');
    this.selectorTrigger = this.selector.querySelector('.entity-selector-trigger');
    this.selectorMenu = this.selector.querySelector('.entity-selector-menu');
    this.viewSelector = document.getElementById('view-selector');
    this.viewSelectorTrigger = this.viewSelector.querySelector('.view-selector-trigger');
    this.viewSelectorMenu = this.viewSelector.querySelector('.view-selector-menu');
    this.tableContainer = document.getElementById('entity-table-container');
    this.treeContainer = document.getElementById('entity-tree-container');
    this.btnViewTable = document.getElementById('btn-view-table');
    this.btnViewTreeH = document.getElementById('btn-view-tree-h');
    this.btnViewTreeV = document.getElementById('btn-view-tree-v');

    // Initialize components
    EntityTree.init('entity-tree-container');
    EntityTable.init('entity-table-container');

    // Restore view mode from session
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

  selectEntityFromDropdown(name, areaColor) {
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

    this.onEntityChange();
  },

  selectEntity(entityName) {
    const item = this.selectorMenu.querySelector(`[data-value="${entityName}"]`);
    if (item) {
      this.selectEntityFromDropdown(entityName, item.dataset.color);
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
          menuHtml += `<div class="view-selector-group-label">${entry.label}</div>`;
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

    // Restore tree buttons (may have been hidden in view mode)
    this.btnViewTreeH.style.display = '';
    this.btnViewTreeV.style.display = '';

    if (!entityName) {
      this.currentEntity = null;
      this.records = [];
      this.renderCurrentView();
      this.updateRecordStatus();
      DetailPanel.clear();
      return;
    }

    this.currentEntity = entityName;
    this.selectedId = null;

    await this.loadRecords();
    DetailPanel.clear();
  },

  async onViewChange(viewName, baseName, color) {
    this.currentView = { name: viewName, base: baseName, color };
    this.currentEntity = null;
    this.selectedId = null;
    this.records = [];

    // Force table view, hide tree buttons
    this.btnViewTreeH.style.display = 'none';
    this.btnViewTreeV.style.display = 'none';
    this.viewMode = 'table';
    this.updateViewToggle();

    DetailPanel.clear();

    // Load view data
    try {
      const result = await ApiClient.getViewData(viewName);
      this.records = result.data || [];
      const viewSchema = await ApiClient.getViewSchema(viewName);
      await EntityTable.loadView(viewName, viewSchema, this.records);
      this.updateRecordStatus(this.records.length);
    } catch (err) {
      console.error('Failed to load view:', err);
      this.tableContainer.innerHTML = `<p class="empty-message">Error: ${err.message}</p>`;
    }
  },

  async loadRecords(filter = '') {
    if (!this.currentEntity) return;

    try {
      const options = filter ? { filter } : {};
      const result = await ApiClient.getAll(this.currentEntity, options);
      this.records = result.data || [];
      this.renderCurrentView();
      this.updateRecordStatus();
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

    // Update button states
    this.btnViewTable.classList.toggle('active', this.viewMode === 'table');
    this.btnViewTreeH.classList.toggle('active', this.viewMode === 'tree-h');
    this.btnViewTreeV.classList.toggle('active', this.viewMode === 'tree-v');

    // Show/hide containers
    this.tableContainer.classList.toggle('hidden', this.viewMode !== 'table');
    this.treeContainer.classList.toggle('hidden', !isTree);

    // Update EntityTree attribute layout based on view mode
    // This will re-render the tree if layout changed, preserving expanded nodes
    if (isTree) {
      EntityTree.setAttributeLayout(this.viewMode === 'tree-h' ? 'row' : 'list');
    }
  },

  renderCurrentView() {
    if (this.viewMode === 'table') {
      this.renderTable();
    } else {
      // Both tree-h and tree-v use the tree renderer
      this.renderTree();
    }
  },

  async renderTable() {
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

  async renderListWithSchema() {
    const schema = await SchemaCache.getExtended(this.currentEntity);
    const labelFields = this.getLabelFields(schema);

    this.list.innerHTML = this.records.map(record => {
      const title = labelFields.primary ? record[labelFields.primary] || `#${record.id}` : `#${record.id}`;
      const subtitle = labelFields.secondary ? record[labelFields.secondary] : `ID: ${record.id}`;
      const isSelected = record.id === this.selectedId;

      return `
        <div class="entity-row ${isSelected ? 'selected' : ''}" data-id="${record.id}">
          <div class="entity-row-content">
            <div class="entity-row-title">${this.escapeHtml(String(title))}</div>
            <div class="entity-row-subtitle">${this.escapeHtml(String(subtitle))}</div>
          </div>
          <div class="entity-row-actions">
            <button class="btn-row-action btn-edit" data-id="${record.id}" title="Edit">&#9998;</button>
            <button class="btn-row-action danger btn-delete" data-id="${record.id}" title="Delete">&#128465;</button>
          </div>
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};
