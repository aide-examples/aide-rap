/**
 * Entity Tree PDF Export
 * Handles PDF export functionality for the tree view
 */

const TreePdfExport = {
    /**
     * Export currently visible/expanded tree to PDF (hierarchical format)
     * Uses typed nodes with colors for visual hierarchy
     * @param {Object} treeContext - The EntityTree context with state and data
     */
    async exportPdf(treeContext) {
        const { currentEntity, records, state, attributeLayout, attributeOrder, referencePosition, showCycles } = treeContext;

        if (!currentEntity || !records.length) {
            return;
        }

        const schema = await SchemaCache.getExtended(currentEntity);
        const nodes = [];

        // Build context for collection functions
        const context = {
            state,
            attributeLayout,
            attributeOrder,
            referencePosition,
            showCycles,
            currentEntity,
            records
        };

        // Collect visible data as typed nodes
        await this.collectTreeNodes(nodes, schema, context);

        if (nodes.length === 0) {
            alert(i18n.t('no_data_to_export'));
            return;
        }

        const entityColor = schema.areaColor || '#1a365d';

        try {
            const response = await fetch(`/api/entities/${currentEntity}/export-tree-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `${currentEntity} (Tree View)`,
                    nodes,
                    entityColor,
                    layout: attributeLayout  // 'row' or 'list'
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${currentEntity}_tree.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                const error = await response.json();
                alert(i18n.t('export_failed', { message: error.error || 'Unknown error' }));
            }
        } catch (err) {
            alert(i18n.t('export_failed', { message: err.message }));
        }
    },

    /**
     * Export currently visible/expanded tree to DOCX (Word) format
     * Uses typed nodes with colors for visual hierarchy
     * @param {Object} treeContext - The EntityTree context with state and data
     */
    async exportDocx(treeContext) {
        const { currentEntity, records, state, attributeLayout, attributeOrder, referencePosition, showCycles } = treeContext;

        if (!currentEntity || !records.length) {
            return;
        }

        const schema = await SchemaCache.getExtended(currentEntity);
        const nodes = [];

        // Build context for collection functions
        const context = {
            state,
            attributeLayout,
            attributeOrder,
            referencePosition,
            showCycles,
            currentEntity,
            records
        };

        // Collect visible data as typed nodes (reuses PDF collection logic)
        await this.collectTreeNodes(nodes, schema, context);

        if (nodes.length === 0) {
            alert(i18n.t('no_data_to_export'));
            return;
        }

        const entityColor = schema.areaColor || '#1a365d';

        try {
            const response = await fetch(`/api/entities/${currentEntity}/export-tree-docx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `${currentEntity} (Tree View)`,
                    nodes,
                    entityColor,
                    layout: attributeLayout  // 'row' or 'list'
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${currentEntity}_tree.docx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                const error = await response.json();
                alert(i18n.t('export_failed', { message: error.error || 'Unknown error' }));
            }
        } catch (err) {
            alert(i18n.t('export_failed', { message: err.message }));
        }
    },

    /**
     * Collect tree nodes with types and colors for hierarchical PDF
     */
    async collectTreeNodes(nodes, schema, context) {
        const { state, currentEntity, records } = context;

        let recordsToProcess = [];
        const selectedNodeId = state.getSelectedNodeId();

        if (selectedNodeId) {
            const selectedRecordId = parseInt(selectedNodeId.split('-').pop());
            const selectedRecord = records.find(r => r.id === selectedRecordId);
            if (selectedRecord) {
                recordsToProcess = [selectedRecord];
            }
        } else {
            recordsToProcess = records;
        }

        for (const record of recordsToProcess) {
            const nodeId = `${currentEntity}-${record.id}`;
            const isExpanded = state.isExpanded(nodeId);
            const label = ColumnUtils.getRecordLabel(record, schema);
            const labelText = label.subtitle ? `${label.title} (${label.subtitle})` : label.title;

            // Root node
            nodes.push({
                type: 'root',
                depth: 0,
                label: currentEntity,
                value: labelText,
                color: schema.areaColor || '#e2e8f0'
            });

            if (isExpanded) {
                const visitedPath = new Set([`${currentEntity}-${record.id}`]);
                await this.collectNodeContent(nodes, currentEntity, record, schema, 1, visitedPath, context);
            }
        }
    },

    /**
     * Collect content nodes (attributes, FKs, back-refs) with proper types
     */
    async collectNodeContent(nodes, entityName, record, schema, depth, visitedPath, context) {
        const { attributeOrder, referencePosition, attributeLayout } = context;

        let columns = schema.columns.filter(col => !schema.ui?.hiddenFields?.includes(col.name));
        if (attributeOrder === 'alpha') {
            columns = [...columns].sort((a, b) => a.name.localeCompare(b.name));
        }

        const regularCols = columns.filter(col => !col.foreignKey);
        const fkCols = columns.filter(col => col.foreignKey);
        const hasBackRefs = schema.backReferences && schema.backReferences.length > 0;

        if (referencePosition === 'start') {
            await this.collectFkNodes(nodes, fkCols, record, depth, visitedPath, context);
            if (hasBackRefs) {
                await this.collectBackRefNodes(nodes, entityName, record.id, schema.backReferences, depth, visitedPath, context);
            }
            this.collectAttributeNodes(nodes, regularCols, record, schema, depth, context);
        } else if (referencePosition === 'inline') {
            if (attributeLayout === 'row') {
                // Row layout: Attributes first (one row), then FKs, then back-refs
                this.collectAttributeNodes(nodes, regularCols, record, schema, depth, context);
                await this.collectFkNodes(nodes, fkCols, record, depth, visitedPath, context);
                if (hasBackRefs) {
                    await this.collectBackRefNodes(nodes, entityName, record.id, schema.backReferences, depth, visitedPath, context);
                }
            } else {
                // List layout: original inline behavior (FKs interspersed with attributes)
                for (const col of columns) {
                    if (col.foreignKey) {
                        await this.collectFkNodes(nodes, [col], record, depth, visitedPath, context);
                    } else {
                        this.collectAttributeNodes(nodes, [col], record, schema, depth, context);
                    }
                }
                if (hasBackRefs) {
                    await this.collectBackRefNodes(nodes, entityName, record.id, schema.backReferences, depth, visitedPath, context);
                }
            }
        } else {
            this.collectAttributeNodes(nodes, regularCols, record, schema, depth, context);
            await this.collectFkNodes(nodes, fkCols, record, depth, visitedPath, context);
            if (hasBackRefs) {
                await this.collectBackRefNodes(nodes, entityName, record.id, schema.backReferences, depth, visitedPath, context);
            }
        }
    },

    /**
     * Collect attribute nodes
     * In 'row' layout: creates single 'attribute-row' node with all columns
     * In 'list' layout: creates individual 'attribute' nodes
     */
    collectAttributeNodes(nodes, columns, record, schema, depth, context) {
        if (columns.length === 0) return;

        if (context.attributeLayout === 'row') {
            // Horizontal layout: single row with all attributes
            const tableColumns = [];
            const tableValues = [];

            for (const col of columns) {
                const value = record[col.name];
                let displayValue;
                if (value === null || value === undefined) {
                    displayValue = '—';
                } else {
                    displayValue = ValueFormatter.format(value, col.name, schema);
                }
                tableColumns.push(col.name.replace(/_/g, ' '));
                tableValues.push(displayValue);
            }

            nodes.push({
                type: 'attribute-row',
                depth,
                columns: tableColumns,
                values: tableValues
            });
        } else {
            // Vertical layout: individual attribute nodes
            for (const col of columns) {
                const value = record[col.name];
                let displayValue;
                if (value === null || value === undefined) {
                    displayValue = '—';
                } else {
                    displayValue = ValueFormatter.format(value, col.name, schema);
                }
                nodes.push({
                    type: 'attribute',
                    depth,
                    label: col.name.replace(/_/g, ' '),
                    value: displayValue
                });
            }
        }
    },

    /**
     * Collect FK nodes with target entity color
     */
    async collectFkNodes(nodes, fkCols, parentRecord, depth, visitedPath, context) {
        const { state, showCycles } = context;

        for (const col of fkCols) {
            const fkId = parentRecord[col.name];
            const displayName = col.name.endsWith('_id') ? col.name.slice(0, -3) : col.name;

            if (!fkId) {
                nodes.push({
                    type: 'attribute',
                    depth,
                    label: displayName.replace(/_/g, ' '),
                    value: '—'
                });
                continue;
            }

            const targetEntity = col.foreignKey.entity;
            const pairKey = `${targetEntity}-${fkId}`;
            const isCycle = visitedPath.has(pairKey);
            const nodeId = `fk-${targetEntity}-${fkId}-from-${parentRecord.id}`;
            const isExpanded = !isCycle && state.isExpanded(nodeId);

            // Get label and color
            const labelField = displayName + '_label';
            let refLabel = parentRecord[labelField] || `#${fkId}`;
            let fkColor = col.foreignKey.areaColor || '#e2e8f0';

            if (isCycle) {
                // Skip cycle nodes in PDF when showCycles is false
                if (!showCycles) {
                    continue;
                }
                nodes.push({
                    type: 'fk',
                    depth,
                    label: `${displayName.replace(/_/g, ' ')} (cycle)`,
                    value: refLabel,
                    color: fkColor
                });
            } else {
                nodes.push({
                    type: 'fk',
                    depth,
                    label: displayName.replace(/_/g, ' '),
                    value: refLabel,
                    color: fkColor
                });

                if (isExpanded) {
                    try {
                        const refSchema = await SchemaCache.getExtended(targetEntity);
                        const refRecord = await ApiClient.getById(targetEntity, fkId);
                        const newPath = new Set([...visitedPath, pairKey]);

                        // Add section header for expanded FK
                        nodes.push({
                            type: 'section',
                            depth: depth + 1,
                            label: targetEntity,
                            value: refLabel,
                            color: refSchema.areaColor || '#e2e8f0'
                        });

                        await this.collectNodeContent(nodes, targetEntity, refRecord, refSchema, depth + 2, newPath, context);
                    } catch (e) {
                        // Ignore
                    }
                }
            }
        }
    },

    /**
     * Collect back-reference nodes with entity color
     */
    async collectBackRefNodes(nodes, entityName, recordId, backRefs, depth, visitedPath, context) {
        const { state, showCycles } = context;

        for (const ref of backRefs) {
            const nodeId = `backref-${ref.entity}-${ref.column}-to-${entityName}-${recordId}`;
            const isExpanded = state.isExpanded(nodeId);

            let count = 0;
            let refRecords = [];
            try {
                const references = await ApiClient.getBackReferences(entityName, recordId);
                const refKey = `${ref.entity}:${ref.column}`;
                if (references[refKey]) {
                    count = references[refKey].count;
                    refRecords = references[refKey].records || [];
                }
            } catch (e) {
                // Ignore
            }

            if (count === 0) continue;

            const refColor = ref.areaColor || '#e2e8f0';

            // Show FK attribute name only when semantically relevant
            const displayName = ref.column.replace(/_id$/, '');
            const targetSnake = entityName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
            const backRefLabel = targetSnake.endsWith(displayName)
                ? ref.entity
                : `is ${displayName} of ${ref.entity}`;

            nodes.push({
                type: 'backref',
                depth,
                label: backRefLabel,
                value: `${count} record${count !== 1 ? 's' : ''}`,
                color: refColor
            });

            if (isExpanded && refRecords.length > 0) {
                const refSchema = await SchemaCache.getExtended(ref.entity);

                for (const refRecord of refRecords) {
                    const rowNodeId = `backref-row-${ref.entity}-${refRecord.id}-in-${entityName}-${recordId}`;
                    const rowPairKey = `${ref.entity}-${refRecord.id}`;
                    const isCycle = visitedPath.has(rowPairKey);
                    const isRowExpanded = !isCycle && state.isExpanded(rowNodeId);

                    const label = ColumnUtils.getRecordLabel(refRecord, refSchema);
                    const labelText = label.subtitle ? `${label.title} (${label.subtitle})` : label.title;

                    if (isCycle) {
                        // Skip cycle rows in PDF when showCycles is false
                        if (!showCycles) {
                            continue;
                        }
                        nodes.push({
                            type: 'backref-item',
                            depth: depth + 1,
                            label: `${ref.entity} (cycle)`,
                            value: labelText,
                            color: refColor
                        });
                    } else {
                        nodes.push({
                            type: 'backref-item',
                            depth: depth + 1,
                            label: ref.entity,
                            value: labelText,
                            color: refColor
                        });

                        if (isRowExpanded) {
                            const newPath = new Set([...visitedPath, rowPairKey]);
                            await this.collectNodeContent(nodes, ref.entity, refRecord, refSchema, depth + 2, newPath, context);
                        }
                    }
                }
            }
        }
    }
};

// Make available globally
window.TreePdfExport = TreePdfExport;
