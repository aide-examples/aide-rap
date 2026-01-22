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
  attributeLayout: 'list', // 'row' (horizontal) or 'list' (vertical) - controlled by view mode buttons

  init(containerId) {
    this.container = document.getElementById(containerId);
    this.initSortControls();
  },

  /**
   * Set attribute layout (called by EntityExplorer when view mode changes)
   */
  setAttributeLayout(layout) {
    if (layout !== this.attributeLayout) {
      this.attributeLayout = layout;
      if (this.currentEntity && this.records.length > 0) {
        this.render();
      }
    }
  },

  initSortControls() {
    const attrSelect = document.getElementById('sort-attributes');
    const refSelect = document.getElementById('sort-references');

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
        </div>
    `;

    if (isExpanded) {
      // Initialize visited path with root entity for cycle detection
      const visitedPath = new Set([`${entityName}-${record.id}`]);
      html += await this.renderNodeContent(entityName, record, schema, visitedPath);
    }

    html += '</div>';
    return html;
  },

  /**
   * Render the expanded content of a node (attributes + relationships)
   * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
   */
  async renderNodeContent(entityName, record, schema, visitedPath = new Set()) {
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

    // Render regular attributes (possibly as row)
    if (isRowLayout && regularCols.length > 0) {
      html += this.renderAttributeRow(regularCols, record, schema);
    }

    // Render based on reference position setting
    if (this.referencePosition === 'start') {
      // FKs first, then back-refs, then regular attributes
      for (const col of fkCols) {
        html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath);
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath);
      }
      if (!isRowLayout) {
        for (const col of regularCols) {
          html += this.renderAttribute(col.name, record[col.name], schema);
        }
      }
    } else if (this.referencePosition === 'inline') {
      // Mixed: regular attrs, then FKs inline, then back-refs at end
      for (const col of columns) {
        const value = record[col.name];
        if (col.foreignKey) {
          html += await this.renderForeignKeyNode(col, value, record, visitedPath);
        } else if (!isRowLayout) {
          html += this.renderAttribute(col.name, value, schema);
        }
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath);
      }
    } else {
      // 'end' (default): regular attributes first, then FKs, then back-refs
      if (!isRowLayout) {
        for (const col of regularCols) {
          html += this.renderAttribute(col.name, record[col.name], schema);
        }
      }
      for (const col of fkCols) {
        html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath);
      }
      if (hasBackRefs) {
        html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath);
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * Render attributes as a horizontal row (table-like)
   */
  renderAttributeRow(columns, record, schema) {
    const cells = columns.map(col => {
      const value = record[col.name];
      let displayValue;
      if (value === null || value === undefined) {
        displayValue = '<em>null</em>';
      } else {
        displayValue = this.escapeHtml(ValueFormatter.format(value, col.name, schema));
      }
      return `<td title="${col.name}">${displayValue}</td>`;
    }).join('');

    const headers = columns.map(col => `<th title="${col.name}">${col.name.replace(/_/g, ' ')}</th>`).join('');

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
  renderAttribute(name, value, schema = null) {
    let displayValue;
    if (value === null || value === undefined) {
      displayValue = '<em>null</em>';
    } else if (schema) {
      // Use ValueFormatter for enum conversion
      displayValue = this.escapeHtml(ValueFormatter.format(value, name, schema));
    } else {
      displayValue = this.escapeHtml(String(value));
    }

    return `
      <div class="tree-attribute">
        <span class="attr-name">${name.replace(/_/g, ' ')}:</span>
        <span class="attr-value">${displayValue}</span>
      </div>
    `;
  },

  /**
   * Render a foreign key as an expandable node with cycle detection
   * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
   */
  async renderForeignKeyNode(col, fkId, parentRecord, visitedPath = new Set()) {
    if (!fkId) {
      return `
        <div class="tree-attribute fk-field">
          <span class="attr-name">${col.name}:</span>
          <span class="attr-value"><em>null</em></span>
        </div>
      `;
    }

    const targetEntity = col.foreignKey.entity;
    const pairKey = `${targetEntity}-${fkId}`;
    const isCycle = visitedPath.has(pairKey);

    const nodeId = `fk-${targetEntity}-${fkId}-from-${parentRecord.id}`;
    const isExpanded = !isCycle && this.expandedNodes.has(nodeId);

    // Check for preloaded label from View (FK-Label-Enrichment)
    const displayName = col.name.endsWith('_id')
      ? col.name.slice(0, -3)  // type_id -> type
      : col.name;
    const labelField = displayName + '_label';
    const preloadedLabel = parentRecord[labelField];

    // Get a label and area color for the referenced record
    let refLabel = preloadedLabel || `#${fkId}`;
    let areaColor = '#f5f5f5';
    try {
      const refSchema = await SchemaCache.getExtended(targetEntity);
      areaColor = refSchema.areaColor || '#f5f5f5';
      // Only fetch record if no preloaded label
      if (!preloadedLabel) {
        const refRecord = await ApiClient.getById(targetEntity, fkId);
        refLabel = this.getFullLabel(refRecord, refSchema);
      }
    } catch (e) {
      // Fall back to just the ID or preloaded label
    }

    // Cycle detected: render as non-expandable link with visual marker
    if (isCycle) {
      return `
        <div class="tree-fk-node cycle-detected"
             data-entity="${targetEntity}"
             data-record-id="${fkId}">
          <div class="tree-fk-header disabled" style="background-color: ${areaColor};">
            <span class="cycle-icon" title="Cycle detected - already visited">&#8635;</span>
            <span class="attr-name">${col.name}:</span>
            <span class="fk-label">${this.escapeHtml(refLabel)}</span>
            <span class="fk-entity-link" data-action="navigate-entity" data-entity="${targetEntity}" data-id="${fkId}">(${targetEntity})</span>
          </div>
        </div>
      `;
    }

    // No cycle: render as expandable node
    let html = `
      <div class="tree-fk-node ${isExpanded ? 'expanded' : ''}"
           data-node-id="${nodeId}"
           data-entity="${targetEntity}"
           data-record-id="${fkId}">
        <div class="tree-fk-header" data-action="toggle-fk" style="background-color: ${areaColor};">
          <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          <span class="attr-name">${col.name}:</span>
          <span class="fk-label">${this.escapeHtml(refLabel)}</span>
          <span class="fk-entity-link" data-action="navigate-entity" data-entity="${targetEntity}" data-id="${fkId}">(${targetEntity})</span>
        </div>
    `;

    if (isExpanded) {
      // Extend path with current entity-id pair
      const newPath = new Set([...visitedPath, pairKey]);
      html += await this.renderExpandedForeignKey(targetEntity, fkId, newPath);
    }

    html += '</div>';
    return html;
  },

  /**
   * Render the expanded content of a foreign key reference
   * Now supports recursive expansion and back-references at any depth
   * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
   */
  async renderExpandedForeignKey(entityName, id, visitedPath = new Set()) {
    try {
      const schema = await SchemaCache.getExtended(entityName);
      const record = await ApiClient.getById(entityName, id);

      const isRowLayout = this.attributeLayout === 'row';
      let html = '<div class="tree-fk-content">';

      // Separate regular columns and FK columns
      const allCols = schema.columns.filter(col => !schema.ui?.hiddenFields?.includes(col.name));
      const regularCols = allCols.filter(col => !col.foreignKey);
      const fkCols = allCols.filter(col => col.foreignKey && record[col.name]);

      // Render regular attributes (as row or list)
      if (isRowLayout && regularCols.length > 0) {
        html += this.renderAttributeRow(regularCols, record, schema);
      } else {
        for (const col of regularCols) {
          html += this.renderAttribute(col.name, record[col.name], schema);
        }
      }

      // Render FKs RECURSIVELY (expandable, with cycle detection)
      for (const col of fkCols) {
        html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath);
      }

      // Back-references also at this level
      if (schema.backReferences && schema.backReferences.length > 0) {
        html += await this.renderBackReferences(entityName, id, schema.backReferences, visitedPath);
      }

      html += '</div>';
      return html;
    } catch (e) {
      return `<div class="tree-error">Failed to load: ${e.message}</div>`;
    }
  },

  /**
   * Render back-references (entities that point to this record)
   * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
   */
  async renderBackReferences(entityName, recordId, backRefs, visitedPath = new Set()) {
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

      // Use area color from back-reference metadata (already included in schema)
      const areaColor = ref.areaColor || '#f5f5f5';

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
        html += await this.renderExpandedBackReferences(entityName, recordId, ref.entity, visitedPath);
      }

      html += '</div>';
    }

    return html;
  },

  /**
   * Render expanded back-reference list as a table
   * @param {Set} visitedPath - Set of visited entity-id pairs (for future use)
   */
  async renderExpandedBackReferences(entityName, recordId, refEntity, visitedPath = new Set()) {
    try {
      const references = await ApiClient.getBackReferences(entityName, recordId);
      const refData = references[refEntity];

      if (!refData || refData.records.length === 0) {
        return '<div class="tree-backref-content"><em>No references</em></div>';
      }

      const schema = await SchemaCache.getExtended(refEntity);
      const areaColor = schema.areaColor || '#f5f5f5';

      // Get visible columns and build display columns with FK labels using shared ColumnUtils
      const visibleCols = ColumnUtils.getVisibleColumns(schema);
      const displayCols = ColumnUtils.buildDisplayColumnsWithLabels(visibleCols);

      // Build table header with expand column
      // Use displayName for virtual label columns, otherwise format the column name
      const headers = `<th class="expand-col"></th>` + displayCols.map(col => {
        const headerText = col.displayName || col.name.replace(/_/g, ' ');
        return `<th title="${col.name}">${headerText}</th>`;
      }).join('');

      // Build table rows with expand triangles and cycle detection
      let rowsHtml = '';
      for (const record of refData.records) {
        const rowNodeId = `backref-row-${refEntity}-${record.id}-in-${entityName}-${recordId}`;
        const rowPairKey = `${refEntity}-${record.id}`;
        const isCycle = visitedPath.has(rowPairKey);
        const isRowExpanded = !isCycle && this.expandedNodes.has(rowNodeId);

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

        // Render expand cell: cycle icon if cycle, otherwise triangle
        let expandCell;
        if (isCycle) {
          expandCell = `
            <td class="expand-cell cycle-cell" title="Cycle detected - already visited">
              <span class="cycle-icon">&#8635;</span>
            </td>
          `;
        } else {
          expandCell = `
            <td class="expand-cell" data-action="toggle-backref-row">
              <span class="tree-expand-icon">${isRowExpanded ? '&#9660;' : '&#9654;'}</span>
            </td>
          `;
        }

        rowsHtml += `
          <tr class="backref-table-row ${isRowExpanded ? 'expanded' : ''} ${isCycle ? 'cycle-row' : ''}"
              data-node-id="${rowNodeId}"
              data-entity="${refEntity}"
              data-id="${record.id}">
            ${expandCell}
            ${cells}
          </tr>
        `;

        // If row is expanded (and not a cycle), render inline content
        if (isRowExpanded) {
          const colSpan = displayCols.length + 1;
          const newPath = new Set([...visitedPath, rowPairKey]);
          const expandedContent = await this.renderBackRefRowContent(refEntity, record, schema, newPath);
          rowsHtml += `
            <tr class="backref-row-content">
              <td colspan="${colSpan}" style="background-color: ${areaColor};">
                ${expandedContent}
              </td>
            </tr>
          `;
        }
      }

      return `
        <div class="tree-backref-content">
          <table class="tree-backref-table">
            <thead><tr>${headers}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    } catch (e) {
      return `<div class="tree-error">Failed to load references: ${e.message}</div>`;
    }
  },

  /**
   * Render content for an expanded back-reference row
   * Shows FKs and back-references of the referenced record
   * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
   */
  async renderBackRefRowContent(entityName, record, schema, visitedPath = new Set()) {
    const isRowLayout = this.attributeLayout === 'row';
    let html = '<div class="backref-row-expanded">';

    // Get FK columns that have values
    const fkCols = schema.columns.filter(col =>
      col.foreignKey && record[col.name] && !schema.ui?.hiddenFields?.includes(col.name)
    );

    // Render FKs recursively
    for (const col of fkCols) {
      html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath);
    }

    // Back-references of this record
    if (schema.backReferences && schema.backReferences.length > 0) {
      html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath);
    }

    // If no FKs and no back-refs, show a message
    if (fkCols.length === 0 && (!schema.backReferences || schema.backReferences.length === 0)) {
      html += '<em class="no-relations">No relations</em>';
    }

    html += '</div>';
    return html;
  },

  /**
   * Get display label for a record using schema UI metadata
   * Delegates to shared ColumnUtils
   */
  getRecordLabel(record, schema) {
    return ColumnUtils.getRecordLabel(record, schema);
  },

  /**
   * Get combined label string for FK display (title + subtitle if available)
   * Delegates to shared ColumnUtils
   */
  getFullLabel(record, schema) {
    return ColumnUtils.getFullLabel(record, schema);
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

    // Toggle back-reference table row expand/collapse
    this.container.querySelectorAll('[data-action="toggle-backref-row"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = el.closest('tr');
        const nodeId = row.dataset.nodeId;
        this.toggleNode(nodeId);
      });
    });

    // Context menu on root node headers (right-click for Edit/Delete)
    this.container.querySelectorAll('.root-node > .tree-node-header').forEach(header => {
      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const node = header.closest('.tree-node');
        const entityName = node.dataset.entity;
        const recordId = parseInt(node.dataset.recordId);
        ContextMenu.show(e.clientX, e.clientY, {
          entity: entityName,
          recordId: recordId,
          source: 'tree'
        });
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
   * Toggle node expansion with focused navigation
   * When closing a node, also close all child nodes (deeper levels)
   */
  toggleNode(nodeId) {
    if (this.expandedNodes.has(nodeId)) {
      // Closing: Remove this node and all descendants
      this.closeNodeAndDescendants(nodeId);
    } else {
      // Opening: Just add this node
      this.expandedNodes.add(nodeId);
    }
    this.render();
  },

  /**
   * Close a node and all its descendants (child expansions)
   * Uses expansion order tracking to determine hierarchy
   */
  closeNodeAndDescendants(nodeId) {
    // Remove the node itself
    this.expandedNodes.delete(nodeId);

    // For FK nodes: Close all FK/backref nodes that were opened "below" this one
    // Strategy: FK nodes have format "fk-Entity-ID-from-ParentID"
    // When closing an FK node, close all other FK nodes (they're deeper by definition)
    if (nodeId.startsWith('fk-') || nodeId.startsWith('backref-')) {
      // Close all other FK and backref nodes (except root nodes)
      const toRemove = [];
      for (const id of this.expandedNodes) {
        if (id.startsWith('fk-') || id.startsWith('backref-')) {
          toRemove.push(id);
        }
      }
      toRemove.forEach(id => this.expandedNodes.delete(id));
    }
  },

  /**
   * Select a node (toggle selection, no detail panel in tree view)
   */
  selectNode(nodeId, entityName, recordId) {
    // Toggle: clicking same node deselects it
    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = null;
      EntityExplorer.selectedId = null;
    } else {
      this.selectedNodeId = nodeId;
      EntityExplorer.selectedId = recordId;
    }
    // Hide detail panel when selecting in tree view (use edit button for details)
    DetailPanel.hide();
    this.render();
  },

  /**
   * Handle details action (read-only view)
   */
  onDetails(entityName, recordId) {
    const record = this.records.find(r => r.id === recordId);
    if (record) {
      DetailPanel.showRecord(entityName, record);
    }
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
