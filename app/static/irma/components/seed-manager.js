/**
 * Seed Manager Component
 * Modal dialog for managing seed data - loading and clearing entity data
 * Supports two sources: imported (uploaded) and generated (synthetic)
 */
const SeedManager = {
  container: null,
  isOpen: false,
  entities: [],
  activeSource: 'generated',
  sources: ['imported', 'generated'],

  /**
   * Initialize the seed manager
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
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
      this.activeSource = data.activeSource || 'generated';
      this.sources = data.sources || ['imported', 'generated'];
    } catch (err) {
      console.error('Failed to load seed status:', err);
      this.entities = [];
    }
  },

  /**
   * Render the modal
   */
  render() {
    if (!this.container || !this.isOpen) return;

    const rows = this.entities.map((e, idx) => {
      const hasImported = e.importedCount !== null;
      const hasGenerated = e.generatedCount !== null;
      const hasActive = this.activeSource === 'imported' ? hasImported : hasGenerated;

      return `
        <tr>
          <td class="level">${idx + 1}</td>
          <td class="entity-name">${e.name}</td>
          <td class="row-count">${e.rowCount}</td>
          <td class="seed-count imported ${this.activeSource === 'imported' ? 'active' : ''}">${hasImported ? e.importedCount : '--'}</td>
          <td class="seed-count generated ${this.activeSource === 'generated' ? 'active' : ''}">${hasGenerated ? e.generatedCount : '--'}</td>
          <td class="actions">
            <button class="btn-seed btn-generate" data-entity="${e.name}" title="Generate with AI">AI</button>
            ${hasActive ? `<button class="btn-seed btn-load" data-entity="${e.name}">Load</button>` : ''}
            <button class="btn-seed btn-clear" data-entity="${e.name}" ${e.rowCount === 0 ? 'disabled' : ''}>Clear</button>
            ${hasImported ? `<button class="btn-seed btn-copy" data-entity="${e.name}" title="Copy to Generated">→G</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    const sourceOptions = this.sources.map(s =>
      `<option value="${s}" ${s === this.activeSource ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');

    this.container.innerHTML = `
      <div class="modal-overlay" data-action="close">
        <div class="modal-dialog seed-manager-modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>Seed Data Manager</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-toolbar">
            <label>Source: <select id="seed-source">${sourceOptions}</select></label>
            <button class="btn-seed btn-upload">Upload JSON...</button>
            <button class="btn-seed btn-copy-all">Copy All → Generated</button>
          </div>
          <div class="modal-body">
            <p class="order-hint">Entities sorted by dependency (load top-to-bottom, clear bottom-to-top)</p>
            <table class="seed-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entity</th>
                  <th>Rows</th>
                  <th class="${this.activeSource === 'imported' ? 'active' : ''}">Imported</th>
                  <th class="${this.activeSource === 'generated' ? 'active' : ''}">Generated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn-seed btn-load-all">Load All</button>
            <button class="btn-seed btn-clear-all">Clear All</button>
            <button class="btn-seed btn-reset-all">Reset All</button>
          </div>
        </div>
      </div>
      <input type="file" id="seed-file-input" accept=".json" style="display: none">
    `;

    this.container.classList.add('active');
    this.attachEventHandlers();
  },

  /**
   * Attach event handlers
   */
  attachEventHandlers() {
    // Close modal
    this.container.querySelectorAll('[data-action="close"]').forEach(el => {
      el.addEventListener('click', () => this.close());
    });

    // Source selector
    this.container.querySelector('#seed-source')?.addEventListener('change', async (e) => {
      await this.setSource(e.target.value);
    });

    // Upload button
    this.container.querySelector('.btn-upload')?.addEventListener('click', () => {
      this.showUploadDialog();
    });

    // Copy all to generated
    this.container.querySelector('.btn-copy-all')?.addEventListener('click', () => this.copyAllToGenerated());

    // Generate with AI
    this.container.querySelectorAll('.btn-generate').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const entity = e.target.dataset.entity;
        await this.openGenerator(entity);
      });
    });

    // Load single entity
    this.container.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const entity = e.target.dataset.entity;
        await this.loadEntity(entity);
      });
    });

    // Clear single entity
    this.container.querySelectorAll('.btn-clear').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const entity = e.target.dataset.entity;
        await this.clearEntity(entity);
      });
    });

    // Copy single entity to generated
    this.container.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const entity = e.target.dataset.entity;
        await this.copyToGenerated(entity);
      });
    });

    // Bulk actions
    this.container.querySelector('.btn-load-all')?.addEventListener('click', () => this.loadAll());
    this.container.querySelector('.btn-clear-all')?.addEventListener('click', () => this.clearAll());
    this.container.querySelector('.btn-reset-all')?.addEventListener('click', () => this.resetAll());

    // File input handler
    const fileInput = this.container.querySelector('#seed-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    }
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
   * Set active source
   */
  async setSource(source) {
    try {
      const response = await fetch('/api/seed/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });
      const data = await response.json();

      if (data.success) {
        this.activeSource = data.activeSource;
        this.showMessage(`Source set to: ${source}`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Failed to set source', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Show upload dialog
   */
  showUploadDialog() {
    // Create entity selector dialog
    const entityNames = this.entities.map(e => e.name);
    const selected = prompt(`Enter entity name to upload:\n\nAvailable: ${entityNames.join(', ')}`);

    if (selected && entityNames.includes(selected)) {
      this.uploadEntityName = selected;
      this.container.querySelector('#seed-file-input')?.click();
    } else if (selected) {
      this.showMessage(`Unknown entity: ${selected}`, true);
    }
  },

  /**
   * Handle file upload
   */
  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !this.uploadEntityName) return;

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);

      const response = await fetch(`/api/seed/upload/${this.uploadEntityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonData)
      });
      const data = await response.json();

      if (data.success) {
        this.showMessage(`Uploaded ${data.uploaded} records to ${this.uploadEntityName}`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Upload failed', true);
      }
    } catch (err) {
      this.showMessage(`Upload failed: ${err.message}`, true);
    }

    // Reset file input
    event.target.value = '';
    this.uploadEntityName = null;
  },

  /**
   * Copy entity from imported to generated
   */
  async copyToGenerated(entityName) {
    try {
      const response = await fetch(`/api/seed/copy-to-generated/${entityName}`, { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        this.showMessage(`Copied ${data.copied} records to generated`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Copy failed', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
  },

  /**
   * Copy all imported to generated
   */
  async copyAllToGenerated() {
    try {
      const response = await fetch('/api/seed/copy-all-to-generated', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        const copied = Object.values(data.results).filter(r => r.copied > 0).length;
        this.showMessage(`Copied ${copied} files to generated`);
        await this.loadStatus();
        this.render();
      } else {
        this.showMessage(data.error || 'Copy failed', true);
      }
    } catch (err) {
      this.showMessage(err.message, true);
    }
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
    // Initialize generator dialog if needed
    if (typeof SeedGeneratorDialog !== 'undefined') {
      SeedGeneratorDialog.init('modal-container');
      await SeedGeneratorDialog.open(entityName);
    } else {
      this.showMessage('Generator dialog not loaded', true);
    }
  }
};
