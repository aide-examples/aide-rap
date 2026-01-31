/**
 * Entity Table Component
 * Sortable, scrollable table view for entity records
 */

// System columns that are hidden by default (version, timestamps)
const SYSTEM_COLUMNS = ['version', 'created_at', 'updated_at'];

const EntityTable = {
  container: null,
  currentEntity: null,
  currentViewConfig: null, // null = entity mode, object = view mode
  records: [],
  schema: null,
  selectedId: null,
  sortColumn: null,
  sortDirection: 'asc', // 'asc' or 'desc'
  columnFilters: {}, // { columnName: filterValue }
  showSystem: false, // Show system columns (version, created_at, updated_at)

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

    // System columns toggle (version, created_at, updated_at)
    const systemToggle = document.getElementById('show-system-toggle');
    if (systemToggle) {
      // Restore from sessionStorage
      this.showSystem = sessionStorage.getItem('showSystem') === 'true';
      systemToggle.checked = this.showSystem;

      systemToggle.addEventListener('change', () => {
        this.showSystem = systemToggle.checked;
        sessionStorage.setItem('showSystem', this.showSystem);
        this.render();
      });
    }
  },

  /**
   * Load and display records for an entity type
   */
  async loadEntity(entityName, records) {
    this.currentEntity = entityName;
    this.currentViewConfig = null; // Exit view mode
    this.records = records;
    this.selectedId = null;
    this.sortColumn = null;
    this.sortDirection = 'asc';
    this.columnFilters = {}; // Reset filters on entity change

    // Get schema
    this.schema = await SchemaCache.getExtended(entityName);

    await this.render();
  },

  /**
   * Load and display a user-defined view (read-only)
   */
  async loadView(viewName, viewSchema, records) {
    this.currentEntity = null;
    this.currentViewConfig = viewSchema;
    this.records = records;
    this.selectedId = null;
    this.sortColumn = null;
    this.sortDirection = 'asc';
    this.columnFilters = {};
    this.schema = null;

    this.renderView();
  },

  /**
   * Render a user view table (read-only, no CRUD)
   */
  renderView() {
    if (!this.currentViewConfig) {
      this.container.innerHTML = '';
      return;
    }

    const columns = this.currentViewConfig.columns.filter(c => !c.hidden && !c.autoHidden);
    const sortedRecords = this.getViewSortedRecords(columns);

    let html = '<div class="entity-table-wrapper"><table class="entity-table">';

    // Header row
    html += '<thead><tr>';
    for (const col of columns) {
      const isSorted = this.sortColumn === col.key;
      const sortIcon = isSorted
        ? (this.sortDirection === 'asc' ? ' &#9650;' : ' &#9660;')
        : ' <span class="sort-hint">&#8645;</span>';

      const headerLabel = DomUtils.splitCamelCase(col.label).replace(/[_ ]/g, '<br>');
      const bgStyle = col.areaColor ? ` style="background-color: ${col.areaColor}"` : '';
      // Get description for tooltip (from view column or schema)
      const rawDesc = col.description || '';
      const cleanDesc = rawDesc.replace(/\[[^\]]*\]/g, '').trim();
      const titleAttr = cleanDesc ? ` title="${DomUtils.escapeHtml(cleanDesc)}"` : '';
      html += `<th class="sortable" data-column="${col.key}"${bgStyle}${titleAttr}>
        ${headerLabel}${sortIcon}
      </th>`;
    }
    html += '</tr>';

    // Filter row
    html += '<tr class="filter-row">';
    for (const col of columns) {
      const filterValue = this.columnFilters[col.key] || '';
      html += `<th class="filter-cell">
        <input type="text" class="column-filter" data-column="${col.key}"
               value="${DomUtils.escapeHtml(filterValue)}" placeholder="Filter...">
      </th>`;
    }
    html += '</tr></thead>';

    // Body rows
    html += '<tbody>';
    if (sortedRecords.length === 0) {
      html += `<tr><td colspan="${columns.length}" class="empty-table-message">${i18n.t('no_records_found')}</td></tr>`;
    }
    for (let i = 0; i < sortedRecords.length; i++) {
      const record = sortedRecords[i];
      const isSelected = record.id === this.selectedId;
      const rowClass = isSelected ? 'selected' : (i % 2 === 1 ? 'zebra' : '');

      // Row-level styling (e.g., row._rowStyle = { backgroundColor: '#fff' })
      const rowStyle = record._rowStyle;
      const rowStyleAttr = rowStyle
        ? ` style="${Object.entries(rowStyle).map(([k,v]) =>
            `${k.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}:${v}`).join(';')}"`
        : '';

      html += `<tr class="${rowClass}"${rowStyleAttr} data-id="${record.id}">`;
      for (const col of columns) {
        const value = record[col.key];
        let displayValue = '';
        if (value == null) {
          // null/undefined: suppress unless no omit rule would hide it anyway
        } else if (col.omit !== undefined && String(value) === col.omit) {
          // value matches omit rule: suppress
        } else {
          displayValue = DomUtils.escapeHtml(String(value));
        }
        // Calculator cell styles (e.g., row._cellStyles = { colKey: { backgroundColor: '#fff' } })
        // Support both titlecased key (e.g., 'Usage') and snake_case key (e.g., 'usage')
        const snakeCaseKey = col.key.toLowerCase().replace(/ /g, '_');
        const cellStyle = record._cellStyles?.[col.key] || record._cellStyles?.[snakeCaseKey];
        const styleAttr = cellStyle
          ? ` style="${Object.entries(cellStyle).map(([k,v]) =>
              `${k.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}:${v}`).join(';')}"`
          : '';
        html += `<td${styleAttr}>${displayValue}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    // Scroll sentinel for infinite scroll
    html += '<div id="scroll-sentinel" class="scroll-sentinel"></div>';
    html += '</div>';

    this.container.innerHTML = html;
    this.attachViewEventListeners(columns);

    // Update record count
    const filteredCount = this.getViewFilteredRecords(columns).length;
    if (typeof EntityExplorer !== 'undefined') {
      EntityExplorer.updateRecordStatus(filteredCount);
    }
  },

  /**
   * Get filtered records for view mode
   */
  getViewFilteredRecords(columns) {
    const activeFilters = Object.entries(this.columnFilters)
      .filter(([_, value]) => value && value.trim() !== '');

    if (activeFilters.length === 0) return this.records;

    return this.records.filter(record => {
      return activeFilters.every(([colKey, filterValue]) => {
        const filter = filterValue.toLowerCase().trim();
        const cellValue = record[colKey];
        if (cellValue == null) return false;
        return String(cellValue).toLowerCase().includes(filter);
      });
    });
  },

  /**
   * Get sorted records for view mode
   */
  getViewSortedRecords(columns) {
    const filtered = this.getViewFilteredRecords(columns);

    if (!this.sortColumn) return filtered;

    const sortCol = columns.find(c => c.key === this.sortColumn);
    const omitValue = sortCol?.omit;

    return [...filtered].sort((a, b) => {
      const valA = a[this.sortColumn];
      const valB = b[this.sortColumn];

      // OMIT values (null or matching omit rule) always sort to end
      const aOmit = valA == null || (omitValue !== undefined && String(valA) === omitValue);
      const bOmit = valB == null || (omitValue !== undefined && String(valB) === omitValue);
      if (aOmit !== bOmit) return aOmit ? 1 : -1;
      if (aOmit && bOmit) return 0;

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
   * Attach event listeners for view mode (read-only)
   */
  attachViewEventListeners(columns) {
    // Column header click for sorting
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const column = th.dataset.column;
        if (this.sortColumn === column) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = column;
          this.sortDirection = 'asc';
        }
        this.renderView();
      });
    });

    // Column filter inputs
    this.container.querySelectorAll('.column-filter').forEach(input => {
      input.addEventListener('input', (e) => {
        const column = input.dataset.column;
        const cursorPos = e.target.selectionStart;
        this.columnFilters[column] = e.target.value;
        this.renderView();
        const newInput = this.container.querySelector(`.column-filter[data-column="${column}"]`);
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(cursorPos, cursorPos);
        }
      });
      input.addEventListener('click', (e) => e.stopPropagation());
    });

    // Row click → jump to base entity edit
    this.container.querySelectorAll('tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        const id = parseInt(row.dataset.id);
        if (this.currentViewConfig && EntityExplorer.currentView) {
          EntityExplorer.editInBaseEntity(EntityExplorer.currentView.base, id);
        }
      });

      // Cursor indicates clickable
      row.style.cursor = 'pointer';
    });
  },

  /**
   * Get visible columns based on schema and sort settings
   * Respects both attributeOrder (alpha/schema) and referencePosition (start/end/inline)
   * Back-references are always at the end (handled separately in render)
   */
  getVisibleColumns() {
    if (!this.schema) return [];

    let columns = this.schema.columns.filter(col =>
      !this.schema.ui?.hiddenFields?.includes(col.name) &&
      (this.showSystem || !SYSTEM_COLUMNS.includes(col.name))
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
   * Get filtered records (client-side filtering)
   */
  getFilteredRecords() {
    const activeFilters = Object.entries(this.columnFilters)
      .filter(([_, value]) => value && value.trim() !== '');

    if (activeFilters.length === 0) {
      return this.records;
    }

    return this.records.filter(record => {
      return activeFilters.every(([column, filterValue]) => {
        const filter = filterValue.toLowerCase().trim();

        // For FK columns, filter against the label (not the numeric ID)
        if (column.endsWith('_id')) {
          const labelField = column.replace(/_id$/, '') + '_label';
          const labelValue = record[labelField];
          if (labelValue != null) {
            return String(labelValue).toLowerCase().includes(filter);
          }
        }

        const cellValue = record[column];
        if (cellValue == null) return false;

        return String(cellValue).toLowerCase().includes(filter);
      });
    });
  },

  /**
   * Get active filter descriptions for export headers
   * @returns {Array<{column: string, value: string}>} Active filters with display names
   */
  getActiveFilterDescriptions() {
    return Object.entries(this.columnFilters)
      .filter(([_, value]) => value && value.trim() !== '')
      .map(([column, value]) => {
        // Build display name: use conceptual name for FK columns
        const displayName = column.endsWith('_id')
          ? DomUtils.splitCamelCase(column.slice(0, -3)).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          : DomUtils.splitCamelCase(column).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return { column: displayName, value: value.trim() };
      });
  },

  /**
   * Get sorted records
   */
  getSortedRecords() {
    const filtered = this.getFilteredRecords();

    if (!this.sortColumn) {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
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

      // Use conceptual name for FKs (type instead of type_id)
      // Split at CamelCase, underscores, and spaces for line breaks in headers
      const rawName = col.foreignKey
        ? (col.name.endsWith('_id') ? col.name.slice(0, -3) : col.name)
        : col.name;
      const displayName = DomUtils.splitCamelCase(rawName).replace(/[_ ]/g, '<br>');

      // Use area color for FK columns
      const bgStyle = col.foreignKey?.areaColor
        ? ` style="background-color: ${col.foreignKey.areaColor}"`
        : '';

      // Get description for tooltip (strip annotations like [LABEL], [UNIQUE], etc.)
      const rawDesc = col.description || '';
      const cleanDesc = rawDesc.replace(/\[[^\]]*\]/g, '').trim();
      const titleAttr = cleanDesc ? ` title="${DomUtils.escapeHtml(cleanDesc)}"` : '';

      // Special header for media columns - entire header is clickable
      if (col.customType === 'media') {
        const mediaTitle = cleanDesc ? `${cleanDesc} (click to browse)` : 'Click to browse media';
        html += `<th class="media-column-header" data-column="${col.name}" data-field="${col.name}" title="${DomUtils.escapeHtml(mediaTitle)}">
          📎 ${displayName} ▾
        </th>`;
      } else {
        html += `<th class="sortable${isFK}" data-column="${col.name}"${bgStyle}${titleAttr}>
          ${displayName}${sortIcon}
        </th>`;
      }
    }
    // Back-reference columns
    for (const ref of backRefs) {
      // Use conceptual name (without _id suffix), replace underscores with <br> for line breaks
      const fieldName = (ref.column.endsWith('_id')
        ? ref.column.slice(0, -3)
        : ref.column
      ).replace(/_/g, '<br>');
      // Use area color of the referencing entity
      const bgColor = ref.areaColor || '#fef3c7';
      html += `<th class="backref-column" style="background-color: ${bgColor}" title="Records in ${ref.entity} referencing this via ${fieldName}">
        <span class="backref-entity">${DomUtils.splitCamelCase(ref.entity)}</span>
        <span class="backref-field">${fieldName}</span>
      </th>`;
    }
    html += '</tr>';

    // Filter row
    html += '<tr class="filter-row">';
    for (const col of columns) {
      const filterValue = this.columnFilters[col.name] || '';
      html += `<th class="filter-cell">
        <input type="text" class="column-filter" data-column="${col.name}"
               value="${DomUtils.escapeHtml(filterValue)}" placeholder="Filter...">
      </th>`;
    }
    // Empty cells for back-reference columns (no filtering)
    for (const ref of backRefs) {
      html += '<th class="filter-cell"></th>';
    }
    html += '</tr></thead>';

    // Body rows
    html += '<tbody>';
    if (sortedRecords.length === 0) {
      const colSpan = columns.length + backRefs.length;
      html += `<tr><td colspan="${colSpan}" class="empty-table-message">${i18n.t('no_records_found')}</td></tr>`;
    }

    // Get mediaRowHeight from tableOptions (if configured for this entity)
    const mediaRowHeight = this.schema?.ui?.tableOptions?.mediaRowHeight;
    // Find media columns for row height logic
    const mediaColumns = columns.filter(col => col.customType === 'media');

    for (let i = 0; i < sortedRecords.length; i++) {
      const record = sortedRecords[i];
      const isSelected = record.id === this.selectedId;
      const rowClass = isSelected ? 'selected' : (i % 2 === 1 ? 'zebra' : '');

      // Apply larger row height only if row has media content
      const hasMedia = mediaRowHeight && mediaColumns.some(col => record[col.name]);
      const rowStyle = hasMedia ? ` style="height: ${mediaRowHeight}px;"` : '';

      html += `<tr class="${rowClass}"${rowStyle} data-id="${record.id}">`;

      for (const col of columns) {
        const value = record[col.name];

        if (col.foreignKey && value) {
          // Check if _label field is already present from View (FK-Label-Enrichment)
          const displayName = col.name.endsWith('_id')
            ? col.name.slice(0, -3)  // type_id -> type
            : col.name;
          const labelField = displayName + '_label';
          const preloadedLabel = record[labelField];

          if (preloadedLabel) {
            // Label already available from View - render directly
            html += `<td class="fk-cell">
              <span class="fk-value" data-action="navigate" data-entity="${col.foreignKey.entity}" data-id="${value}">
                ${DomUtils.escapeHtml(preloadedLabel)}
              </span>
            </td>`;
          } else {
            // Fallback: render with loading placeholder (async load)
            html += `<td class="fk-cell" data-entity="${col.foreignKey.entity}" data-id="${value}">
              <span class="fk-loading">#${value}</span>
            </td>`;
          }
        } else if (col.customType === 'url' && value) {
          // URL: Clickable link
          html += `<td><a href="${DomUtils.escapeHtml(value)}" target="_blank" rel="noopener" class="url-link">${DomUtils.escapeHtml(value)}</a></td>`;
        } else if (col.customType === 'mail' && value) {
          // Mail: Mailto link
          html += `<td><a href="mailto:${DomUtils.escapeHtml(value)}" class="mail-link">${DomUtils.escapeHtml(value)}</a></td>`;
        } else if (col.customType === 'json' && value) {
          // JSON: Truncated preview with tooltip
          const jsonStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
          const truncated = jsonStr.length > 50 ? jsonStr.substring(0, 47) + '...' : jsonStr;
          html += `<td class="json-cell" title="${DomUtils.escapeHtml(jsonStr)}">${DomUtils.escapeHtml(truncated)}</td>`;
        } else if (col.customType === 'media' && value) {
          // Media: Thumbnail link (with max-height if mediaRowHeight is configured)
          const imgStyle = mediaRowHeight ? ` style="max-height: ${mediaRowHeight - 8}px;"` : '';
          html += `<td class="media-cell">
            <a href="/api/media/${DomUtils.escapeHtml(value)}/file" target="_blank" rel="noopener" title="Datei oeffnen">
              <img src="/api/media/${DomUtils.escapeHtml(value)}/thumbnail" class="media-thumb-tiny"${imgStyle}
                   onerror="this.onerror=null; this.src='/icons/file.svg'; this.classList.add('media-thumb-fallback')">
            </a>
          </td>`;
        } else {
          // Regular value - use ValueFormatter to convert enum internal->external
          const displayValue = value != null
            ? DomUtils.escapeHtml(ValueFormatter.format(value, col.name, this.schema))
            : '';
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

      html += '</tr>';
    }
    html += '</tbody></table>';
    // Scroll sentinel for infinite scroll
    html += '<div id="scroll-sentinel" class="scroll-sentinel"></div>';
    html += '</div>';

    this.container.innerHTML = html;

    // Load FK labels asynchronously
    this.loadForeignKeyLabels();

    // Load back-reference counts only for selected row (performance optimization)
    if (this.selectedId) {
      this.loadBackReferenceCountsForRow(this.selectedId);
    }

    // Attach event listeners
    this.attachEventListeners();

    // Update record count in status bar (with filtered count)
    const filteredCount = this.getFilteredRecords().length;
    if (typeof EntityExplorer !== 'undefined') {
      EntityExplorer.updateRecordStatus(filteredCount);
    }
  },

  /**
   * Load FK labels for cells that don't have preloaded labels
   * Most cells should already have labels from the View (FK-Label-Enrichment)
   * This is a fallback for edge cases
   */
  async loadForeignKeyLabels() {
    // Only load for cells that still have loading placeholder (no preloaded label)
    const fkCells = this.container.querySelectorAll('.fk-cell[data-entity]');

    for (const cell of fkCells) {
      const entityName = cell.dataset.entity;
      const id = parseInt(cell.dataset.id);

      // Skip if already loaded (no data-entity means label was preloaded)
      if (!entityName || !id) continue;

      try {
        const refSchema = await SchemaCache.getExtended(entityName);
        const refRecord = await ApiClient.getById(entityName, id);
        const label = this.getRecordLabel(refRecord, refSchema);
        const fullLabel = label.subtitle ? `${label.title} · ${label.subtitle}` : label.title;

        cell.innerHTML = `
          <span class="fk-value" data-action="navigate" data-entity="${entityName}" data-id="${id}">
            ${DomUtils.escapeHtml(fullLabel)}
          </span>
        `;
      } catch {
        // Keep the ID fallback
      }
    }

    // Attach navigation listeners for ALL FK links (both preloaded and async-loaded)
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
    return ColumnUtils.getRecordLabel(record, schema);
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

    // Column filter inputs
    this.container.querySelectorAll('.column-filter').forEach(input => {
      input.addEventListener('input', (e) => {
        const column = input.dataset.column;
        const cursorPos = e.target.selectionStart;
        this.columnFilters[column] = e.target.value;
        this.render();
        // Restore focus and cursor position after render
        const newInput = this.container.querySelector(`.column-filter[data-column="${column}"]`);
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(cursorPos, cursorPos);
        }
      });
      // Prevent click from triggering row selection
      input.addEventListener('click', (e) => e.stopPropagation());
    });

    // Media column header click - open media browser directly
    this.container.querySelectorAll('.media-column-header').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        const field = th.dataset.field;
        const entity = this.currentEntity;

        if (typeof MediaBrowser !== 'undefined') {
          MediaBrowser.show(entity, field);
        }
      });
    });

    // Row click for selection
    this.container.querySelectorAll('tbody tr').forEach(row => {
      row.addEventListener('click', (e) => {
        if (!e.target.closest('[data-action]')) {
          const id = parseInt(row.dataset.id);
          this.onRowClick(id);
        }
      });

      // Context menu (right-click)
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = parseInt(row.dataset.id);
        ContextMenu.show(e.clientX, e.clientY, {
          entity: this.currentEntity,
          recordId: id,
          source: 'table'
        });
      });

      // Double-click: open in horizontal tree view with 2 levels expanded
      row.addEventListener('dblclick', (e) => {
        if (!e.target.closest('[data-action]') && !e.target.closest('.column-filter')) {
          const id = parseInt(row.dataset.id);
          EntityExplorer.showInTreeView(id, 2);
        }
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
   * Handle row click (selection only, no detail panel)
   * Detail panel is opened via context menu (Edit/Details)
   */
  onRowClick(id) {
    const previousId = this.selectedId;

    // Toggle: clicking same row deselects it
    if (previousId === id) {
      this.selectedId = null;
      EntityExplorer.selectedId = null;
    } else {
      this.selectedId = id;
      EntityExplorer.selectedId = id;

      // Load back-reference counts for the newly selected row
      this.loadBackReferenceCountsForRow(id);

      // If detail panel is in view mode, update it with the new record
      if (DetailPanel.mode === 'view') {
        const record = this.records.find(r => r.id === id);
        if (record) {
          DetailPanel.showRecord(this.currentEntity, record);
        }
      }
    }

    // Update selection visually without full re-render
    this.container.querySelectorAll('tbody tr').forEach(row => {
      const rowId = parseInt(row.dataset.id);
      row.classList.toggle('selected', rowId === this.selectedId);
      row.classList.toggle('zebra', rowId !== this.selectedId && this.records.findIndex(r => r.id === rowId) % 2 === 1);
    });
  },

  /**
   * Handle details action (read-only view)
   */
  onDetails(id) {
    this.selectedId = id;
    const record = this.records.find(r => r.id === id);
    if (record) {
      DetailPanel.showRecord(this.currentEntity, record);
    }
    this.render();
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
      i18n.t('confirm_delete', { entity: this.currentEntity })
    );

    if (confirmed) {
      try {
        await ApiClient.delete(this.currentEntity, id);
        await EntityExplorer.refresh();
      } catch (err) {
        alert(i18n.t('delete_failed', { message: err.message }));
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
   * Prepare export data: build display columns and format records
   */
  prepareExportData() {
    if (!this.currentEntity || !this.schema) return null;

    const records = this.getFilteredRecords();
    if (records.length === 0) {
      alert(i18n.t('no_records_to_export'));
      return null;
    }

    const columns = this.getVisibleColumns()
      .filter(col => col.name !== 'id')
      .map(col => {
        const displayName = col.foreignKey && col.name.endsWith('_id')
          ? col.name.slice(0, -3)
          : col.name;
        return {
          key: col.name,
          label: DomUtils.splitCamelCase(displayName).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          color: col.foreignKey?.areaColor || null
        };
      });

    const formattedRecords = records.map(record => {
      const formatted = {};
      for (const col of columns) {
        const colDef = this.schema.columns.find(c => c.name === col.key);
        if (colDef?.foreignKey) {
          const dn = col.key.endsWith('_id') ? col.key.slice(0, -3) : col.key;
          formatted[col.key] = record[dn + '_label'] || record[col.key] || '';
        } else {
          const value = record[col.key];
          formatted[col.key] = value != null
            ? ValueFormatter.format(value, col.key, this.schema)
            : '';
        }
      }
      return formatted;
    });

    return {
      title: this.currentEntity,
      columns,
      records: formattedRecords,
      entityColor: this.schema.areaColor || '#1a365d',
      filters: this.getActiveFilterDescriptions()
    };
  },

  /**
   * Export current table view to a server-rendered format (pdf, docx, csv)
   */
  async exportToFormat(format) {
    const data = this.prepareExportData();
    if (!data) return;

    try {
      const response = await fetch(`/api/entities/${this.currentEntity}/export-${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        const blob = await response.blob();
        DomUtils.downloadBlob(blob, `${this.currentEntity}.${format}`);
      } else {
        const error = await response.json();
        alert(i18n.t('export_failed', { message: error.error || 'Unknown error' }));
      }
    } catch (err) {
      alert(i18n.t('export_failed', { message: err.message }));
    }
  },

  async exportPdf() { return this.exportToFormat('pdf'); },
  async exportDocx() { return this.exportToFormat('docx'); },
  async exportCsv() { return this.exportToFormat('csv'); },
};
