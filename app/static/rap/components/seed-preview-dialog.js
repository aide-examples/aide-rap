/**
 * Seed Preview Dialog Component
 * Modal for previewing data before loading or exporting
 * - Load mode: Shows seed file content (what will be loaded into DB)
 * - Export mode: Shows current DB content (what will be exported)
 */
const SeedPreviewDialog = {
  modalElement: null,
  entityName: null,
  records: [],
  mode: null, // 'load' or 'export'
  onConfirm: null,

  /**
   * Initialize the preview dialog
   */
  init(containerId) {
    // No longer uses container - creates own modal element
  },

  /**
   * Show dialog for load preview (shows seed file content)
   */
  async showLoad(entityName, onConfirm) {
    this.entityName = entityName;
    this.mode = 'load';
    this.onConfirm = onConfirm;
    await this.loadSeedContent();
    this.render();
  },

  /**
   * Show dialog for export (shows current DB content)
   */
  async showExport(entityName) {
    this.entityName = entityName;
    this.mode = 'export';
    this.onConfirm = null;
    await this.loadDbContent();
    this.render();
  },

  /**
   * Load seed file content from server (for Load mode)
   */
  async loadSeedContent() {
    try {
      const response = await fetch(`/api/seed/content/${this.entityName}`);
      const data = await response.json();
      this.records = data.records || [];
    } catch (err) {
      console.error('Failed to load seed content:', err);
      this.records = [];
    }
  },

  /**
   * Load current DB content from server (for Export mode)
   * Transforms to portable format:
   * - Removes internal 'id'
   * - Replaces FK IDs (manufacturer_id: 3) with conceptual names (manufacturer: "Airbus")
   * - Removes computed _label and _display fields
   */
  async loadDbContent() {
    try {
      const response = await fetch(`/api/entities/${this.entityName}?limit=10000`);
      const data = await response.json();
      const rawRecords = data.data || [];

      this.records = rawRecords.map(record => {
        const cleaned = {};

        // First pass: identify FK columns by finding *_label fields with matching *_id fields
        // API returns: manufacturer_id (FK), manufacturer_label (display)
        // We want: manufacturer: "Airbus"
        const fkColumns = {};
        for (const [key, value] of Object.entries(record)) {
          if (key.endsWith('_label')) {
            const conceptualName = key.slice(0, -6); // remove '_label'
            const fkIdColumn = conceptualName + '_id';
            if (fkIdColumn in record) {
              fkColumns[conceptualName] = value; // Store label value
            }
          }
        }

        // Second pass: build cleaned record
        for (const [key, value] of Object.entries(record)) {
          if (key === 'id') continue; // Skip internal ID
          if (key.endsWith('_label') || key.endsWith('_display')) continue; // Skip computed fields
          if (key.endsWith('_id') && (key.slice(0, -3) in fkColumns)) continue; // Skip FK IDs (replaced by labels)
          cleaned[key] = value;
        }

        // Add FK conceptual names with label values
        for (const [conceptualName, labelValue] of Object.entries(fkColumns)) {
          cleaned[conceptualName] = labelValue;
        }

        return cleaned;
      });
    } catch (err) {
      console.error('Failed to load DB content:', err);
      this.records = [];
    }
  },

  /**
   * Hide the dialog
   */
  hide() {
    if (this.modalElement) {
      this.modalElement.remove();
      this.modalElement = null;
    }
  },

  /**
   * Render the dialog
   */
  render() {
    // Remove existing modal if any
    if (this.modalElement) {
      this.modalElement.remove();
    }

    const title = this.mode === 'load'
      ? `Load Preview: ${this.entityName}`
      : `Export: ${this.entityName}`;

    const sourceInfo = this.mode === 'load'
      ? `${this.records.length} records in seed file`
      : `${this.records.length} records in database`;

    const emptyMessage = this.mode === 'load'
      ? 'No records in seed file'
      : 'No records in database';

    const actionButtons = this.mode === 'load'
      ? `<button class="btn-seed btn-load-confirm" id="btn-confirm-load">Load ${this.records.length} Records</button>`
      : `
        <button class="btn-seed btn-export-json" id="btn-export-json">Export JSON</button>
        <button class="btn-seed btn-export-csv" id="btn-export-csv">Export CSV</button>
      `;

    // Create new modal element
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'modal-container active';
    this.modalElement.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-preview-modal">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="preview-info">
              ${sourceInfo}
            </div>
            <div class="seed-preview-container" id="preview-container">
              ${this.renderTable(emptyMessage)}
            </div>
          </div>
          <div class="modal-footer">
            ${actionButtons}
            <button class="btn-seed" data-action="close">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalElement);
    this.attachEventHandlers();
  },

  /**
   * Render preview table
   */
  renderTable(emptyMessage) {
    if (this.records.length === 0) {
      return `<div class="preview-empty">${emptyMessage}</div>`;
    }

    // Get columns from first record
    const columns = Object.keys(this.records[0]);

    // Limit preview to first 50 rows
    const previewRows = this.records.slice(0, 50);

    const headerCells = columns.map(c => `<th>${this.escapeHtml(c)}</th>`).join('');
    const rows = previewRows.map(record => {
      const cells = columns.map(col => {
        const value = record[col];
        const displayValue = value === null ? '<span class="null-value">null</span>' : this.escapeHtml(String(value));
        return `<td>${displayValue}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    let html = `
      <table class="seed-preview-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    if (this.records.length > 50) {
      html += `<div class="preview-truncated">... and ${this.records.length - 50} more records</div>`;
    }

    return html;
  },

  /**
   * Attach event handlers
   */
  attachEventHandlers() {
    // Modal dialog: do NOT close on overlay click
    // Dialog can only be closed via X button

    // Close button
    this.modalElement.querySelectorAll('.modal-close').forEach(el => {
      el.addEventListener('click', () => this.hide());
    });

    // Load confirm
    this.modalElement.querySelector('#btn-confirm-load')?.addEventListener('click', async () => {
      if (this.onConfirm) {
        this.hide();
        await this.onConfirm();
      }
    });

    // Export JSON
    this.modalElement.querySelector('#btn-export-json')?.addEventListener('click', () => {
      this.exportJson();
    });

    // Export CSV
    this.modalElement.querySelector('#btn-export-csv')?.addEventListener('click', () => {
      this.exportCsv();
    });
  },

  /**
   * Export as JSON file
   */
  exportJson() {
    const json = JSON.stringify(this.records, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    this.downloadBlob(blob, `${this.entityName}.json`);
  },

  /**
   * Export as CSV file
   */
  exportCsv() {
    if (this.records.length === 0) return;

    const columns = Object.keys(this.records[0]);

    // Header row
    const header = columns.map(c => this.escapeCsvField(c)).join(';');

    // Data rows
    const rows = this.records.map(record =>
      columns.map(col => this.escapeCsvField(record[col] ?? '')).join(';')
    );

    // BOM for Excel UTF-8 recognition
    const bom = '\uFEFF';
    const csv = bom + header + '\n' + rows.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    this.downloadBlob(blob, `${this.entityName}.csv`);
  },

  /**
   * Escape a field value for CSV
   */
  escapeCsvField(value) {
    const str = String(value);
    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  /**
   * Download a blob as file
   */
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.hide();
  },

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};
