/**
 * Seed Manager Component
 * Modal dialog for managing seed data - loading and clearing entity data
 */
const SeedManager = {
  container: null,
  isOpen: false,
  entities: [],

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

    const rows = this.entities.map((e, idx) => `
      <tr>
        <td class="level">${idx + 1}</td>
        <td class="entity-name">${e.name}</td>
        <td class="row-count">${e.rowCount}</td>
        <td class="seed-count">${e.seedFile ? e.seedCount : '--'}</td>
        <td class="actions">
          ${e.seedFile ? `<button class="btn-seed btn-load" data-entity="${e.name}">Load</button>` : ''}
          <button class="btn-seed btn-clear" data-entity="${e.name}" ${e.rowCount === 0 ? 'disabled' : ''}>Clear</button>
        </td>
      </tr>
    `).join('');

    this.container.innerHTML = `
      <div class="modal-overlay" data-action="close">
        <div class="modal-dialog seed-manager-modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>Seed Data Manager</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <p class="order-hint">Entities sorted by dependency (load top-to-bottom, clear bottom-to-top)</p>
            <table class="seed-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entity</th>
                  <th>Rows</th>
                  <th>Seed</th>
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

    // Bulk actions
    this.container.querySelector('.btn-load-all')?.addEventListener('click', () => this.loadAll());
    this.container.querySelector('.btn-clear-all')?.addEventListener('click', () => this.clearAll());
    this.container.querySelector('.btn-reset-all')?.addEventListener('click', () => this.resetAll());
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
  }
};
