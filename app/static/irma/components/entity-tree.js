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

  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  /**
   * Load and display records for an entity type
   */
  async loadEntity(entityName, records) {
    this.currentEntity = entityName;
    this.records = records;
    this.expandedNodes.clear();
    this.selectedNodeId = null;
    await this.render();
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

    for (const record of this.records) {
      html += await this.renderRootNode(this.currentEntity, record, schema);
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

    let html = `
      <div class="tree-node root-node ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}"
           data-node-id="${nodeId}"
           data-entity="${entityName}"
           data-record-id="${record.id}">
        <div class="tree-node-header" data-action="toggle">
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
   */
  async renderNodeContent(entityName, record, schema) {
    let html = '<div class="tree-node-content">';

    // Render attributes
    for (const col of schema.columns) {
      // Skip hidden fields
      if (schema.ui?.hiddenFields?.includes(col.name)) continue;

      const value = record[col.name];

      if (col.foreignKey) {
        // Foreign key - render as expandable sub-node
        html += await this.renderForeignKeyNode(col, value, record);
      } else {
        // Regular attribute
        const isHover = schema.ui?.hoverFields?.includes(col.name);
        html += this.renderAttribute(col.name, value, isHover);
      }
    }

    // Render back-references if available
    if (schema.backReferences && schema.backReferences.length > 0) {
      html += await this.renderBackReferences(entityName, record.id, schema.backReferences);
    }

    html += '</div>';
    return html;
  },

  /**
   * Render a regular attribute
   */
  renderAttribute(name, value, isHover = false) {
    const displayValue = value !== null && value !== undefined ? value : '<em>null</em>';
    const className = isHover ? 'tree-attribute hover-field' : 'tree-attribute';

    return `
      <div class="${className}">
        <span class="attr-name">${name}:</span>
        <span class="attr-value">${this.escapeHtml(String(displayValue))}</span>
      </div>
    `;
  },

  /**
   * Render a foreign key as an expandable node
   */
  async renderForeignKeyNode(col, fkId, parentRecord) {
    if (!fkId) {
      return `
        <div class="tree-attribute fk-field">
          <span class="attr-name">${col.name}:</span>
          <span class="attr-value"><em>null</em></span>
        </div>
      `;
    }

    const nodeId = `fk-${col.foreignKey.entity}-${fkId}-from-${parentRecord.id}`;
    const isExpanded = this.expandedNodes.has(nodeId);

    // Get a label for the referenced record
    let refLabel = `#${fkId}`;
    try {
      const refSchema = await SchemaCache.getExtended(col.foreignKey.entity);
      const refRecord = await ApiClient.getById(col.foreignKey.entity, fkId);
      const label = this.getRecordLabel(refRecord, refSchema);
      refLabel = label.title;
    } catch (e) {
      // Fall back to just the ID
    }

    let html = `
      <div class="tree-fk-node ${isExpanded ? 'expanded' : ''}"
           data-node-id="${nodeId}"
           data-entity="${col.foreignKey.entity}"
           data-record-id="${fkId}">
        <div class="tree-fk-header" data-action="toggle-fk">
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

      let html = '<div class="tree-fk-content">';

      for (const col of schema.columns) {
        if (schema.ui?.hiddenFields?.includes(col.name)) continue;

        const value = record[col.name];

        if (col.foreignKey && value) {
          // Nested FK - show as clickable link but not expandable to prevent deep recursion
          html += this.renderNestedForeignKey(col, value);
        } else {
          const isHover = schema.ui?.hoverFields?.includes(col.name);
          html += this.renderAttribute(col.name, value, isHover);
        }
      }

      html += '</div>';
      return html;
    } catch (e) {
      return `<div class="tree-error">Failed to load: ${e.message}</div>`;
    }
  },

  /**
   * Render a nested FK (no further expansion to prevent deep nesting)
   */
  renderNestedForeignKey(col, fkId) {
    return `
      <div class="tree-attribute fk-link">
        <span class="attr-name">${col.name}:</span>
        <span class="attr-value fk-ref" data-entity="${col.foreignKey.entity}" data-id="${fkId}">
          ${col.foreignKey.entity} #${fkId}
        </span>
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

      // Get count of referencing records
      let count = 0;
      try {
        const references = await ApiClient.getBackReferences(entityName, recordId);
        if (references[ref.entity]) {
          count = references[ref.entity].count;
        }
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
          <div class="tree-backref-header" data-action="toggle-backref">
            <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="backref-label">[${ref.entity} references] (${count})</span>
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
   * Render expanded back-reference list
   */
  async renderExpandedBackReferences(entityName, recordId, refEntity) {
    try {
      const references = await ApiClient.getBackReferences(entityName, recordId);
      const refData = references[refEntity];

      if (!refData || refData.records.length === 0) {
        return '<div class="tree-backref-content"><em>No references</em></div>';
      }

      const schema = await SchemaCache.getExtended(refEntity);

      let html = '<div class="tree-backref-content">';

      for (const record of refData.records) {
        const label = this.getRecordLabel(record, schema);
        html += `
          <div class="tree-backref-item"
               data-entity="${refEntity}"
               data-id="${record.id}"
               data-action="navigate">
            <span class="backref-item-icon">&#8594;</span>
            <span class="backref-item-label">${this.escapeHtml(label.title)}</span>
            ${label.subtitle ? `<span class="backref-item-subtitle">${this.escapeHtml(label.subtitle)}</span>` : ''}
          </div>
        `;
      }

      html += '</div>';
      return html;
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

    // Navigate to back-reference
    this.container.querySelectorAll('[data-action="navigate"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const entityName = el.dataset.entity;
        const recordId = parseInt(el.dataset.id);
        this.onNavigate(entityName, recordId);
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
