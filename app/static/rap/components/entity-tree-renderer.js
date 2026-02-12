/**
 * Entity Tree Renderer
 * Handles all tree node rendering functions
 */

const TreeRenderer = {
    /**
     * Render a root-level node (entity record from the main list)
     * @param {Object} context - Render context with state and settings
     */
    async renderRootNode(entityName, record, schema, context) {
        const nodeId = `${entityName}-${record.id}`;
        const isExpanded = context.state.isExpanded(nodeId);
        const isSelected = context.state.getSelectedNodeId() === nodeId;
        const label = ColumnUtils.getRecordLabel(record, schema);
        const areaColor = schema.areaColor || '#f5f5f5';

        let html = `
          <div class="tree-node root-node ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}"
               data-node-id="${nodeId}"
               data-entity="${entityName}"
               data-record-id="${record.id}">
            <div class="tree-node-header" data-action="toggle" style="background-color: ${areaColor};">
              <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
              <span class="tree-node-label">${DomUtils.escapeHtml(label.title)}</span>
              ${label.subtitle ? `<span class="tree-node-subtitle">${DomUtils.escapeHtml(label.subtitle)}</span>` : ''}
            </div>
        `;

        if (isExpanded) {
            // Initialize visited path with root entity for cycle detection
            const visitedPath = new Set([`${entityName}-${record.id}`]);
            if (context.detailTemplate) {
                html += await this.renderDetailNodeContent(entityName, record, schema, visitedPath, context, {
                    attributes: context.detailTemplate.rootAttributes,
                    children: context.detailTemplate.children
                });
            } else {
                html += await this.renderNodeContent(entityName, record, schema, visitedPath, context);
            }
        }

        html += '</div>';
        return html;
    },

    /**
     * Render the expanded content of a node (attributes + relationships)
     * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
     * @param {Object} context - Render context with state and settings
     */
    async renderNodeContent(entityName, record, schema, visitedPath, context) {
        const isRowLayout = context.attributeLayout === 'row';
        let html = `<div class="tree-node-content ${isRowLayout ? 'layout-row' : 'layout-list'}">`;

        // Separate columns into regular attributes, outbound FKs, and prepare back-references
        // Use ColumnUtils to filter hidden and system columns
        let columns = ColumnUtils.getVisibleColumns(schema, context.showSystem);

        // Sort columns if needed
        if (context.attributeOrder === 'alpha') {
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
        if (context.referencePosition === 'start') {
            // FKs first, then back-refs, then regular attributes
            for (const col of fkCols) {
                html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context);
            }
            if (hasBackRefs) {
                html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath, context);
            }
            if (!isRowLayout) {
                for (const col of regularCols) {
                    html += this.renderAttribute(col, record[col.name], schema);
                }
            }
        } else if (context.referencePosition === 'inline') {
            // Mixed: regular attrs, then FKs inline, then back-refs at end
            for (const col of columns) {
                const value = record[col.name];
                if (col.foreignKey) {
                    html += await this.renderForeignKeyNode(col, value, record, visitedPath, context);
                } else if (!isRowLayout) {
                    html += this.renderAttribute(col, value, schema);
                }
            }
            if (hasBackRefs) {
                html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath, context);
            }
        } else {
            // 'end' (default): regular attributes first, then FKs, then back-refs
            if (!isRowLayout) {
                for (const col of regularCols) {
                    html += this.renderAttribute(col, record[col.name], schema);
                }
            }
            for (const col of fkCols) {
                html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context);
            }
            if (hasBackRefs) {
                html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath, context);
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
            const displayValue = ValueFormatter.formatDisplayHtml(value, col, schema);
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
     * Uses ValueFormatter.formatDisplayHtml for special types (media, url, json, enum)
     */
    renderAttribute(col, value, schema = null) {
        const displayValue = ValueFormatter.formatDisplayHtml(value, col, schema);
        const name = col.name || col;

        return `
          <div class="tree-attribute">
            <span class="attr-name">${String(name).replace(/_/g, ' ')}:</span>
            <span class="attr-value">${displayValue}</span>
          </div>
        `;
    },

    /**
     * Render a foreign key as an expandable node with cycle detection
     * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
     * @param {Object} context - Render context with state and settings
     */
    async renderForeignKeyNode(col, fkId, parentRecord, visitedPath, context, templateChild = null) {
        const displayName = col.name.endsWith('_id')
            ? col.name.slice(0, -3)  // type_id -> type
            : col.name;

        if (!fkId) {
            if (!context.showNullFKs) return '';
            return `
            <div class="tree-attribute fk-field">
              <span class="attr-name">${displayName}:</span>
              <span class="attr-value"></span>
            </div>
          `;
        }

        const targetEntity = col.foreignKey.entity;
        const pairKey = `${targetEntity}-${fkId}`;
        const isCycle = visitedPath.has(pairKey);

        const nodeId = `fk-${targetEntity}-${fkId}-from-${parentRecord.id}`;
        const isExpanded = !isCycle && (context.state.isExpanded(nodeId) || templateChild != null);
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
                refLabel = ColumnUtils.getFullLabel(refRecord, refSchema);
            }
        } catch (e) {
            // Fall back to just the ID or preloaded label
        }

        // Cycle detected: hide completely or render as non-expandable link with visual marker
        if (isCycle) {
            if (!context.showCycles) {
                return ''; // Hide cycle nodes when showCycles is false
            }
            return `
            <div class="tree-fk-node cycle-detected"
                 data-entity="${targetEntity}"
                 data-record-id="${fkId}">
              <div class="tree-fk-header disabled" style="background-color: ${areaColor};">
                <span class="cycle-icon" title="${i18n.t('tooltip_cycle_detected')}">&#8635;</span>
                <span class="attr-name">${displayName}:</span>
                <span class="fk-label">${DomUtils.escapeHtml(refLabel)}</span>
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
              <span class="attr-name">${displayName}:</span>
              <span class="fk-label">${DomUtils.escapeHtml(refLabel)}</span>
              <span class="fk-entity-link" data-action="navigate-entity" data-entity="${targetEntity}" data-id="${fkId}">(${targetEntity})</span>
            </div>
        `;

        if (isExpanded) {
            // Extend path with current entity-id pair
            const newPath = new Set([...visitedPath, pairKey]);
            html += await this.renderExpandedForeignKey(targetEntity, fkId, newPath, context, templateChild);
        }

        html += '</div>';
        return html;
    },

    /**
     * Render the expanded content of a foreign key reference
     * Now supports recursive expansion and back-references at any depth
     * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
     * @param {Object} context - Render context with state and settings
     */
    async renderExpandedForeignKey(entityName, id, visitedPath, context, templateChild = null) {
        try {
            const schema = await SchemaCache.getExtended(entityName);
            const record = await ApiClient.getById(entityName, id);

            // Template mode: render only template-specified content
            if (templateChild) {
                return '<div class="tree-fk-content">' +
                    await this.renderDetailNodeContent(entityName, record, schema, visitedPath, context, templateChild) +
                    '</div>';
            }

            const isRowLayout = context.attributeLayout === 'row';
            let html = '<div class="tree-fk-content">';

            // Separate regular columns and FK columns
            const allCols = ColumnUtils.getVisibleColumns(schema, context.showSystem);
            const regularCols = allCols.filter(col => !col.foreignKey);
            const fkCols = allCols.filter(col => col.foreignKey && record[col.name]);

            // Render regular attributes (as row or list)
            if (isRowLayout && regularCols.length > 0) {
                html += this.renderAttributeRow(regularCols, record, schema);
            } else {
                for (const col of regularCols) {
                    html += this.renderAttribute(col, record[col.name], schema);
                }
            }

            // Render FKs RECURSIVELY (expandable, with cycle detection)
            for (const col of fkCols) {
                html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context);
            }

            // Back-references also at this level
            if (schema.backReferences && schema.backReferences.length > 0) {
                html += await this.renderBackReferences(entityName, id, schema.backReferences, visitedPath, context);
            }

            html += '</div>';
            return html;
        } catch (e) {
            return `<div class="tree-error">Failed to load: ${e.message}</div>`;
        }
    },

    /**
     * Build back-reference label, showing FK attribute name only when semantically relevant.
     * Trivial: "Aircraft [5]" — Semantic: "is parent_type of EngineType [3]"
     */
    _backRefLabel(ref, targetEntity) {
        const displayName = ref.column.replace(/_id$/, '');
        const targetSnake = targetEntity.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        if (targetSnake.endsWith(displayName)) return ref.entity;
        return `is ${displayName} of ${ref.entity}`;
    },

    /**
     * Render back-references (entities that point to this record)
     * @param {Set} visitedPath - Set of visited entity-id pairs for cycle detection
     * @param {Object} context - Render context with state and settings
     */
    async renderBackReferences(entityName, recordId, backRefs, visitedPath, context) {
        let html = '';

        for (const ref of backRefs) {
            const nodeId = `backref-${ref.entity}-${ref.column}-to-${entityName}-${recordId}`;
            const isExpanded = context.state.isExpanded(nodeId);

            // Get count of referencing records (key includes column for multi-FK support)
            let count = 0;
            try {
                const references = await ApiClient.getBackReferences(entityName, recordId);
                const refKey = `${ref.entity}:${ref.column}`;
                if (references[refKey]) {
                    count = references[refKey].count;
                }
            } catch (e) {
                // Ignore errors
            }

            // Use area color from back-reference metadata (already included in schema)
            const areaColor = ref.areaColor || '#f5f5f5';

            if (count === 0) continue;

            // Determine if we're showing a limited preview
            const limit = context.backRefPreviewLimit || 10;
            const isLimited = count > limit;
            const displayCount = isLimited ? `${limit} of ${count}` : `${count}`;

            // Show navigate arrow when there are more records than the preview limit
            const navigateArrow = isLimited
                ? ` <span class="backref-navigate" data-action="navigate-backref" data-entity="${ref.entity}" data-column="${ref.column}" data-parent-entity="${entityName}" data-parent-id="${recordId}" title="Show all ${count} records in table view">&#10140;</span>`
                : '';

            html += `
            <div class="tree-backref-node ${isExpanded ? 'expanded' : ''}"
                 data-node-id="${nodeId}"
                 data-ref-entity="${ref.entity}"
                 data-ref-column="${ref.column}"
                 data-parent-entity="${entityName}"
                 data-parent-id="${recordId}"
                 data-total-count="${count}">
              <div class="tree-backref-header" data-action="toggle-backref" style="background-color: ${areaColor};">
                <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
                <span class="backref-label">${this._backRefLabel(ref, entityName)} [${displayCount}]</span>${navigateArrow}
              </div>
          `;

            if (isExpanded) {
                html += await this.renderExpandedBackReferences(entityName, recordId, ref.entity, ref.column, visitedPath, context);
            }

            html += '</div>';
        }

        return html;
    },

    /**
     * Render expanded back-reference list as a table
     * @param {Set} visitedPath - Set of visited entity-id pairs (for future use)
     * @param {Object} context - Render context with state and settings
     */
    async renderExpandedBackReferences(entityName, recordId, refEntity, refColumn, visitedPath, context) {
        try {
            const references = await ApiClient.getBackReferences(entityName, recordId);
            const refData = references[`${refEntity}:${refColumn}`];

            if (!refData || refData.records.length === 0) {
                return '<div class="tree-backref-content"><em>No references</em></div>';
            }

            const schema = await SchemaCache.getExtended(refEntity);
            const areaColor = schema.areaColor || '#f5f5f5';

            // Apply preview limit
            const limit = context.backRefPreviewLimit || 10;
            const totalCount = refData.records.length;
            const isLimited = totalCount > limit;
            const displayRecords = isLimited ? refData.records.slice(0, limit) : refData.records;

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
            for (const record of displayRecords) {
                const rowNodeId = `backref-row-${refEntity}-${record.id}-in-${entityName}-${recordId}`;
                const rowPairKey = `${refEntity}-${record.id}`;
                const isCycle = visitedPath.has(rowPairKey);
                const isRowExpanded = !isCycle && context.state.isExpanded(rowNodeId);

                // Skip cycle rows when showCycles is false
                if (isCycle && !context.showCycles) {
                    continue;
                }

                const cells = displayCols.map(col => {
                    const value = record[col.name];
                    let displayValue;
                    if (value === null || value === undefined) {
                        displayValue = '';
                    } else {
                        displayValue = DomUtils.escapeHtml(ValueFormatter.format(value, col.name, schema));
                    }
                    return `<td title="${col.name}">${displayValue}</td>`;
                }).join('');

                // Render expand cell: cycle icon if cycle, otherwise triangle
                let expandCell;
                if (isCycle) {
                    expandCell = `
                <td class="expand-cell cycle-cell" title="${i18n.t('tooltip_cycle_detected')}">
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
                    const expandedContent = await this.renderBackRefRowContent(refEntity, record, schema, newPath, context);
                    rowsHtml += `
                <tr class="backref-row-content">
                  <td colspan="${colSpan}" style="background-color: ${areaColor};">
                    ${expandedContent}
                  </td>
                </tr>
              `;
                }
            }

            // Add clickable "more..." link if limited (navigates to full table view)
            const moreIndicator = isLimited
                ? `<div class="backref-more-indicator"><span class="backref-more-link" data-action="navigate-backref" data-entity="${refEntity}" data-column="${refColumn}" data-parent-entity="${entityName}" data-parent-id="${recordId}">${totalCount - limit} more... &#10140;</span></div>`
                : '';

            return `
            <div class="tree-backref-content">
              <table class="tree-backref-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${rowsHtml}</tbody>
              </table>
              ${moreIndicator}
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
     * @param {Object} context - Render context with state and settings
     */
    async renderBackRefRowContent(entityName, record, schema, visitedPath, context) {
        let html = '<div class="backref-row-expanded">';

        // Get FK columns that have values (respecting hidden and system column settings)
        const visibleCols = ColumnUtils.getVisibleColumns(schema, context.showSystem);
        const fkCols = visibleCols.filter(col => col.foreignKey && record[col.name]);

        // Render FKs recursively
        for (const col of fkCols) {
            html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context);
        }

        // Back-references of this record
        if (schema.backReferences && schema.backReferences.length > 0) {
            html += await this.renderBackReferences(entityName, record.id, schema.backReferences, visitedPath, context);
        }

        // If no FKs and no back-refs, show a message
        if (fkCols.length === 0 && (!schema.backReferences || schema.backReferences.length === 0)) {
            html += '<em class="no-relations">No relations</em>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Render template-driven content for a detail view node.
     * Only shows attributes and children specified in the template.
     */
    async renderDetailNodeContent(entityName, record, schema, visitedPath, context, templateNode) {
        let html = '<div class="tree-node-content layout-row">';

        // Render template-specified attributes as a compact row
        const attributes = templateNode.attributes;
        if (attributes && attributes.length > 0) {
            html += this.renderDetailAttributeRow(attributes, record, schema);
        }

        // Render children in template order (FKs and back-refs intermixed)
        for (const child of (templateNode.children || [])) {
            if (child.type === 'fk') {
                const col = schema.columns.find(c =>
                    c.foreignKey && (c.name === child.field || c.name === child.field + '_id')
                );
                if (col) {
                    html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context, child);
                }
            } else if (child.type === 'backref') {
                html += await this.renderDetailBackReference(entityName, record.id, child, schema, visitedPath, context);
            }
        }

        html += '</div>';
        return html;
    },

    /**
     * Render only template-specified attributes as a compact row.
     * Handles FK columns by showing their label values.
     */
    renderDetailAttributeRow(attributes, record, schema) {
        const headers = [];
        const cells = [];

        for (const attrName of attributes) {
            let col = schema.columns.find(c => c.name === attrName);
            if (!col) {
                col = schema.columns.find(c => c.foreignKey && c.name === attrName + '_id');
            }
            if (!col) continue;

            if (col.foreignKey) {
                const displayName = col.name.endsWith('_id') ? col.name.slice(0, -3) : col.name;
                const labelField = displayName + '_label';
                const labelValue = record[labelField];
                const displayValue = labelValue
                    ? DomUtils.escapeHtml(String(labelValue))
                    : (record[col.name] ? `#${record[col.name]}` : '');
                headers.push(`<th title="${displayName}">${displayName.replace(/_/g, ' ')}</th>`);
                cells.push(`<td title="${displayName}">${displayValue}</td>`);
            } else {
                const displayValue = ValueFormatter.formatDisplayHtml(record[col.name], col, schema);
                headers.push(`<th title="${col.name}">${col.name.replace(/_/g, ' ')}</th>`);
                cells.push(`<td title="${col.name}">${displayValue}</td>`);
            }
        }

        if (cells.length === 0) return '';
        return `
            <table class="tree-attr-table">
                <thead><tr>${headers.join('')}</tr></thead>
                <tbody><tr>${cells.join('')}</tr></tbody>
            </table>
        `;
    },

    /**
     * Render a back-reference in detail/template mode.
     * Loads records via entity API with ORDER BY/LIMIT from template params.
     */
    async renderDetailBackReference(parentEntity, parentId, templateChild, parentSchema, visitedPath, context) {
        const refEntity = templateChild.entity;
        const refSchema = await SchemaCache.getExtended(refEntity);
        const areaColor = refSchema.areaColor || '#f5f5f5';

        // Find FK column via parent's backReferences
        const parentBackRef = (parentSchema.backReferences || []).find(ref => ref.entity === refEntity);
        if (!parentBackRef) return '';
        const fkColumnName = parentBackRef.column;

        const nodeId = `backref-${refEntity}-${fkColumnName}-to-${parentEntity}-${parentId}`;
        const isExpanded = context.state.isExpanded(nodeId);

        // Parse ORDER BY and LIMIT from template params
        let sort = null, order = null, limit = null;
        if (templateChild.params) {
            const orderMatch = templateChild.params.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
            if (orderMatch) {
                sort = orderMatch[1];
                order = (orderMatch[2] || 'ASC').toLowerCase();
            }
            const limitMatch = templateChild.params.match(/LIMIT\s+(\d+)/i);
            if (limitMatch) {
                limit = parseInt(limitMatch[1]);
            }
        }

        // Load records via entity API
        let records = [];
        let totalCount = 0;
        try {
            const params = new URLSearchParams();
            params.set('filter', `${fkColumnName}:${parentId}`);
            if (sort) params.set('sort', sort);
            if (order) params.set('order', order);
            if (limit) params.set('limit', String(limit));
            const resp = await fetch(`api/entities/${refEntity}?${params}`);
            const result = await resp.json();
            records = result.data || [];
            totalCount = result.totalCount || result.total || records.length;
        } catch (e) {
            return '';
        }

        if (totalCount === 0) return '';
        const displayCount = limit && totalCount > limit
            ? `${records.length} of ${totalCount}`
            : `${records.length}`;

        let html = `
            <div class="tree-backref-node ${isExpanded ? 'expanded' : ''}"
                 data-node-id="${nodeId}"
                 data-ref-entity="${refEntity}"
                 data-ref-column="${fkColumnName}"
                 data-parent-entity="${parentEntity}"
                 data-parent-id="${parentId}">
              <div class="tree-backref-header" data-action="toggle-backref" style="background-color: ${areaColor};">
                <span class="tree-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
                <span class="backref-label">${refEntity} [${displayCount}]</span>
              </div>
        `;

        if (isExpanded && records.length > 0) {
            html += await this.renderDetailBackRefRecords(
                refEntity, records, refSchema, templateChild, visitedPath, context, parentEntity, parentId
            );
        }

        html += '</div>';
        return html;
    },

    /**
     * Render back-reference records as a table with only template-specified columns.
     */
    async renderDetailBackRefRecords(refEntity, records, refSchema, templateChild, visitedPath, context, parentEntity, parentId) {
        const attributes = templateChild.attributes || [];
        const hasChildren = templateChild.children && templateChild.children.length > 0;

        // Build display columns from template attributes
        const displayCols = [];
        for (const attrName of attributes) {
            let col = refSchema.columns.find(c => c.name === attrName);
            if (!col) {
                col = refSchema.columns.find(c => c.foreignKey && c.name === attrName + '_id');
            }
            if (!col) continue;

            if (col.foreignKey) {
                const displayName = col.name.endsWith('_id') ? col.name.slice(0, -3) : col.name;
                displayCols.push({ name: displayName + '_label', displayName, isFkLabel: true, originalCol: col });
            } else {
                displayCols.push({ name: col.name, displayName: col.name, isFkLabel: false, originalCol: col });
            }
        }

        if (displayCols.length === 0) return '';
        const areaColor = refSchema.areaColor || '#f5f5f5';

        // Build table header
        const expandHeader = hasChildren ? '<th class="expand-col"></th>' : '';
        const headers = expandHeader + displayCols.map(col =>
            `<th title="${col.displayName}">${col.displayName.replace(/_/g, ' ')}</th>`
        ).join('');

        // Build rows
        let rowsHtml = '';
        for (const record of records) {
            const rowNodeId = `backref-row-${refEntity}-${record.id}-in-${parentEntity}-${parentId}`;
            const isRowExpanded = hasChildren && context.state.isExpanded(rowNodeId);

            const cells = displayCols.map(col => {
                const value = record[col.name];
                let displayValue;
                if (value === null || value === undefined) {
                    displayValue = '';
                } else if (col.isFkLabel) {
                    displayValue = DomUtils.escapeHtml(String(value));
                } else {
                    displayValue = DomUtils.escapeHtml(ValueFormatter.format(value, col.name, refSchema));
                }
                return `<td title="${col.displayName}">${displayValue}</td>`;
            }).join('');

            const expandCell = hasChildren ? `
                <td class="expand-cell" data-action="toggle-backref-row">
                  <span class="tree-expand-icon">${isRowExpanded ? '&#9660;' : '&#9654;'}</span>
                </td>
            ` : '';

            rowsHtml += `
                <tr class="backref-table-row ${isRowExpanded ? 'expanded' : ''}"
                    data-node-id="${rowNodeId}"
                    data-entity="${refEntity}"
                    data-id="${record.id}">
                  ${expandCell}
                  ${cells}
                </tr>
            `;

            if (isRowExpanded) {
                const colSpan = displayCols.length + (hasChildren ? 1 : 0);
                const newPath = new Set([...visitedPath, `${refEntity}-${record.id}`]);
                const expandedContent = await this.renderDetailBackRefRowContent(
                    refEntity, record, refSchema, templateChild, newPath, context
                );
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
    },

    /**
     * Render expanded content for a back-ref row in detail/template mode.
     * Shows template children (FKs auto-expanded, back-refs with params).
     */
    async renderDetailBackRefRowContent(refEntity, record, refSchema, templateChild, visitedPath, context) {
        if (!templateChild.children || templateChild.children.length === 0) return '';

        let html = '<div class="backref-row-expanded">';

        for (const child of templateChild.children) {
            if (child.type === 'fk') {
                const col = refSchema.columns.find(c =>
                    c.foreignKey && (c.name === child.field || c.name === child.field + '_id')
                );
                if (col && record[col.name]) {
                    html += await this.renderForeignKeyNode(col, record[col.name], record, visitedPath, context, child);
                }
            } else if (child.type === 'backref') {
                html += await this.renderDetailBackReference(refEntity, record.id, child, refSchema, visitedPath, context);
            }
        }

        if (html === '<div class="backref-row-expanded">') {
            html += '<em class="no-relations">No relations</em>';
        }

        html += '</div>';
        return html;
    }
};

// Make available globally
window.TreeRenderer = TreeRenderer;
