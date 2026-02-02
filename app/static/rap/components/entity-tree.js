/**
 * Entity Tree Component
 * Hierarchical tree structure for navigating entities and their relationships
 *
 * Uses modules:
 * - TreeState (entity-tree-state.js): State management (expanded nodes, selection)
 * - TreeRenderer (entity-tree-renderer.js): All render functions
 * - TreePdfExport (entity-tree-pdf.js): PDF export functionality
 */
const EntityTree = {
    container: null,
    currentEntity: null,
    records: [],
    state: null, // TreeState instance, initialized in init()

    // Sort settings
    attributeOrder: 'schema', // 'schema' or 'alpha'
    referencePosition: 'end', // 'end', 'start', or 'inline'
    attributeLayout: 'list', // 'row' (horizontal) or 'list' (vertical) - controlled by view mode buttons
    showCycles: false, // false = hide cycle nodes completely, true = show with cycle indicator (not expandable)

    // Config from server
    treeConfig: null, // { backRefPreviewLimit: 10 }

    init(containerId) {
        this.container = document.getElementById(containerId);
        this.state = new TreeState();
        this.initSortControls();
        this.loadTreeConfig();
    },

    /**
     * Load tree config from server
     */
    async loadTreeConfig() {
        if (this.treeConfig) return this.treeConfig;
        try {
            const resp = await fetch('/api/config/tree');
            if (resp.ok) {
                this.treeConfig = await resp.json();
            } else {
                this.treeConfig = { backRefPreviewLimit: 10 };
            }
        } catch (e) {
            this.treeConfig = { backRefPreviewLimit: 10 };
        }
        return this.treeConfig;
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

        // Cycle visibility toggle
        const cyclesToggle = document.getElementById('show-cycles-toggle');
        if (cyclesToggle) {
            // Restore from sessionStorage
            const savedCycles = sessionStorage.getItem('tree-show-cycles');
            if (savedCycles === 'true') {
                this.showCycles = true;
                cyclesToggle.checked = true;
            }

            cyclesToggle.addEventListener('change', (e) => {
                this.showCycles = e.target.checked;
                sessionStorage.setItem('tree-show-cycles', e.target.checked ? 'true' : 'false');
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
        this.state.clear();

        // If a selectedId is provided, pre-expand the node and its outbound FKs
        if (options.selectedId) {
            const nodeId = `${entityName}-${options.selectedId}`;
            this.state.setSelection(nodeId);
            this.state.expand(nodeId);

            // Pre-calculate outbound FK node IDs to expand
            const expandLevels = options.expandLevels || 1;
            if (expandLevels >= 1) {
                const record = records.find(r => r.id === options.selectedId);
                if (record) {
                    await this.expandFKLevels(entityName, record, expandLevels);
                }
            }
        }

        await this.render();

        // Scroll to selected node if exists
        if (options.selectedId) {
            const selectedNode = this.container.querySelector(`[data-node-id="${this.state.getSelectedNodeId()}"]`);
            if (selectedNode) {
                selectedNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    },

    /**
     * Recursively expand FK nodes and back-references to a given depth
     */
    async expandFKLevels(entityName, record, levelsRemaining, parentRecordId = null) {
        if (levelsRemaining <= 0) return;

        const schema = await SchemaCache.getExtended(entityName);

        // Expand outbound FK nodes
        for (const col of schema.columns) {
            if (col.foreignKey && record[col.name]) {
                const fkId = record[col.name];
                const fromId = parentRecordId || record.id;
                const fkNodeId = `fk-${col.foreignKey.entity}-${fkId}-from-${fromId}`;
                this.state.expand(fkNodeId);

                // If more levels to expand, load the FK record and recurse
                if (levelsRemaining > 1) {
                    try {
                        const fkRecord = await ApiClient.getById(col.foreignKey.entity, fkId);
                        if (fkRecord) {
                            await this.expandFKLevels(col.foreignKey.entity, fkRecord, levelsRemaining - 1, fkId);
                        }
                    } catch (e) {
                        // Ignore errors loading FK records
                    }
                }
            }
        }

        // Expand back-reference nodes (entities that reference this record)
        if (schema.backReferences && schema.backReferences.length > 0) {
            for (const ref of schema.backReferences) {
                const backrefNodeId = `backref-${ref.entity}-to-${entityName}-${record.id}`;
                this.state.expand(backrefNodeId);
            }
        }
    },

    /**
     * Build render context for renderer modules
     */
    getRenderContext() {
        return {
            state: this.state,
            attributeOrder: this.attributeOrder,
            referencePosition: this.referencePosition,
            attributeLayout: this.attributeLayout,
            showCycles: this.showCycles,
            showSystem: EntityTable.showSystem, // Shared with EntityTable
            backRefPreviewLimit: this.treeConfig?.backRefPreviewLimit || 10
        };
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
        const context = this.getRenderContext();

        let html = '<div class="entity-tree">';

        // If a record is selected, show only that record as root
        const selectedNodeId = this.state.getSelectedNodeId();
        if (selectedNodeId) {
            const selectedRecordId = parseInt(selectedNodeId.split('-').pop());
            const selectedRecord = this.records.find(r => r.id === selectedRecordId);
            if (selectedRecord) {
                html += await TreeRenderer.renderRootNode(this.currentEntity, selectedRecord, schema, context);
            }
        } else {
            // No selection: show all records
            for (const record of this.records) {
                html += await TreeRenderer.renderRootNode(this.currentEntity, record, schema, context);
            }
        }

        html += '</div>';
        this.container.innerHTML = html;

        this.attachEventListeners();
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
        this.state.toggleNode(nodeId);
        this.render();
    },

    /**
     * Select a node (toggle selection, no detail panel in tree view)
     */
    selectNode(nodeId, entityName, recordId) {
        const isSelected = this.state.selectNode(nodeId);

        if (isSelected) {
            EntityExplorer.selectedId = recordId;
        } else {
            EntityExplorer.selectedId = null;
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
            i18n.t('confirm_delete', { entity: entityName })
        );

        if (confirmed) {
            try {
                await ApiClient.delete(entityName, recordId);
                // Refresh via EntityExplorer
                await EntityExplorer.refresh();
            } catch (err) {
                alert(i18n.t('delete_failed', { message: err.message }));
            }
        }
    },

    /**
     * Handle navigation to another entity AND expand the target record
     * @param {string} entityName - Target entity name
     * @param {number} recordId - Target record ID
     * @param {Object} [options] - Options
     * @param {number} [options.expandLevels=0] - Number of FK levels to expand
     */
    async onNavigateAndExpand(entityName, recordId, options = {}) {
        const expandLevels = options.expandLevels || 0;

        // Remember current selection in breadcrumb before navigating
        if (typeof BreadcrumbNav !== 'undefined' && EntityExplorer.selectedId) {
            BreadcrumbNav.updateCurrentSelection(EntityExplorer.selectedId, EntityExplorer.viewMode);
        }

        // Get entity color for breadcrumb before switching
        const item = EntityExplorer.selectorMenu?.querySelector(`[data-value="${entityName}"]`);
        const color = item?.dataset.color || '#f5f5f5';

        // Switch to the target entity WITHOUT updating breadcrumb
        await EntityExplorer.selectEntityWithoutBreadcrumb(entityName);

        const nodeId = `${entityName}-${recordId}`;
        // Add to expanded nodes so it will be expanded when rendered
        this.state.clear();
        this.state.expand(nodeId);
        this.state.setSelection(nodeId);

        EntityExplorer.selectedId = recordId;
        const record = EntityExplorer.records.find(r => r.id === recordId);
        if (record) {
            // Push record crumb to breadcrumb trail
            if (typeof BreadcrumbNav !== 'undefined') {
                const schema = EntityExplorer.currentEntitySchema;
                const label = ColumnUtils.getRecordLabel(record, schema);
                BreadcrumbNav.push({
                    type: 'record',
                    entity: entityName,
                    recordId: recordId,
                    recordLabel: label.title,
                    viewMode: 'tree-h',
                    color: color
                });
            }

            DetailPanel.showRecord(entityName, record);

            // Expand FK levels if requested
            if (expandLevels > 0) {
                await this.expandFKLevels(entityName, record, expandLevels);
            }

            // Re-render tree to show expanded state
            this.currentEntity = entityName;
            this.records = EntityExplorer.records;
            this.render();
        }
    },

    /**
     * Export currently visible/expanded tree to PDF
     */
    async exportPdf() {
        return TreePdfExport.exportPdf({
            currentEntity: this.currentEntity,
            records: this.records,
            state: this.state,
            attributeLayout: this.attributeLayout,
            attributeOrder: this.attributeOrder,
            referencePosition: this.referencePosition,
            showCycles: this.showCycles
        });
    },

    /**
     * Export currently visible/expanded tree to DOCX (Word)
     */
    async exportDocx() {
        return TreePdfExport.exportDocx({
            currentEntity: this.currentEntity,
            records: this.records,
            state: this.state,
            attributeLayout: this.attributeLayout,
            attributeOrder: this.attributeOrder,
            referencePosition: this.referencePosition,
            showCycles: this.showCycles
        });
    }
};
