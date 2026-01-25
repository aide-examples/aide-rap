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
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="export-pdf">
        <span class="context-menu-icon">&#128462;</span>
        <span data-i18n="ctx_export_pdf">Export PDF</span>
      </div>
      <div class="context-menu-item" data-action="export-docx">
        <span class="context-menu-icon">&#128221;</span>
        <span data-i18n="ctx_export_docx">Export DOCX</span>
      </div>
      <div class="context-menu-item" data-action="export-csv">
        <span class="context-menu-icon">&#128196;</span>
        <span data-i18n="ctx_export_csv">Export CSV</span>
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

    // Check if user has write access (not a guest)
    const hasWriteAccess = window.currentUser && ['user', 'admin', 'master'].includes(window.currentUser.role);

    // Enable/disable write actions based on role
    ['new', 'edit', 'delete'].forEach(action => {
      const item = this.menu.querySelector(`[data-action="${action}"]`);
      if (item) {
        if (hasWriteAccess) {
          item.classList.remove('disabled');
        } else {
          item.classList.add('disabled');
        }
      }
    });

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
    } else if (action === 'export-csv') {
      EntityTable.exportCsv();
    }

    this.hide();
  }
};
