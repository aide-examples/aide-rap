/**
 * Context Menu Component
 * Right-click menu for entity objects (table rows, tree nodes)
 */
const ContextMenu = {
  menu: null,
  currentContext: null,  // { entity, recordId, source: 'table'|'tree' }

  init() {
    this.createMenuElement();
    this.attachGlobalListeners();
  },

  createMenuElement() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new">
        <span class="context-menu-icon">&#10133;</span>
        <span data-i18n="ctx_new">New...</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="details">
        <span class="context-menu-icon">&#128269;</span>
        <span data-i18n="ctx_details">Details</span>
      </div>
      <div class="context-menu-item" data-action="edit">
        <span class="context-menu-icon">&#9998;</span>
        <span data-i18n="ctx_edit">Edit</span>
      </div>
      <div class="context-menu-item context-menu-item-danger" data-action="delete">
        <span class="context-menu-icon">&#128465;</span>
        <span data-i18n="ctx_delete">Delete</span>
      </div>
      <div class="context-menu-views"></div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item context-menu-has-sub">
        <span class="context-menu-icon">&#128229;</span>
        <span data-i18n="ctx_export">Export...</span>
        <span class="context-menu-arrow">&#9656;</span>
        <div class="context-menu-sub">
          <div class="context-menu-item" data-action="export-pdf">
            <span class="context-menu-icon">&#128462;</span>
            <span data-i18n="ctx_export_pdf">PDF</span>
          </div>
          <div class="context-menu-item" data-action="export-docx">
            <span class="context-menu-icon">&#128221;</span>
            <span data-i18n="ctx_export_docx">Word</span>
          </div>
          <div class="context-menu-item" data-action="export-xlsx">
            <span class="context-menu-icon">&#128202;</span>
            <span data-i18n="ctx_export_xlsx">Excel</span>
          </div>
          <div class="context-menu-item" data-action="export-csv">
            <span class="context-menu-icon">&#128196;</span>
            <span data-i18n="ctx_export_csv">CSV</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(menu);
    this.menu = menu;

    // Apply i18n translations to menu items
    if (typeof i18n !== 'undefined') {
      i18n.applyToDOM(menu);
    }

    // Click handlers for menu items
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // Ignore clicks on disabled items
        if (item.classList.contains('disabled')) {
          return;
        }
        const action = item.dataset.action;
        this.handleAction(action);
      });
    });
  },

  attachGlobalListeners() {
    // Close on click outside
    document.addEventListener('click', () => this.hide());

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    // Close on scroll
    document.addEventListener('scroll', () => this.hide(), true);
  },

  show(x, y, context) {
    this.currentContext = context;
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.classList.add('visible');

    const isViewMode = context.source === 'view';

    // Hide CRUD items and separators in view mode (export-only)
    ['new', 'details', 'edit', 'delete'].forEach(action => {
      const item = this.menu.querySelector(`[data-action="${action}"]`);
      if (item) item.style.display = isViewMode ? 'none' : '';
    });
    // Hide separators before CRUD items in view mode
    this.menu.querySelectorAll(':scope > .context-menu-separator').forEach((sep, i) => {
      if (i === 0) sep.style.display = isViewMode ? 'none' : '';
    });

    if (!isViewMode) {
      // Check if user has write access (not a guest)
      const hasWriteAccess = window.currentUser && ['user', 'admin', 'master'].includes(window.currentUser.role);

      // Check if entity is readonly (system entity like AuditTrail)
      const isReadonly = EntityExplorer.entityMetadata[context.entity]?.readonly === true;

      // Enable/disable write actions based on role and readonly status
      ['new', 'edit', 'delete'].forEach(action => {
        const item = this.menu.querySelector(`[data-action="${action}"]`);
        if (item) {
          if (hasWriteAccess && !isReadonly) {
            item.classList.remove('disabled');
          } else {
            item.classList.add('disabled');
          }
        }
      });
    }

    // Populate views section: entity-level views + FK-specific views (skip in view mode)
    const viewsContainer = this.menu.querySelector('.context-menu-views');
    viewsContainer.innerHTML = '';

    if (isViewMode) {
      // Skip views section in view mode
    } else {
    // Views matching the current entity's requiredFilter
    const entityViews = EntityExplorer.getViewsForEntity(context.entity);
    // Views matching the FK target entity (only when right-clicking on a FK cell)
    const fkViews = context.fkEntity ? EntityExplorer.getViewsForEntity(context.fkEntity) : [];

    const allViews = [
      ...entityViews.map(v => ({ ...v, filterValue: null })),
      ...fkViews.map(v => ({ ...v, filterValue: context.fkLabel }))
    ];

    if (allViews.length > 0) {
      let html = '<div class="context-menu-separator"></div>';
      for (const { view, matchType, viewColumn, filterValue } of allViews) {
        html += `<div class="context-menu-item context-menu-view-item"
                      data-view-name="${DomUtils.escapeHtml(view.name)}"
                      data-view-base="${DomUtils.escapeHtml(view.base)}"
                      data-view-color="${DomUtils.escapeHtml(view.color || '')}"
                      data-match-type="${matchType}"
                      ${viewColumn ? `data-view-column="${DomUtils.escapeHtml(viewColumn)}"` : ''}
                      ${filterValue ? `data-filter-value="${DomUtils.escapeHtml(filterValue)}"` : ''}>
          <span class="context-menu-icon">&#128202;</span>
          <span>${DomUtils.escapeHtml(view.name)}</span>
        </div>`;
      }
      viewsContainer.innerHTML = html;
      viewsContainer.querySelectorAll('.context-menu-view-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          EntityExplorer.openViewForRecord(
            item.dataset.viewName, item.dataset.viewBase,
            item.dataset.viewColor, this.currentContext.recordId,
            item.dataset.matchType, item.dataset.viewColumn,
            item.dataset.filterValue || null
          );
          this.hide();
        });
      });
    }
    } // end !isViewMode

    // External query items — config-driven per entity + FK entity
    // Available in both entity and view mode (FK cells in views)
    const entityExtQ = context.entity ? EntityExplorer.getExternalQueriesForEntity(context.entity).map(eq => ({ ...eq, fk: false })) : [];
    const fkExtQ = context.fkEntity ? EntityExplorer.getExternalQueriesForEntity(context.fkEntity).map(eq => ({ ...eq, fk: true })) : [];
    // Deduplicate: when FK target has same provider as entity (e.g. self-FK), prefer FK entry
    const fkProviders = new Set(fkExtQ.map(eq => eq.provider));
    const allExtQueries = [...entityExtQ.filter(eq => !fkProviders.has(eq.provider)), ...fkExtQ];
    if (allExtQueries.length > 0) {
      let extHtml = '<div class="context-menu-separator"></div>';
      for (const eq of allExtQueries) {
        extHtml += `<div class="context-menu-item context-menu-ext-query-item"
                         data-provider="${DomUtils.escapeHtml(eq.provider)}"
                         data-search-field="${DomUtils.escapeHtml(eq.searchField)}"
                         data-fk="${eq.fk ? '1' : ''}">
          <span class="context-menu-icon">&#128270;</span>
          <span>${DomUtils.escapeHtml(eq.label)}</span>
        </div>`;
      }
      viewsContainer.insertAdjacentHTML('beforeend', extHtml);
      viewsContainer.querySelectorAll('.context-menu-ext-query-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          let searchTerm;
          if (item.dataset.fk) {
            searchTerm = this.currentContext.fkLabel || '';
          } else {
            const record = (EntityTable.records || []).find(r => r.id === this.currentContext.recordId);
            searchTerm = record ? record[item.dataset.searchField] : '';
          }
          if (typeof ExternalQueryDialog !== 'undefined') {
            ExternalQueryDialog.open(item.dataset.provider, searchTerm || '', item.textContent.trim());
          }
          this.hide();
        });
      });
    }

    // Adjust if menu goes off-screen
    const rect = this.menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.menu.style.top = `${y - rect.height}px`;
    }
  },

  hide() {
    this.menu.classList.remove('visible');
    this.currentContext = null;
  },

  handleAction(action) {
    if (!this.currentContext) return;
    const { entity, recordId, source } = this.currentContext;

    if (action === 'new') {
      DetailPanel.showCreateForm(entity);
    } else if (action === 'details') {
      if (source === 'table') {
        EntityTable.onDetails(recordId);
      } else {
        EntityTree.onDetails(entity, recordId);
      }
    } else if (action === 'edit') {
      if (source === 'table') {
        EntityTable.onEdit(recordId);
      } else {
        EntityTree.onEdit(entity, recordId);
      }
    } else if (action === 'delete') {
      if (source === 'table') {
        EntityTable.onDelete(recordId);
      } else {
        EntityTree.onDelete(entity, recordId);
      }
    } else if (action === 'export-pdf') {
      if (source === 'tree') {
        EntityTree.exportPdf();
      } else {
        EntityTable.exportPdf();
      }
    } else if (action === 'export-docx') {
      if (source === 'tree') {
        EntityTree.exportDocx();
      } else {
        EntityTable.exportDocx();
      }
    } else if (action === 'export-xlsx') {
      EntityTable.exportXlsx();
    } else if (action === 'export-csv') {
      EntityTable.exportCsv();
    }

    this.hide();
  }
};
