/**
 * Entity Tree Component
 * Hierarchical tree structure for navigating entities and their relationships
 */
const EntityTree = {
  container: null,
  currentEntity: null,
  records: [],
  expandedNodes: new Set(),
  selectedNodeId: null,

  // Sort settings
  attributeOrder: 'schema', // 'schema' or 'alpha'
  referencePosition: 'end', // 'end', 'start', or 'inline'
  attributeLayout: 'row', // 'row' (horizontal) or 'list' (vertical)

  init(containerId) {
    this.container = document.getElementById(containerId);
    this.initSortControls();
  },

  initSortControls() {
    const attrSelect = document.getElementById('sort-attributes');
    const refSelect = document.getElementById('sort-references');
    const layoutSelect = document.getElementById('attr-layout');

    if (attrSelect) {
      // Restore from sessionStorage
      const savedAttr = sessionStorage.getItem('tree-attr-order');
      if (savedAttr) {
        this.attributeOrder = savedAttr;
        attrSelect.value = savedAttr;
      }

      attrSelect.addEventListener('change', (e) => {
        this.attributeOrder = e.target.value;
        sessionStorage.setItem('tree-attr-order', e.target.value);
        this.render();
      });
    }

    if (refSelect) {
      // Restore from sessionStorage
      const savedRef = sessionStorage.getItem('tree-ref-position');
      if (savedRef) {
        this.referencePosition = savedRef;
        refSelect.value = savedRef;
      }

      refSelect.addEventListener('change', (e) => {
        this.referencePosition = e.target.value;
        sessionStorage.setItem('tree-ref-position', e.target.value);
        this.render();
      });
    }

    if (layoutSelect) {
      // Restore from sessionStorage
      const savedLayout = sessionStorage.getItem('tree-attr-layout');
      if (savedLayout) {
        this.attributeLayout = savedLayout;
        layoutSelect.value = savedLayout;
      }

      layoutSelect.addEventListener('change', (e) => {
        this.attributeLayout = e.target.value;
        sessionStorage.setItem('tree-attr-layout', e.target.value);
        this.render();
      });
    }
  },

  /**
   * Load and display records for an entity type
   * @param {string} entityName - Entity type name
   * @param {Array} records - Array of records
   * @param {Object} options - Optional settings
   * @param {number} options.selectedId - ID of record to select and expand
   * @param {boolean} options.expandOutboundFKs - Also expand outbound FK nodes (default: true when selectedId set)
   */
  async loadEntity(entityName, records, options = {}) {
    this.currentEntity = entityName;
    this.records = records;
    this.expandedNodes.clear();
    this.selectedNodeId = null;

    // If a selectedId is provided, pre-expand the node and its outbound FKs
    if (options.selectedId) {
      const nodeId = `${entityName}-${options.selectedId}`;
      this.selectedNodeId = nodeId;
      this.expandedNodes.add(nodeId);

      // Pre-calculate outbound FK node IDs to expand
      if (options.expandOutboundFKs !== false) {
        const record = records.find(r => r.id === options.selectedId);
        if (record) {
          const schema = await SchemaCache.getExtended(entityName);
          for (const col of schema.columns) {
            if (col.foreignKey && record[col.name]) {
              const fkNodeId = `fk-${col.foreignKey.entity}-${record[col.name]}-from-${record.id}`;
              this.expandedNodes.add(fkNodeId);
            }
          }
        }
      }
    }

    await this.render();

    // Scroll to selected node if exists
    if (options.selectedId) {
      const selectedNode = this.container.querySelector(`[data-node-id="${this.selectedNodeId}"]`);
      if (selectedNode) {
        selectedNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  },

  /**
   * Render the tree
   */
  async render() {
    if (!this.currentEntity || !this.records.length) {
      this.container.innerHTML = '';
      return;
    }

    const schema = await SchemaCache.getExtended(this.currentEntity);

    let html = '<div class="entity-tree">';

    // If a record is selected, show only that record as root
    if (this.selectedNodeId) {
      const selectedRecordId = parseInt(this.selectedNodeId.split('-').pop());
      const selectedRecord = this.records.find(r => r.id === selectedRecordId);
      if (selectedRecord) {
        html += await this.renderRootNode(this.currentEntity, selectedRecord, schema);
      }
    } else {
      // No selection: show all records
      for (const record of this.records) {
        html += await this.renderRootNode(this.currentEntity, record, schema);
      }
    }

    html += '</div>';
    this.container.innerHTML = html;

    this.attachEventListeners();
  },

  /**
   * Render a root-level node (entity record from the main list)
   */
  async renderRootNode(entityName, record, schema) {
    const nodeId = `${entityName}-${record.id}`;
    const isExpanded = this.expandedNodes.has(nodeId);
    const isSelected = this.selectedNodeId === nodeId;
    const label = this.getRecordLabel(record, schema);
    const areaColor = schema.areaColor || '#f5f5f5';

    let html = `
      <div class="tree-node root-node ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}"
           data-node-id="${nodeId}"
           data-entity="${entityName}"
           data-record-id="${record.id}">
        <div class="tree-node-header" data-action="toggle" style="background-color: ${areaColor};">
          <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          <span class="tree-node-label">${this.escapeHtml(label.title)}</span>
          ${label.subtitle ? `<span class="tree-node-subtitle">${this.escapeHtml(label.subtitle)}</span>` : ''}
          <span class="tree-node-actions">
            <button class="btn-tree-action btn-edit" data-action="edit" title="Edit">&#9998;</button>
            <button class="btn-tree-action btn-delete" data-action="delete" title="Delete">&#128465;</button>
          </span>
        </div>
    `;

    if (isExpanded) {
      html += await this.renderNodeContent(entityName, record, schema);
    }

    html += '</div>';
    return html;
  },

  /**
   * Render the expanded content of a node (attributes + relationships)
   *
   * Field visibility:
   * - detailFields (LABEL, LABEL2, DETAIL): always visible
   * - All other fields: only visible on hover/focus
   */
  async renderNodeContent(entityName, record, schema) {
    const isRowLayout = this.attributeLayout === 'row';
    let html = `<div class="tree-node-content ${isRowLayout ? 'layout-row' : 'layout-list'}">`;

    // Separate columns into regular attributes, outbound FKs, and prepare back-references
    let columns = schema.columns.filter(col => !schema.ui?.hiddenFields?.includes(col.name));

    // Sort columns if needed
    if (this.attributeOrder === 'alpha') {
      columns = [...columns].sort((a, b) => a.name.localeCompare(b.name));
    }

    const regularCols = columns.filter(col => !col.foreignKey);
    const fkCols = columns.filter(col => col.foreignKey);
    const hasBackRefs = schema.backReferences && schema.backReferences.length > 0;

    // Helper to determine if field is hover-only (not in detailFields)
    const isHoverField = (colName) => {
      const detailFields = schema.ui?.detailFields || [];
      return !detailFields.includes(colName);
    };

    // Render regular attributes (possibly as row)
    if (isRowLayout && regularCols.length > 0) {
      html += this.renderAttributeRow(regularCols, record, schema, isHoverField);
    }

    // Render based on reference position setting
    if (this.referencePosition === 'start') {
      // FKs first, then back-refs, then regular attributes
      for (const col of fkCols) {
        html += await this.renderForeignKeyNode(col, record[col.name], record, isHoverField(col.name));
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences);
      }
      if (!isRowLayout) {
        for (const col of regularCols) {
          html += this.renderAttribute(col.name, record[col.name], isHoverField(col.name), schema);
        }
      }
    } else if (this.referencePosition === 'inline') {
      // Mixed: regular attrs, then FKs inline, then back-refs at end
      for (const col of columns) {
        const value = record[col.name];
        if (col.foreignKey) {
          html += await this.renderForeignKeyNode(col, value, record, isHoverField(col.name));
        } else if (!isRowLayout) {
          html += this.renderAttribute(col.name, value, isHoverField(col.name), schema);
        }
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences);
      }
    } else {
      // 'end' (default): regular attributes first, then FKs, then back-refs
      if (!isRowLayout) {
        for (const col of regularCols) {
          html += this.renderAttribute(col.name, record[col.name], isHoverField(col.name), schema);
        }
      }
      for (const col of fkCols) {
        html += await this.renderForeignKeyNode(col, record[col.name], record, isHoverField(col.name));
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences);
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * Render attributes as a horizontal row (table-like)
   */
  renderAttributeRow(columns, record, schema, isHoverField) {
    const cells = columns.map(col => {
      const value = record[col.name];
      let displayValue;
      if (value === null || value === undefined) {
        displayValue = '<em>null</em>';
      } else {
        displayValue = this.escapeHtml(ValueFormatter.format(value, col.name, schema));
      }
      const isHover = isHoverField(col.name);
      return `<td class="${isHover ? 'hover-field' : ''}" title="${col.name}">${displayValue}</td>`;
    }).join('');

    const headers = columns.map(col => `<th title="${col.name}">${col.name}</th>`).join('');

    return `
      <table class="tree-attr-table">
        <thead><tr>${headers}</tr></thead>
        <tbody><tr>${cells}</tr></tbody>
      </table>
    `;
  },

  /**
   * Render a regular attribute
   * Uses ValueFormatter to convert enum internal->external values
   */
  renderAttribute(name, value, isHover = false, schema = null) {
    let displayValue;
    if (value === null || value === undefined) {
      displayValue = '<em>null</em>';
    } else if (schema) {
      // Use ValueFormatter for enum conversion
      displayValue = this.escapeHtml(ValueFormatter.format(value, name, schema));
    } else {
      displayValue = this.escapeHtml(String(value));
    }

    const className = isHover ? 'tree-attribute hover-field' : 'tree-attribute';

    return `
      <div class="${className}">
        <span class="attr-name">${name}:</span>
        <span class="attr-value">${displayValue}</span>
      </div>
    `;
  },

  /**
   * Render a foreign key as an expandable node
   */
  async renderForeignKeyNode(col, fkId, parentRecord, isHover = false) {
    const hoverClass = isHover ? ' hover-field' : '';

    if (!fkId) {
      return `
        <div class="tree-attribute fk-field${hoverClass}">
          <span class="attr-name">${col.name}:</span>
          <span class="attr-value"><em>null</em></span>
        </div>
      `;
    }

    const nodeId = `fk-${col.foreignKey.entity}-${fkId}-from-${parentRecord.id}`;
    const isExpanded = this.expandedNodes.has(nodeId);

    // Get a label and area color for the referenced record
    let refLabel = `#${fkId}`;
    let areaColor = '#f5f5f5';
    try {
      const refSchema = await SchemaCache.getExtended(col.foreignKey.entity);
      const refRecord = await ApiClient.getById(col.foreignKey.entity, fkId);
      refLabel = this.getFullLabel(refRecord, refSchema);
      areaColor = refSchema.areaColor || '#f5f5f5';
    } catch (e) {
      // Fall back to just the ID
    }

    let html = `
      <div class="tree-fk-node${hoverClass} ${isExpanded ? 'expanded' : ''}"
           data-node-id="${nodeId}"
           data-entity="${col.foreignKey.entity}"
           data-record-id="${fkId}">
        <div class="tree-fk-header" data-action="toggle-fk" style="background-color: ${areaColor};">
          <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          <span class="attr-name">${col.name}:</span>
          <span class="fk-label">${this.escapeHtml(refLabel)}</span>
          <span class="fk-entity-link" data-action="navigate-entity" data-entity="${col.foreignKey.entity}" data-id="${fkId}">(${col.foreignKey.entity})</span>
        </div>
    `;

    if (isExpanded) {
      html += await this.renderExpandedForeignKey(col.foreignKey.entity, fkId);
    }

    html += '</div>';
    return html;
  },

  /**
   * Render the expanded content of a foreign key reference
   */
  async renderExpandedForeignKey(entityName, id) {
    try {
      const schema = await SchemaCache.getExtended(entityName);
      const record = await ApiClient.getById(entityName, id);

      const isRowLayout = this.attributeLayout === 'row';
      let html = '<div class="tree-fk-content">';

      // Separate regular columns and FK columns
      const allCols = schema.columns.filter(col => !schema.ui?.hiddenFields?.includes(col.name));
      const regularCols = allCols.filter(col => !col.foreignKey);
      const fkCols = allCols.filter(col => col.foreignKey && record[col.name]);

      // Helper for hover detection
      const isHoverField = (colName) => {
        const detailFields = schema.ui?.detailFields || [];
        return !detailFields.includes(colName);
      };

      // Render regular attributes (as row or list)
      if (isRowLayout && regularCols.length > 0) {
        html += this.renderAttributeRow(regularCols, record, schema, isHoverField);
      } else {
        for (const col of regularCols) {
          const isHover = isHoverField(col.name);
          html += this.renderAttribute(col.name, record[col.name], isHover, schema);
        }
      }

      // Render nested FKs as links (always as list)
      for (const col of fkCols) {
        html += await this.renderNestedForeignKey(col, record[col.name]);
      }

      html += '</div>';
      return html;
    } catch (e) {
      return `<div class="tree-error">Failed to load: ${e.message}</div>`;
    }
  },

  /**
   * Render a nested FK (no further expansion to prevent deep nesting)
   * Always shows the label of the referenced entity
   */
  async renderNestedForeignKey(col, fkId) {
    // Get the label for the referenced record (title + subtitle)
    let refLabel = `#${fkId}`;
    try {
      const refSchema = await SchemaCache.getExtended(col.foreignKey.entity);
      const refRecord = await ApiClient.getById(col.foreignKey.entity, fkId);
      refLabel = this.getFullLabel(refRecord, refSchema);
    } catch {
      // Fall back to just the ID
    }

    return `
      <div class="tree-attribute fk-link">
        <span class="attr-name">${col.name}:</span>
        <span class="fk-label">${this.escapeHtml(refLabel)}</span>
        <span class="fk-entity-link" data-action="navigate-entity" data-entity="${col.foreignKey.entity}" data-id="${fkId}">(${col.foreignKey.entity})</span>
      </div>
    `;
  },

  /**
   * Render back-references (entities that point to this record)
   */
  async renderBackReferences(entityName, recordId, backRefs) {
    let html = '';

    for (const ref of backRefs) {
      const nodeId = `backref-${ref.entity}-to-${entityName}-${recordId}`;
      const isExpanded = this.expandedNodes.has(nodeId);

      // Get count of referencing records and area color
      let count = 0;
      let areaColor = '#f5f5f5';
      try {
        const references = await ApiClient.getBackReferences(entityName, recordId);
        if (references[ref.entity]) {
          count = references[ref.entity].count;
        }
        // Get area color from the referencing entity's schema
        const refSchema = await SchemaCache.getExtended(ref.entity);
        areaColor = refSchema.areaColor || '#f5f5f5';
      } catch (e) {
        // Ignore errors
      }

      if (count === 0) continue;

      html += `
        <div class="tree-backref-node ${isExpanded ? 'expanded' : ''}"
             data-node-id="${nodeId}"
             data-ref-entity="${ref.entity}"
             data-ref-column="${ref.column}"
             data-parent-entity="${entityName}"
             data-parent-id="${recordId}">
          <div class="tree-backref-header" data-action="toggle-backref" style="background-color: ${areaColor};">
            <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="backref-label">${ref.entity} [${count}]</span>
          </div>
      `;

      if (isExpanded) {
        html += await this.renderExpandedBackReferences(entityName, recordId, ref.entity);
      }

      html += '</div>';
    }

    return html;
  },

  /**
   * Render expanded back-reference list as a table
   */
  async renderExpandedBackReferences(entityName, recordId, refEntity) {
    try {
      const references = await ApiClient.getBackReferences(entityName, recordId);
      const refData = references[refEntity];

      if (!refData || refData.records.length === 0) {
        return '<div class="tree-backref-content"><em>No references</em></div>';
      }

      const schema = await SchemaCache.getExtended(refEntity);

      // Get columns to display (exclude hidden fields and the FK that points back)
      const displayCols = schema.columns.filter(col => {
        if (schema.ui?.hiddenFields?.includes(col.name)) return false;
        // Exclude FK columns for cleaner display
        if (col.foreignKey) return false;
        return true;
      });

      // Build table header
      const headers = displayCols.map(col =>
        `<th title="${col.name}">${col.name}</th>`
      ).join('');

      // Build table rows
      const rows = refData.records.map(record => {
        const cells = displayCols.map(col => {
          const value = record[col.name];
          let displayValue;
          if (value === null || value === undefined) {
            displayValue = '<em>null</em>';
          } else {
            displayValue = this.escapeHtml(ValueFormatter.format(value, col.name, schema));
          }
          return `<td title="${col.name}">${displayValue}</td>`;
        }).join('');

        return `<tr class="backref-table-row" data-entity="${refEntity}" data-id="${record.id}" data-action="navigate">${cells}</tr>`;
      }).join('');

      return `
        <div class="tree-backref-content">
          <table class="tree-backref-table">
            <thead><tr>${headers}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (e) {
      return `<div class="tree-error">Failed to load references: ${e.message}</div>`;
    }
  },

  /**
   * Get display label for a record using schema UI metadata
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
   * Get combined label string for FK display (title + subtitle if available)
   */
  getFullLabel(record, schema) {
    const { title, subtitle } = this.getRecordLabel(record, schema);
    if (subtitle) {
      return `${title} · ${subtitle}`;
    }
    return title;
  },

  /**
   * Attach event listeners to tree nodes
   */
  attachEventListeners() {
    // Toggle expand/collapse
    this.container.querySelectorAll('[data-action="toggle"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = el.closest('.tree-node');
        const nodeId = node.dataset.nodeId;
        this.toggleNode(nodeId);
      });
    });

    // Toggle FK expand/collapse
    this.container.querySelectorAll('[data-action="toggle-fk"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = el.closest('.tree-fk-node');
        const nodeId = node.dataset.nodeId;
        this.toggleNode(nodeId);
      });
    });

    // Toggle back-reference expand/collapse
    this.container.querySelectorAll('[data-action="toggle-backref"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = el.closest('.tree-backref-node');
        const nodeId = node.dataset.nodeId;
        this.toggleNode(nodeId);
      });
    });

    // Edit button
    this.container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = btn.closest('.tree-node');
        const entityName = node.dataset.entity;
        const recordId = parseInt(node.dataset.recordId);
        this.onEdit(entityName, recordId);
      });
    });

    // Delete button
    this.container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = btn.closest('.tree-node');
        const entityName = node.dataset.entity;
        const recordId = parseInt(node.dataset.recordId);
        this.onDelete(entityName, recordId);
      });
    });

    // Navigate to back-reference (and expand the target record)
    // Works for both old list items and new table rows
    this.container.querySelectorAll('[data-action="navigate"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const recordId = parseInt(el.dataset.id);
        this.onNavigateAndExpand(entityName, recordId);
      });
    });

    // Click on FK reference link
    this.container.querySelectorAll('.fk-ref').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const recordId = parseInt(el.dataset.id);
        this.onNavigate(entityName, recordId);
      });
    });

    // Click on FK entity type link (e.g., "(AircraftType)")
    this.container.querySelectorAll('[data-action="navigate-entity"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const recordId = parseInt(el.dataset.id);
        this.onNavigateAndExpand(entityName, recordId);
      });
    });

    // Select node on header click
    this.container.querySelectorAll('.tree-node-header').forEach(el => {
      el.addEventListener('click', (e) => {
        const node = el.closest('.tree-node');
        const nodeId = node.dataset.nodeId;
        const entityName = node.dataset.entity;
        const recordId = parseInt(node.dataset.recordId);
        this.selectNode(nodeId, entityName, recordId);
      });
    });
  },

  /**
   * Toggle node expansion
   */
  toggleNode(nodeId) {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
    } else {
      this.expandedNodes.add(nodeId);
    }
    this.render();
  },

  /**
   * Select a node
   */
  selectNode(nodeId, entityName, recordId) {
    this.selectedNodeId = nodeId;
    const record = this.records.find(r => r.id === recordId);
    if (record) {
      DetailPanel.showRecord(entityName, record);
    }
    this.render();
  },

  /**
   * Handle edit action
   */
  onEdit(entityName, recordId) {
    const record = this.records.find(r => r.id === recordId);
    if (record) {
      DetailPanel.showEditForm(entityName, record);
    }
  },

  /**
   * Handle delete action
   */
  async onDelete(entityName, recordId) {
    const confirmed = await ConfirmDialog.show(
      `Are you sure you want to delete this ${entityName}?`
    );

    if (confirmed) {
      try {
        await ApiClient.delete(entityName, recordId);
        // Refresh via EntityExplorer
        await EntityExplorer.refresh();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    }
  },

  /**
   * Handle navigation to another entity
   */
  onNavigate(entityName, recordId) {
    // Switch to the target entity and select the record
    EntityExplorer.selectEntity(entityName);
    // After loading, we need to select the specific record
    setTimeout(() => {
      EntityExplorer.selectedId = recordId;
      EntityExplorer.updateSelection();
      const record = EntityExplorer.records.find(r => r.id === recordId);
      if (record) {
        DetailPanel.showRecord(entityName, record);
      }
    }, 300);
  },

  /**
   * Handle navigation to another entity AND expand the target record
   */
  onNavigateAndExpand(entityName, recordId) {
    // Switch to the target entity
    EntityExplorer.selectEntity(entityName);
    // After loading, select AND expand the specific record
    setTimeout(() => {
      const nodeId = `${entityName}-${recordId}`;
      // Add to expanded nodes so it will be expanded when rendered
      this.expandedNodes.clear();
      this.expandedNodes.add(nodeId);
      this.selectedNodeId = nodeId;

      EntityExplorer.selectedId = recordId;
      const record = EntityExplorer.records.find(r => r.id === recordId);
      if (record) {
        DetailPanel.showRecord(entityName, record);
        // Re-render tree to show expanded state
        this.currentEntity = entityName;
        this.records = EntityExplorer.records;
        this.render();
      }
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
