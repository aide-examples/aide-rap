/**
 * HierarchyTree - Hierarchical view for self-referential entities
 * Shows roots (parent=NULL) → children → grandchildren etc.
 *
 * Example: EngineType with super_type → EngineType
 * ▼ CFM56
 *   ├─ CFM56-5A
 *   ├─ CFM56-5B
 *   └─ CFM56-7B
 * ▼ GE90
 *   └─ GE90-115B
 */
const HierarchyTree = {
  container: null,
  currentEntity: null,
  selfRefFK: null,
  schema: null,
  state: null,  // TreeState for expansion tracking
  rootRecords: [],
  childrenCache: new Map(),  // parentId → children[]
  knownLeaves: new Set(),    // recordIds confirmed to have no children

  init(containerId) {
    this.container = document.getElementById(containerId);
    this.state = new TreeState();
  },

  async loadEntity(entityName, selfRefFK) {
    this.currentEntity = entityName;
    this.selfRefFK = selfRefFK;
    this.schema = await SchemaCache.getExtended(entityName);
    this.state.clear();
    this.childrenCache.clear();
    this.knownLeaves.clear();

    // Load root nodes (where self-ref FK is NULL)
    try {
      const result = await ApiClient.getHierarchyRoots(entityName);
      this.rootRecords = result.data || [];
    } catch (e) {
      console.error('Failed to load hierarchy roots:', e);
      this.rootRecords = [];
    }

    await this.render();
  },

  async getChildren(parentId) {
    if (this.childrenCache.has(parentId)) {
      return this.childrenCache.get(parentId);
    }

    try {
      const result = await ApiClient.getHierarchyChildren(this.currentEntity, parentId);
      const children = result.data || [];
      this.childrenCache.set(parentId, children);
      return children;
    } catch (e) {
      console.error('Failed to load hierarchy children:', e);
      return [];
    }
  },

  async render() {
    if (!this.container) return;

    if (this.rootRecords.length === 0) {
      this.container.innerHTML = `
        <div class="hierarchy-empty-state">
          <p>Keine Wurzelelemente gefunden</p>
          <p class="hierarchy-hint">Alle Records haben einen übergeordneten Eintrag</p>
        </div>
      `;
      return;
    }

    let html = '<div class="hierarchy-tree">';
    for (const record of this.rootRecords) {
      html += await this.renderNode(record, 0);
    }
    html += '</div>';

    this.container.innerHTML = html;
    this.attachEvents();
  },

  async renderNode(record, depth) {
    const nodeId = `hier-${this.currentEntity}-${record.id}`;
    const isExpanded = this.state.isExpanded(nodeId);
    const label = ColumnUtils.getRecordLabel(record, this.schema);
    const areaColor = this.schema.areaColor || '#e5e7eb';

    // Check if node has potential children (we'll know for sure when expanded)
    // knownLeaves contains IDs of nodes we've verified have no children
    const hasChildren = !this.knownLeaves.has(record.id) &&
                        (!this.childrenCache.has(record.id) ||
                         this.childrenCache.get(record.id).length > 0);

    let html = `
      <div class="hierarchy-node" data-node-id="${nodeId}" data-record-id="${record.id}">
        <div class="hierarchy-header" style="padding-left: ${depth * 24}px">
          <span class="hierarchy-toggle ${hasChildren ? '' : 'hierarchy-no-children'}" data-action="toggle"
                title="${i18n.t('hierarchy_toggle_tooltip')}">
            ${isExpanded ? '▼' : '▶'}
          </span>
          <span class="hierarchy-color" style="background: ${areaColor}"></span>
          <span class="hierarchy-label" data-action="select">${DomUtils.escapeHtml(label.title)}</span>
          ${label.subtitle && label.subtitle !== label.title ? `<span class="hierarchy-subtitle">${DomUtils.escapeHtml(label.subtitle)}</span>` : ''}
          <span class="hierarchy-navigate" data-action="navigate" title="${i18n.t('hierarchy_open_tree')}">→</span>
        </div>
    `;

    if (isExpanded && !this.knownLeaves.has(record.id)) {
      const children = await this.getChildren(record.id);
      if (children.length > 0) {
        html += '<div class="hierarchy-children">';
        for (const child of children) {
          html += await this.renderNode(child, depth + 1);
        }
        html += '</div>';
      }
      // No children: triangle removal happens in click handler with brief feedback
    }

    html += '</div>';
    return html;
  },

  attachEvents() {
    // Toggle expand/collapse (Shift+Click = expand entire subtree)
    this.container.querySelectorAll('[data-action="toggle"]').forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const node = el.closest('.hierarchy-node');
        const nodeId = node.dataset.nodeId;
        const recordId = parseInt(node.dataset.recordId);

        if (e.shiftKey && !this.state.isExpanded(nodeId)) {
          // Shift+Click: expand entire subtree recursively
          await this.expandSubtree(recordId);
          await this.render();
        } else {
          // Normal click: toggle single node
          const wasExpanded = this.state.isExpanded(nodeId);
          this.state.toggleNode(nodeId);

          if (!wasExpanded) {
            // Expanding: check if node has children
            const children = await this.getChildren(recordId);
            if (children.length === 0) {
              // No children: show brief feedback, then mark as leaf
              el.classList.add('hierarchy-leaf-feedback');
              el.textContent = '○';  // Brief visual indicator
              await new Promise(resolve => setTimeout(resolve, 800));
              this.knownLeaves.add(recordId);
              this.state.collapse(nodeId);  // Don't keep expanded state for leaf
            }
          }
          await this.render();
        }
      };
    });

    // Select record (open in detail panel)
    this.container.querySelectorAll('[data-action="select"]').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const node = el.closest('.hierarchy-node');
        const recordId = parseInt(node.dataset.recordId);
        this.selectRecord(recordId);
      };
    });

    // Navigate to tree view with this record expanded
    this.container.querySelectorAll('[data-action="navigate"]').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const node = el.closest('.hierarchy-node');
        const recordId = parseInt(node.dataset.recordId);
        this.navigateToTreeView(recordId);
      };
    });

    // Double-click to expand and select
    this.container.querySelectorAll('.hierarchy-header').forEach(el => {
      el.ondblclick = async (e) => {
        e.stopPropagation();
        const node = el.closest('.hierarchy-node');
        const nodeId = node.dataset.nodeId;
        const recordId = parseInt(node.dataset.recordId);

        // Expand if not already
        if (!this.state.isExpanded(nodeId)) {
          this.state.expand(nodeId);
          await this.render();
        }

        this.selectRecord(recordId);
      };
    });
  },

  selectRecord(recordId) {
    // Find record in cache (roots or children)
    let record = this.rootRecords.find(r => r.id === recordId);
    if (!record) {
      for (const children of this.childrenCache.values()) {
        record = children.find(r => r.id === recordId);
        if (record) break;
      }
    }

    if (record) {
      // Highlight selected node
      this.container.querySelectorAll('.hierarchy-header').forEach(h =>
        h.classList.remove('hierarchy-selected')
      );
      const selectedNode = this.container.querySelector(`[data-record-id="${recordId}"] > .hierarchy-header`);
      selectedNode?.classList.add('hierarchy-selected');

      // Open in detail panel
      EntityExplorer.selectedId = recordId;
      if (typeof DetailPanel !== 'undefined') {
        DetailPanel.showRecord(this.currentEntity, record);
      }
    }
  },

  /**
   * Navigate to standard tree view with this record selected and expanded
   * This is a "breadcrumb step" that shows the record in full tree context
   */
  navigateToTreeView(recordId) {
    // Find record in cache
    let record = this.rootRecords.find(r => r.id === recordId);
    if (!record) {
      for (const children of this.childrenCache.values()) {
        record = children.find(r => r.id === recordId);
        if (record) break;
      }
    }

    if (record) {
      // Get record label for breadcrumb
      const label = ColumnUtils.getRecordLabel(record, this.schema);

      // Update current crumb to save hierarchy state before navigating
      if (typeof BreadcrumbNav !== 'undefined') {
        BreadcrumbNav.updateCurrentSelection(null, 'hierarchy');
        const currentCrumb = BreadcrumbNav.getCurrent();
        if (currentCrumb) {
          // Save expanded nodes so we can restore them when navigating back
          currentCrumb.hierarchyState = this.getExpandedState();
        }

        // Push new breadcrumb for the tree-v navigation
        BreadcrumbNav.push({
          type: 'record',
          entity: this.currentEntity,
          recordId: recordId,
          recordLabel: label.title,
          viewMode: 'tree-v',
          color: this.schema.areaColor || '#f5f5f5'
        });
      }

      // Set selected record and switch to tree view
      EntityExplorer.selectedId = recordId;
      EntityExplorer.records = [record]; // Show just this record in tree view
      EntityExplorer.setViewMode('tree-v');

      // The tree view will auto-expand the selected record with 1 level of FKs
      EntityTree.loadEntity(this.currentEntity, [record], {
        selectedId: recordId,
        expandLevels: 1
      });
    }
  },

  /**
   * Expand entire subtree starting from a record (Shift+Click)
   * Recursively loads and expands all descendants
   */
  async expandSubtree(recordId, maxDepth = 10) {
    const expandRecursive = async (id, depth) => {
      if (depth >= maxDepth) return; // Safety limit

      const nodeId = `hier-${this.currentEntity}-${id}`;
      this.state.expand(nodeId);

      const children = await this.getChildren(id);
      for (const child of children) {
        await expandRecursive(child.id, depth + 1);
      }
    };

    await expandRecursive(recordId, 0);
  },

  /**
   * Expand all nodes up to a certain depth
   */
  async expandToDepth(maxDepth) {
    const expandRecursive = async (records, depth) => {
      if (depth >= maxDepth) return;

      for (const record of records) {
        const nodeId = `hier-${this.currentEntity}-${record.id}`;
        this.state.expand(nodeId);
        const children = await this.getChildren(record.id);
        if (children.length > 0) {
          await expandRecursive(children, depth + 1);
        }
      }
    };

    await expandRecursive(this.rootRecords, 0);
    await this.render();
  },

  /**
   * Collapse all nodes
   */
  collapseAll() {
    this.state.clear();
    this.render();
  },

  /**
   * Find and expand path to a specific record
   */
  async expandToRecord(recordId) {
    // Build path from root to record by checking parent chain
    const path = [];
    let currentId = recordId;

    // We need to find the parent chain - this requires fetching the record
    // For now, just expand all roots and search
    for (const root of this.rootRecords) {
      const nodeId = `hier-${this.currentEntity}-${root.id}`;
      this.state.expand(nodeId);
    }

    await this.render();
    this.selectRecord(recordId);
  },

  /**
   * Get current expanded state for breadcrumb storage
   * @returns {Object} State object with expandedNodes array
   */
  getExpandedState() {
    return {
      expandedNodes: Array.from(this.state.expandedNodes)
    };
  },

  /**
   * Restore expanded state from breadcrumb
   * @param {Object} savedState - State object with expandedNodes array
   */
  restoreExpandedState(savedState) {
    if (savedState?.expandedNodes) {
      this.state.clear();
      for (const nodeId of savedState.expandedNodes) {
        this.state.expand(nodeId);
      }
    }
  }
};
