/**
 * Entity Explorer Component
 * Left panel with entity selector, table/tree view, and filters
 */
const EntityExplorer = {
  selector: null,
  selectorTrigger: null,
  selectorMenu: null,
  selectorValue: '',
  tableContainer: null,
  treeContainer: null,
  filterInput: null,
  btnNew: null,
  btnViewTable: null,
  btnViewTree: null,
  currentEntity: null,
  records: [],
  selectedId: null,
  filterTimeout: null,
  viewMode: 'tree', // 'table' or 'tree'

  async init() {
    this.selector = document.getElementById('entity-selector');
    this.selectorTrigger = this.selector.querySelector('.entity-selector-trigger');
    this.selectorMenu = this.selector.querySelector('.entity-selector-menu');
    this.tableContainer = document.getElementById('entity-table-container');
    this.treeContainer = document.getElementById('entity-tree-container');
    this.filterInput = document.getElementById('filter-input');
    this.btnNew = document.getElementById('btn-new');
    this.btnViewTable = document.getElementById('btn-view-table');
    this.btnViewTree = document.getElementById('btn-view-tree');

    // Initialize components
    EntityTree.init('entity-tree-container');
    EntityTable.init('entity-table-container');

    // Restore view mode from session
    const savedViewMode = sessionStorage.getItem('viewMode');
    if (savedViewMode && (savedViewMode === 'table' || savedViewMode === 'tree')) {
      this.viewMode = savedViewMode;
    }
    this.updateViewToggle();

    // Load entity types into selector
    await this.loadEntityTypes();

    // Event listeners for custom dropdown
    this.selectorTrigger.addEventListener('click', () => this.toggleDropdown());
    document.addEventListener('click', (e) => {
      if (!this.selector.contains(e.target)) {
        this.closeDropdown();
      }
    });

    this.filterInput.addEventListener('input', () => this.onFilterChange());
    this.btnNew.addEventListener('click', () => this.onNewClick());
    this.btnViewTable.addEventListener('click', () => this.setViewMode('table'));
    this.btnViewTree.addEventListener('click', () => this.setViewMode('tree'));

    // Initially disable new button
    this.btnNew.disabled = true;

    // Open dropdown on start
    this.openDropdown();
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
          menuHtml += `<div class="entity-selector-item" data-value="${e.name}" data-color="${e.areaColor}" style="border-left-color: ${e.areaColor};">${e.name}</div>`;
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

  selectEntityFromDropdown(entityName, areaColor) {
    this.selectorValue = entityName;
    // Update trigger text
    const textSpan = this.selectorTrigger.querySelector('.entity-selector-text');
    if (textSpan) textSpan.textContent = entityName;
    this.selectorTrigger.style.backgroundColor = areaColor || '';

    // Update selected state in menu
    this.selectorMenu.querySelectorAll('.entity-selector-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === entityName);
    });

    this.closeDropdown();
    this.onEntityChange();
  },

  selectEntity(entityName) {
    const item = this.selectorMenu.querySelector(`[data-value="${entityName}"]`);
    if (item) {
      this.selectEntityFromDropdown(entityName, item.dataset.color);
    }
  },

  async onEntityChange() {
    const entityName = this.selectorValue;

    if (!entityName) {
      this.currentEntity = null;
      this.records = [];
      this.btnNew.disabled = true;
      this.renderCurrentView();
      DetailPanel.clear();
      return;
    }

    this.currentEntity = entityName;
    this.btnNew.disabled = false;
    this.filterInput.value = '';
    this.selectedId = null;

    await this.loadRecords();
    DetailPanel.clear();
  },

  async loadRecords(filter = '') {
    if (!this.currentEntity) return;

    try {
      const options = filter ? { filter } : {};
      const result = await ApiClient.getAll(this.currentEntity, options);
      this.records = result.data || [];
      this.renderCurrentView();
    } catch (err) {
      console.error('Failed to load records:', err);
      this.records = [];
      const message = `<p class="empty-message">Error loading records: ${err.message}</p>`;
      if (this.viewMode === 'table') {
        this.tableContainer.innerHTML = message;
      } else {
        this.treeContainer.innerHTML = message;
      }
    }
  },

  onFilterChange() {
    // Debounce filter input
    clearTimeout(this.filterTimeout);
    this.filterTimeout = setTimeout(() => {
      this.loadRecords(this.filterInput.value);
    }, 300);
  },

  onNewClick() {
    if (!this.currentEntity) return;
    this.selectedId = null;
    this.clearSelection();
    DetailPanel.showCreateForm(this.currentEntity);
  },

  setViewMode(mode) {
    this.viewMode = mode;
    sessionStorage.setItem('viewMode', this.viewMode);
    this.updateViewToggle();
    this.renderCurrentView();
  },

  updateViewToggle() {
    // Update button states
    this.btnViewTable.classList.toggle('active', this.viewMode === 'table');
    this.btnViewTree.classList.toggle('active', this.viewMode === 'tree');

    // Show/hide containers
    this.tableContainer.classList.toggle('hidden', this.viewMode !== 'table');
    this.treeContainer.classList.toggle('hidden', this.viewMode !== 'tree');
  },

  renderCurrentView() {
    if (this.viewMode === 'table') {
      this.renderTable();
    } else {
      this.renderTree();
    }
  },

  async renderTable() {
    if (!this.currentEntity) {
      this.tableContainer.innerHTML = '<p class="empty-message">Select an entity type to view records.</p>';
      return;
    }

    if (this.records.length === 0) {
      this.tableContainer.innerHTML = '<p class="empty-message">No records found.</p>';
      return;
    }

    await EntityTable.loadEntity(this.currentEntity, this.records);
  },

  renderList() {
    if (!this.currentEntity) {
      this.list.innerHTML = '<p class="empty-message">Select an entity type to view records.</p>';
      return;
    }

    if (this.records.length === 0) {
      this.list.innerHTML = '<p class="empty-message">No records found.</p>';
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
      this.treeContainer.innerHTML = '<p class="empty-message">Select an entity type to view records.</p>';
      return;
    }

    if (this.records.length === 0) {
      this.treeContainer.innerHTML = '<p class="empty-message">No records found.</p>';
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
      `Are you sure you want to delete this ${this.currentEntity}?`
    );

    if (confirmed) {
      try {
        await ApiClient.delete(this.currentEntity, id);
        await this.loadRecords(this.filterInput.value);
        if (this.selectedId === id) {
          this.selectedId = null;
          DetailPanel.clear();
        }
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
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
    await this.loadRecords(this.filterInput.value);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};
