/**
 * Seed Manager Component
 * Modal dialog for managing seed data - loading and clearing entity data
 * Single seed source: seed/ directory
 */
const SeedManager = {
  container: null,
  isOpen: false,
  entities: [],
  contextMenu: null,
  selectedEntity: null,

  /**
   * Initialize the seed manager
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
    this.createContextMenu();
  },

  /**
   * Create the context menu element
   */
  createContextMenu() {
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'seed-context-menu';
    this.contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="import">📥 Import...</div>
      <div class="context-menu-item" data-action="export">📤 Export...</div>
      <div class="context-menu-item" data-action="generate">🤖 Generate...</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="load">▶️ Load...</div>
      <div class="context-menu-item" data-action="clear">🗑️ Clear</div>
    `;
    document.body.appendChild(this.contextMenu);

    // Close context menu on click outside
    document.addEventListener('click', () => this.hideContextMenu());

    // Context menu actions
    this.contextMenu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action && this.selectedEntity) {
        this.handleContextAction(action, this.selectedEntity);
      }
      this.hideContextMenu();
    });
  },

  /**
   * Show context menu at position
   */
  showContextMenu(x, y, entityName, hasSeeds) {
    this.selectedEntity = entityName;
    this.contextMenu.style.left = x + 'px';
    this.contextMenu.style.top = y + 'px';
    this.contextMenu.classList.add('visible');

    // Enable/disable load and export based on seed availability
    const loadItem = this.contextMenu.querySelector('[data-action="load"]');
    const exportItem = this.contextMenu.querySelector('[data-action="export"]');
    if (loadItem) {
      loadItem.classList.toggle('disabled', !hasSeeds);
    }
    if (exportItem) {
      exportItem.classList.toggle('disabled', !hasSeeds);
    }
  },

  /**
   * Hide context menu
   */
  hideContextMenu() {
    this.contextMenu.classList.remove('visible');
  },

  /**
   * Handle context menu action
   */
  async handleContextAction(action, entityName) {
    switch (action) {
      case 'import':
        this.openImportDialog(entityName);
        break;
      case 'export':
        this.openExportDialog(entityName);
        break;
      case 'generate':
        await this.openGenerator(entityName);
        break;
      case 'load':
        this.openLoadPreview(entityName);
        break;
      case 'clear':
        await this.clearEntity(entityName);
        break;
    }
  },

  /**
   * Open import dialog for an entity
   */
  openImportDialog(entityName) {
    if (typeof SeedImportDialog !== 'undefined') {
      SeedImportDialog.show(entityName);
    } else {
      this.showMessage('Import dialog not loaded', true);
    }
  },

  /**
   * Open export dialog for an entity
   */
  openExportDialog(entityName) {
    if (typeof SeedPreviewDialog !== 'undefined') {
      SeedPreviewDialog.showExport(entityName);
    } else {
      this.showMessage('Preview dialog not loaded', true);
    }
  },

  /**
   * Open load preview for an entity
   */
  openLoadPreview(entityName) {
    if (typeof SeedPreviewDialog !== 'undefined') {
      SeedPreviewDialog.showLoad(entityName, async () => {
        await this.loadEntity(entityName);
      });
    } else {
      this.showMessage('Preview dialog not loaded', true);
    }
  },

  /**
   * Open the seed manager modal
   */
  async open() {
    if (!this.container) return;

    this.isOpen = true;
    await this.loadStatus();
    this.render();
  },

  /**
   * Close the modal
   */
  close() {
    this.isOpen = false;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('active');
    }
  },

  /**
   * Load status from API
   */
  async loadStatus() {
    try {
      const response = await fetch('/api/seed/status');
      const data = await response.json();
      this.entities = data.entities || [];
    } catch (err) {
      console.error('Failed to load seed status:', err);
      this.entities = [];
    }
  },

  /**
   * Refresh the seed manager (called after import)
   */
  async refresh() {
    if (this.isOpen) {
      await this.loadStatus();
      this.render();
    }
  },

  /**
   * Render the modal
   */
  render() {
    if (!this.container || !this.isOpen) return;

    const rows = this.entities.map((e, idx) => {
      const hasSeeds = e.seedTotal !== null && e.seedTotal > 0;
      const hasInvalid = hasSeeds && e.seedValid !== null && e.seedValid < e.seedTotal;

      // Display format: "5 / 8" if there are invalid records, otherwise just the total
      let seedDisplay = '--';
      if (e.seedTotal !== null) {
        if (hasInvalid) {
          seedDisplay = `<span class="seed-valid">${e.seedValid}</span> / ${e.seedTotal}`;
        } else {
          seedDisplay = String(e.seedTotal);
        }
      }

      return `
        <tr data-entity="${e.name}" data-has-seeds="${hasSeeds}">
          <td class="level">${idx + 1}</td>
          <td class="entity-name">${e.name}</td>
          <td class="row-count">${e.rowCount}</td>
          <td class="seed-count">${seedDisplay}</td>
        </tr>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-manager-modal">
          <div class="modal-header">
            <h2>Seed Data Manager</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <p class="order-hint">Entities sorted by dependency (load top-to-bottom, clear bottom-to-top). Right-click for actions.</p>
            <table class="seed-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entity</th>
                  <th>DB Rows</th>
                  <th>Seed Available</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn-seed btn-new-system" title="Create a new AIDE RAP system">+ New System</button>
            <span class="footer-spacer"></span>
            <button class="btn-seed btn-load-all">Load All</button>
            <button class="btn-seed btn-clear-all">Clear All</button>
            <button class="btn-seed btn-reset-all">Reset All</button>
          </div>
        </div>
      </div>
    `;

    this.container.classList.add('active');
    this.attachEventHandlers();
  },

  /**
   * Attach event handlers
   */
  attachEventHandlers() {
    // Modal dialog: do NOT close on overlay click
    // Dialog can only be closed via X button

    // Close button
    this.container.querySelectorAll('.modal-close').forEach(el => {
      el.addEventListener('click', () => this.close());
    });

    // Context menu on table rows (both left-click and right-click)
    this.container.querySelectorAll('.seed-table tbody tr').forEach(row => {
      const showMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const entityName = row.dataset.entity;
        const hasSeeds = row.dataset.hasSeeds === 'true';
        this.showContextMenu(e.pageX, e.pageY, entityName, hasSeeds);
      };
      row.addEventListener('click', showMenu);
      row.addEventListener('contextmenu', showMenu);
    });

    // Bulk actions
    this.container.querySelector('.btn-load-all')?.addEventListener('click', () => this.loadAll());
    this.container.querySelector('.btn-clear-all')?.addEventListener('click', () => this.clearAll());
    this.container.querySelector('.btn-reset-all')?.addEventListener('click', () => this.resetAll());
    this.container.querySelector('.btn-new-system')?.addEventListener('click', () => this.openModelBuilder());
  },

  /**
   * Show status message
   */
  showMessage(message, isError = false) {
    const footer = this.container.querySelector('.modal-footer');
    if (!footer) return;

    // Remove existing message
    const existing = footer.querySelector('.status-message');
    if (existing) existing.remove();

    const msg = document.createElement('div');
    msg.className = `status-message ${isError ? 'error' : 'success'}`;
    msg.textContent = message;
    footer.insertBefore(msg, footer.firstChild);

    // Auto-remove after 3 seconds
    setTimeout(() => msg.remove(), 3000);
  },

  /**
   * Load seed data for a single entity
   */
  async loadEntity(entityName) {
    try {
      const response = await fetch(`/api/seed/load/${entityName}`, { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        this.showMessage(`Loaded ${data.loaded} records into ${entityName}`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to load', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Clear data for a single entity
   */
  async clearEntity(entityName) {
    try {
      const response = await fetch(`/api/seed/clear/${entityName}`, { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        this.showMessage(`Cleared ${data.deleted} records from ${entityName}`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to clear', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Load all seed files
   */
  async loadAll() {
    try {
      const response = await fetch('/api/seed/load-all', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        const loaded = Object.values(data.results).filter(r => r.loaded > 0).length;
        this.showMessage(`Loaded seed data for ${loaded} entities`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to load all', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Clear all entity data
   */
  async clearAll() {
    if (!confirm('Clear ALL data from all entities?')) return;

    try {
      const response = await fetch('/api/seed/clear-all', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        this.showMessage('Cleared all entity data');
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to clear all', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Reset all: clear then load
   */
  async resetAll() {
    if (!confirm('Reset ALL data (clear and reload from seed files)?')) return;

    try {
      const response = await fetch('/api/seed/reset-all', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        this.showMessage('Reset complete: cleared and reloaded all data');
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to reset', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Open the AI generator dialog for an entity
   */
  async openGenerator(entityName) {
    if (typeof SeedGeneratorDialog !== 'undefined') {
      SeedGeneratorDialog.init('modal-container');
      await SeedGeneratorDialog.open(entityName);
    } else {
      this.showMessage('Generator dialog not loaded', true);
    }
  },

  /**
   * Open the Model Builder dialog for creating new systems
   */
  async openModelBuilder() {
    if (typeof ModelBuilderDialog !== 'undefined') {
      // Close the seed manager first
      this.close();
      // Open the model builder dialog
      ModelBuilderDialog.init('modal-container');
      await ModelBuilderDialog.open();
    } else {
      this.showMessage('Model Builder not loaded', true);
    }
  }
};
