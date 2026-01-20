/**
 * Entity Explorer Component
 * Left panel with entity selector, list/tree view, and filters
 */
const EntityExplorer = {
  selector: null,
  list: null,
  treeContainer: null,
  filterInput: null,
  btnNew: null,
  btnViewToggle: null,
  currentEntity: null,
  records: [],
  selectedId: null,
  filterTimeout: null,
  viewMode: 'tree', // 'list' or 'tree'

  async init() {
    this.selector = document.getElementById('entity-selector');
    this.list = document.getElementById('entity-list');
    this.treeContainer = document.getElementById('entity-tree-container');
    this.filterInput = document.getElementById('filter-input');
    this.btnNew = document.getElementById('btn-new');
    this.btnViewToggle = document.getElementById('btn-view-toggle');

    // Initialize tree component
    EntityTree.init('entity-tree-container');

    // Restore view mode from session
    const savedViewMode = sessionStorage.getItem('viewMode');
    if (savedViewMode) {
      this.viewMode = savedViewMode;
    }
    this.updateViewToggle();

    // Load entity types into selector
    await this.loadEntityTypes();

    // Event listeners
    this.selector.addEventListener('change', () => this.onEntityChange());
    this.filterInput.addEventListener('input', () => this.onFilterChange());
    this.btnNew.addEventListener('click', () => this.onNewClick());
    this.btnViewToggle.addEventListener('click', () => this.toggleViewMode());

    // Initially disable new button
    this.btnNew.disabled = true;
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

      // Create optgroups for each area
      for (const [areaName, group] of Object.entries(grouped)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = areaName;
        optgroup.style.backgroundColor = group.color;

        group.entities.forEach(e => {
          const option = document.createElement('option');
          option.value = e.name;
          option.textContent = e.name;
          option.style.backgroundColor = e.areaColor;
          option.dataset.areaColor = e.areaColor;
          optgroup.appendChild(option);
        });

        this.selector.appendChild(optgroup);
      }

      // Update selector background on change
      this.selector.addEventListener('change', () => this.updateSelectorColor());
    } catch (err) {
      console.error('Failed to load entity types:', err);
    }
  },

  updateSelectorColor() {
    const selected = this.selector.options[this.selector.selectedIndex];
    if (selected && selected.dataset.areaColor) {
      this.selector.style.backgroundColor = selected.dataset.areaColor;
    } else {
      this.selector.style.backgroundColor = '';
    }
  },

  selectEntity(entityName) {
    this.selector.value = entityName;
    this.onEntityChange();
  },

  async onEntityChange() {
    const entityName = this.selector.value;

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
      if (this.viewMode === 'list') {
        this.list.innerHTML = message;
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

  toggleViewMode() {
    this.viewMode = this.viewMode === 'list' ? 'tree' : 'list';
    sessionStorage.setItem('viewMode', this.viewMode);
    this.updateViewToggle();
    this.renderCurrentView();
  },

  updateViewToggle() {
    const icon = document.getElementById('view-icon');
    if (this.viewMode === 'tree') {
      this.btnViewToggle.classList.add('active');
      icon.innerHTML = '&#9776;'; // hamburger icon for list
      this.btnViewToggle.title = 'Switch to list view';
    } else {
      this.btnViewToggle.classList.remove('active');
      icon.innerHTML = '&#8801;'; // tree icon
      this.btnViewToggle.title = 'Switch to tree view';
    }

    // Show/hide containers
    this.list.classList.toggle('hidden', this.viewMode === 'tree');
    this.treeContainer.classList.toggle('hidden', this.viewMode === 'list');
  },

  renderCurrentView() {
    if (this.viewMode === 'list') {
      this.renderList();
    } else {
      this.renderTree();
    }
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

    await EntityTree.loadEntity(this.currentEntity, this.records);
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
    this.list.querySelectorAll('.entity-row').forEach(row => {
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
