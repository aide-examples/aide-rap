/**
 * Entity Table Component
 * Sortable, scrollable table view for entity records
 */
const EntityTable = {
  container: null,
  currentEntity: null,
  records: [],
  schema: null,
  selectedId: null,
  sortColumn: null,
  sortDirection: 'asc', // 'asc' or 'desc'

  // Sort settings (shared with EntityTree)
  attributeOrder: 'schema', // 'schema' or 'alpha'
  referencePosition: 'end', // 'start', 'end', or 'inline'

  init(containerId) {
    this.container = document.getElementById(containerId);
    this.initSortControls();
  },

  initSortControls() {
    const attrSelect = document.getElementById('sort-attributes');
    const refSelect = document.getElementById('sort-references');

    if (attrSelect) {
      // Restore from sessionStorage
      const savedAttr = sessionStorage.getItem('tree-attr-order');
      if (savedAttr) {
        this.attributeOrder = savedAttr;
      }

      // Listen for changes (shared with EntityTree)
      attrSelect.addEventListener('change', (e) => {
        this.attributeOrder = e.target.value;
        this.render();
      });
    }

    if (refSelect) {
      // Restore from sessionStorage
      const savedRef = sessionStorage.getItem('tree-ref-position');
      if (savedRef) {
        this.referencePosition = savedRef;
      }

      // Listen for changes (shared with EntityTree)
      refSelect.addEventListener('change', (e) => {
        this.referencePosition = e.target.value;
        this.render();
      });
    }
  },

  /**
   * Load and display records for an entity type
   */
  async loadEntity(entityName, records) {
    this.currentEntity = entityName;
    this.records = records;
    this.selectedId = null;
    this.sortColumn = null;
    this.sortDirection = 'asc';

    // Get schema
    this.schema = await SchemaCache.getExtended(entityName);

    await this.render();
  },

  /**
   * Get visible columns based on schema and sort settings
   * Respects both attributeOrder (alpha/schema) and referencePosition (start/end/inline)
   * Back-references are always at the end (handled separately in render)
   */
  getVisibleColumns() {
    if (!this.schema) return [];

    let columns = this.schema.columns.filter(col =>
      !this.schema.ui?.hiddenFields?.includes(col.name)
    );

    // Sort columns alphabetically if requested
    if (this.attributeOrder === 'alpha') {
      columns = [...columns].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Reorder based on reference position (FK columns vs regular columns)
    if (this.referencePosition === 'start') {
      // FK columns first, then regular columns
      const fkCols = columns.filter(col => col.foreignKey);
      const regularCols = columns.filter(col => !col.foreignKey);
      columns = [...fkCols, ...regularCols];
    } else if (this.referencePosition === 'end') {
      // Regular columns first, then FK columns
      const fkCols = columns.filter(col => col.foreignKey);
      const regularCols = columns.filter(col => !col.foreignKey);
      columns = [...regularCols, ...fkCols];
    }
    // 'inline' keeps the original order (schema or alpha)

    return columns;
  },

  /**
   * Get sorted records
   */
  getSortedRecords() {
    if (!this.sortColumn) {
      return this.records;
    }

    return [...this.records].sort((a, b) => {
      let valA = a[this.sortColumn];
      let valB = b[this.sortColumn];

      // Handle null/undefined
      if (valA == null) valA = '';
      if (valB == null) valB = '';

      // Compare
      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }

      return this.sortDirection === 'desc' ? -cmp : cmp;
    });
  },

  /**
   * Render the table
   */
  async render() {
    if (!this.currentEntity || !this.schema) {
      this.container.innerHTML = '';
      return;
    }

    if (this.records.length === 0) {
      this.container.innerHTML = '<p class="empty-message">No records found.</p>';
      return;
    }

    const columns = this.getVisibleColumns();
    const sortedRecords = this.getSortedRecords();
    const backRefs = this.schema.backReferences || [];

    // Build table HTML
    let html = '<div class="entity-table-wrapper"><table class="entity-table">';

    // Header row
    html += '<thead><tr>';
    for (const col of columns) {
      const isSorted = this.sortColumn === col.name;
      const sortIcon = isSorted
        ? (this.sortDirection === 'asc' ? ' &#9650;' : ' &#9660;')
        : ' <span class="sort-hint">&#8645;</span>';
      const isFK = col.foreignKey ? ' fk-column' : '';

      html += `<th class="sortable${isFK}" data-column="${col.name}">
        ${this.escapeHtml(col.name)}${sortIcon}
      </th>`;
    }
    // Back-reference columns
    for (const ref of backRefs) {
      html += `<th class="backref-column" title="Records in ${ref.entity} referencing this via ${ref.column}">
        ${ref.entity} <span class="backref-field">(${ref.column})</span>
      </th>`;
    }
    html += '<th class="actions-column"></th>';
    html += '</tr></thead>';

    // Body rows
    html += '<tbody>';
    for (let i = 0; i < sortedRecords.length; i++) {
      const record = sortedRecords[i];
      const isSelected = record.id === this.selectedId;
      const rowClass = isSelected ? 'selected' : (i % 2 === 1 ? 'zebra' : '');

      html += `<tr class="${rowClass}" data-id="${record.id}">`;

      for (const col of columns) {
        const value = record[col.name];

        if (col.foreignKey && value) {
          // FK - render as link with loading placeholder
          html += `<td class="fk-cell" data-entity="${col.foreignKey.entity}" data-id="${value}">
            <span class="fk-loading">#${value}</span>
          </td>`;
        } else {
          // Regular value
          const displayValue = value != null ? this.escapeHtml(String(value)) : '<em class="null-value">null</em>';
          html += `<td>${displayValue}</td>`;
        }
      }

      // Back-reference cells (counts loaded only for selected row)
      for (const ref of backRefs) {
        html += `<td class="backref-cell"
                     data-ref-entity="${ref.entity}"
                     data-ref-column="${ref.column}"
                     data-record-id="${record.id}">
          <span class="backref-placeholder">-</span>
        </td>`;
      }

      // Actions (only delete - edit is in detail panel)
      html += `<td class="actions-cell">
        <button class="btn-table-action btn-delete" data-id="${record.id}" title="Delete">&#128465;</button>
      </td>`;

      html += '</tr>';
    }
    html += '</tbody></table></div>';

    this.container.innerHTML = html;

    // Load FK labels asynchronously
    this.loadForeignKeyLabels();

    // Load back-reference counts only for selected row (performance optimization)
    if (this.selectedId) {
      this.loadBackReferenceCountsForRow(this.selectedId);
    }

    // Attach event listeners
    this.attachEventListeners();
  },

  /**
   * Load FK labels for all FK cells
   */
  async loadForeignKeyLabels() {
    const fkCells = this.container.querySelectorAll('.fk-cell');

    for (const cell of fkCells) {
      const entityName = cell.dataset.entity;
      const id = parseInt(cell.dataset.id);

      try {
        const refSchema = await SchemaCache.getExtended(entityName);
        const refRecord = await ApiClient.getById(entityName, id);
        const label = this.getRecordLabel(refRecord, refSchema);
        const fullLabel = label.subtitle ? `${label.title} · ${label.subtitle}` : label.title;

        cell.innerHTML = `
          <span class="fk-value" data-action="navigate" data-entity="${entityName}" data-id="${id}">
            ${this.escapeHtml(fullLabel)}
          </span>
          <span class="fk-entity-badge">${entityName}</span>
        `;
      } catch {
        // Keep the ID fallback
      }
    }

    // Re-attach navigation listeners for FK links
    this.container.querySelectorAll('[data-action="navigate"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const recordId = parseInt(el.dataset.id);
        this.onNavigate(entityName, recordId);
      });
    });
  },

  /**
   * Load back-reference counts only for a specific row (performance optimization)
   * Called when a row is selected
   */
  async loadBackReferenceCountsForRow(recordId) {
    const row = this.container.querySelector(`tr[data-id="${recordId}"]`);
    if (!row) return;

    const backrefCells = row.querySelectorAll('.backref-cell');

    for (const cell of backrefCells) {
      const refEntity = cell.dataset.refEntity;
      const refColumn = cell.dataset.refColumn;

      try {
        // Get count of records that reference this record
        const result = await ApiClient.getAll(refEntity, {
          filter: `${refColumn}:${recordId}`
        });
        const count = result.data?.length || 0;

        if (count > 0) {
          cell.innerHTML = `
            <span class="backref-count"
                  data-action="filter-navigate"
                  data-entity="${refEntity}"
                  data-filter="${refColumn}:${recordId}"
                  title="Show ${count} ${refEntity} records">
              ${count}
            </span>
          `;
        } else {
          cell.innerHTML = '<span class="backref-zero">0</span>';
        }
      } catch {
        cell.innerHTML = '<span class="backref-error">?</span>';
      }
    }

    // Attach click handlers for backref navigation
    row.querySelectorAll('[data-action="filter-navigate"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const filter = el.dataset.filter;
        this.onFilterNavigate(entityName, filter);
      });
    });
  },

  /**
   * Get display label for a record
   */
  getRecordLabel(record, schema) {
    let title = `#${record.id}`;
    let subtitle = null;

    if (schema.ui?.labelFields && schema.ui.labelFields.length > 0) {
      const primaryLabel = record[schema.ui.labelFields[0]];
      if (primaryLabel) {
        title = String(primaryLabel);
      }

      if (schema.ui.labelFields.length > 1) {
        const secondaryLabel = record[schema.ui.labelFields[1]];
        if (secondaryLabel) {
          subtitle = String(secondaryLabel);
        }
      }
    } else {
      // Fallback: use heuristics
      const candidates = ['name', 'title', 'registration', 'designation', 'code'];
      for (const name of candidates) {
        if (record[name]) {
          title = String(record[name]);
          break;
        }
      }
    }

    return { title, subtitle };
  },

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Column header click for sorting
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const column = th.dataset.column;
        this.onColumnSort(column);
      });
    });

    // Row click for selection
    this.container.querySelectorAll('tbody tr').forEach(row => {
      row.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-table-action') && !e.target.closest('[data-action]')) {
          const id = parseInt(row.dataset.id);
          this.onRowClick(id);
        }
      });
    });

    // Delete button
    this.container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        this.onDelete(id);
      });
    });
  },

  /**
   * Handle column sort
   */
  onColumnSort(column) {
    if (this.sortColumn === column) {
      // Toggle direction
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.render();
  },

  /**
   * Handle row click
   */
  onRowClick(id) {
    const previousId = this.selectedId;
    this.selectedId = id;
    const record = this.records.find(r => r.id === id);
    if (record) {
      DetailPanel.showRecord(this.currentEntity, record);
    }

    // Update selection visually without full re-render
    this.container.querySelectorAll('tbody tr').forEach(row => {
      const rowId = parseInt(row.dataset.id);
      row.classList.toggle('selected', rowId === id);
      row.classList.toggle('zebra', rowId !== id && this.records.findIndex(r => r.id === rowId) % 2 === 1);
    });

    // Load back-reference counts for the newly selected row
    if (id !== previousId) {
      this.loadBackReferenceCountsForRow(id);
    }
  },

  /**
   * Handle edit action
   */
  onEdit(id) {
    this.selectedId = id;
    const record = this.records.find(r => r.id === id);
    if (record) {
      DetailPanel.showEditForm(this.currentEntity, record);
    }
    this.render();
  },

  /**
   * Handle delete action
   */
  async onDelete(id) {
    const confirmed = await ConfirmDialog.show(
      `Are you sure you want to delete this ${this.currentEntity}?`
    );

    if (confirmed) {
      try {
        await ApiClient.delete(this.currentEntity, id);
        await EntityExplorer.refresh();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    }
  },

  /**
   * Handle FK navigation
   */
  onNavigate(entityName, recordId) {
    // Switch to the target entity and select the record
    EntityExplorer.selectEntity(entityName);
    setTimeout(() => {
      EntityExplorer.selectedId = recordId;
      const record = EntityExplorer.records.find(r => r.id === recordId);
      if (record) {
        DetailPanel.showRecord(entityName, record);
        this.selectedId = recordId;
        this.render();
      }
    }, 300);
  },

  /**
   * Handle back-reference navigation with filter
   * Switches to target entity and applies filter to show only referencing records
   */
  onFilterNavigate(entityName, filter) {
    // Switch to the target entity
    EntityExplorer.selectEntity(entityName);
    setTimeout(() => {
      // Apply the filter
      EntityExplorer.filterInput.value = filter;
      EntityExplorer.loadRecords(filter);
    }, 300);
  },

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};
