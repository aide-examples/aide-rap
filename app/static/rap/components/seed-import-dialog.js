/**
 * Seed Import Dialog Component
 * Modal for importing seed data via paste or file drop
 * Auto-detects JSON vs CSV format
 * Shows preview with FK validation before saving
 */
const SeedImportDialog = {
  modalElement: null,
  entityName: null,
  parsedData: null,
  fkWarnings: [],
  invalidRows: [],
  validCount: 0,
  detectedFormat: null,
  conflicts: [],       // Records that would overwrite existing with back-refs
  selectedMode: 'merge', // 'merge' | 'replace' | 'skip_conflicts'

  /**
   * Initialize the import dialog
   */
  init(containerId) {
    // No longer uses container - creates own modal element
  },

  /**
   * Show the import dialog for an entity
   */
  show(entityName) {
    this.entityName = entityName;
    this.reset();
    this.render();
  },

  /**
   * Reset dialog state
   */
  reset() {
    this.parsedData = null;
    this.fkWarnings = [];
    this.invalidRows = [];
    this.validCount = 0;
    this.detectedFormat = null;
    this.conflicts = [];
    this.selectedMode = 'merge';
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

    // Create new modal element
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'modal-container active';
    this.modalElement.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-import-modal">
          <div class="modal-header">
            <h2>Import: ${this.entityName}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="import-toolbar">
              <div class="drop-zone-compact" id="import-drop-zone">
                <span class="drop-zone-icon">📁</span>
                <span class="drop-zone-text">Drop file or click</span>
              </div>
              <div class="import-tabs">
                <button class="import-tab active" data-tab="source">Source</button>
                <button class="import-tab" data-tab="preview">Preview</button>
              </div>
              <div class="import-toolbar-actions">
                <button class="btn-seed btn-parse" id="btn-parse">Preview</button>
              </div>
            </div>

            <div class="import-tab-content" id="tab-source">
              <textarea id="import-text-input" class="import-textarea"
                placeholder="Paste JSON or CSV data here..."></textarea>
            </div>

            <div class="import-tab-content" id="tab-preview" style="display: none;">
              <div id="import-preview" class="import-preview">
                <div class="import-preview-table" id="preview-table">
                  <div class="preview-empty">Paste data in Source tab, then click "Preview"</div>
                </div>
              </div>
            </div>

            <div id="import-status" class="import-status" style="display: none;">
              <span id="preview-info"></span>
              <div id="preview-warnings" class="preview-warnings"></div>
            </div>

            <div class="import-footer">
              <div class="import-footer-buttons">
                <button class="btn-seed btn-save-only" id="btn-save-only" disabled>Save only</button>
                <button class="btn-seed btn-save" id="btn-save" disabled>Save & Load</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <input type="file" id="import-file-input" accept=".json,.csv" style="display: none">
    `;

    document.body.appendChild(this.modalElement);
    this.attachEventHandlers();
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

    // Tab switching
    this.modalElement.querySelectorAll('.import-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Drop zone
    const dropZone = this.modalElement.querySelector('#import-drop-zone');
    const fileInput = this.modalElement.querySelector('#import-file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFile(file);
      e.target.value = '';
    });

    // Parse button
    this.modalElement.querySelector('#btn-parse')?.addEventListener('click', () => {
      const text = this.modalElement.querySelector('#import-text-input')?.value;
      if (text?.trim()) {
        this.parseInput(text);
      }
    });

    // Save & Load button
    this.modalElement.querySelector('#btn-save')?.addEventListener('click', () => {
      this.saveAndLoad();
    });

    // Save only button
    this.modalElement.querySelector('#btn-save-only')?.addEventListener('click', () => {
      this.saveOnly();
    });

    // Parse on Ctrl+Enter in textarea
    this.modalElement.querySelector('#import-text-input')?.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        const text = e.target.value;
        if (text?.trim()) {
          this.parseInput(text);
        }
      }
    });
  },

  /**
   * Switch between Source and Preview tabs
   */
  switchTab(tabName) {
    // Update tab buttons
    this.modalElement.querySelectorAll('.import-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    this.modalElement.querySelector('#tab-source').style.display = tabName === 'source' ? 'block' : 'none';
    this.modalElement.querySelector('#tab-preview').style.display = tabName === 'preview' ? 'block' : 'none';
  },

  /**
   * Handle file selection
   */
  async handleFile(file) {
    try {
      const text = await file.text();
      this.modalElement.querySelector('#import-text-input').value = text;
      this.parseInput(text);
    } catch (err) {
      this.showError(`Failed to read file: ${err.message}`);
    }
  },

  /**
   * Parse input text (JSON or CSV)
   */
  async parseInput(text) {
    this.detectedFormat = CsvParser.detectFormat(text);

    try {
      if (this.detectedFormat === 'json') {
        let data = JSON.parse(text);
        // Wrap single object in array
        if (!Array.isArray(data)) {
          data = [data];
        }
        this.parsedData = data;
      } else {
        this.parsedData = CsvParser.parse(text);
      }

      if (this.parsedData.length === 0) {
        this.showError('No records found in input');
        return;
      }

      // Validate with server
      await this.validateWithServer();
      this.renderPreview();
    } catch (err) {
      this.showError(`Parse error: ${err.message}`);
    }
  },

  /**
   * Validate import data with server (FK checks + conflict detection)
   */
  async validateWithServer() {
    try {
      const response = await fetch(`/api/seed/validate/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: this.parsedData })
      });
      const result = await response.json();
      this.fkWarnings = result.warnings || [];
      this.invalidRows = result.invalidRows || [];
      this.validCount = result.validCount ?? this.parsedData.length;
      this.conflicts = result.conflicts || [];
    } catch (err) {
      console.error('Validation error:', err);
      this.fkWarnings = [];
      this.invalidRows = [];
      this.validCount = this.parsedData.length;
      this.conflicts = [];
    }
  },

  /**
   * Render preview table
   */
  renderPreview() {
    const tableDiv = this.modalElement.querySelector('#preview-table');
    const statusDiv = this.modalElement.querySelector('#import-status');
    const infoDiv = this.modalElement.querySelector('#preview-info');
    const warningsDiv = this.modalElement.querySelector('#preview-warnings');

    if (!this.parsedData) return;

    // Show status bar and enable buttons
    statusDiv.style.display = 'flex';
    this.modalElement.querySelector('#btn-save').disabled = false;
    this.modalElement.querySelector('#btn-save-only').disabled = false;

    // Switch to preview tab
    this.switchTab('preview');

    // Info line - show valid/total if there are invalid records
    const formatLabel = this.detectedFormat === 'json' ? 'JSON' : 'CSV';
    const total = this.parsedData.length;
    const hasInvalid = this.invalidRows.length > 0;
    if (hasInvalid) {
      infoDiv.innerHTML = `<strong>${this.validCount} valid</strong> / ${total} total (${formatLabel})`;
    } else {
      infoDiv.textContent = `${total} records (${formatLabel})`;
    }

    // Build warning lookup: row -> field -> warning
    const warningLookup = {};
    for (const w of this.fkWarnings) {
      if (!warningLookup[w.row]) warningLookup[w.row] = {};
      warningLookup[w.row][w.field] = w;
    }

    // Build invalid row set for quick lookup
    const invalidRowSet = new Set(this.invalidRows);

    // Get columns from first record
    const columns = this.parsedData.length > 0 ? Object.keys(this.parsedData[0]) : [];

    // Limit preview to first 10 rows
    const previewRows = this.parsedData.slice(0, 10);

    // Build table
    const headerCells = columns.map(c => `<th>${DomUtils.escapeHtml(c)}</th>`).join('');
    const rows = previewRows.map((record, idx) => {
      const rowNum = idx + 1;
      const rowWarnings = warningLookup[rowNum] || {};
      const isInvalidRow = invalidRowSet.has(rowNum);

      const cells = columns.map(col => {
        const value = record[col];
        const warning = rowWarnings[col];
        const displayValue = value === null ? '' : String(value);

        if (warning) {
          return `<td class="fk-invalid" title="${DomUtils.escapeHtml(warning.message || '')}">${DomUtils.escapeHtml(displayValue)} ⚠</td>`;
        }
        return `<td>${DomUtils.escapeHtml(displayValue)}</td>`;
      }).join('');

      const rowClass = isInvalidRow ? 'class="invalid-row"' : '';
      return `<tr ${rowClass}>${cells}</tr>`;
    }).join('');

    tableDiv.innerHTML = `
      <table class="preview-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Show remaining count if truncated
    if (this.parsedData.length > 10) {
      tableDiv.innerHTML += `<div class="preview-truncated">... and ${this.parsedData.length - 10} more records</div>`;
    }

    // Warnings summary (FK warnings + conflicts)
    let warningHtml = '';

    // FK warnings
    if (this.fkWarnings.length > 0) {
      const uniqueWarnings = new Map();
      for (const w of this.fkWarnings) {
        const key = `${w.field}:${w.value}`;
        if (!uniqueWarnings.has(key)) {
          uniqueWarnings.set(key, w);
        }
      }

      const warningLines = Array.from(uniqueWarnings.values())
        .slice(0, 3)
        .map(w => `"${w.value}" not found in ${w.targetEntity}`)
        .join('<br>');

      warningHtml += `<div class="warning-section"><div class="warning-icon">⚠</div><div class="warning-text">${warningLines}`;
      if (uniqueWarnings.size > 3) {
        warningHtml += `<br><span class="warning-more">... and ${uniqueWarnings.size - 3} more FK warnings</span>`;
      }
      warningHtml += '</div></div>';
    }

    // Conflict warnings with mode selector
    if (this.conflicts.length > 0) {
      const conflictCount = this.conflicts.length;
      const totalBackRefs = this.conflicts.reduce((sum, c) => sum + c.backRefs, 0);

      warningHtml += `
        <div class="conflict-section">
          <div class="conflict-header">
            <span class="conflict-icon">🔗</span>
            <span class="conflict-text">${conflictCount} record(s) would overwrite existing data with ${totalBackRefs} back-reference(s)</span>
          </div>
          <div class="conflict-mode-selector">
            <label><input type="radio" name="import-mode" value="merge" ${this.selectedMode === 'merge' ? 'checked' : ''}> <strong>Merge</strong> - Update existing, add new (preserves IDs)</label>
            <label><input type="radio" name="import-mode" value="skip_conflicts" ${this.selectedMode === 'skip_conflicts' ? 'checked' : ''}> <strong>Skip</strong> - Only add new records</label>
            <label><input type="radio" name="import-mode" value="replace" ${this.selectedMode === 'replace' ? 'checked' : ''}> <strong>Replace</strong> - Overwrite all (may break references!)</label>
          </div>
        </div>
      `;
    }

    if (warningHtml) {
      warningsDiv.innerHTML = warningHtml;
      warningsDiv.style.display = 'block';

      // Attach mode selector handlers
      this.modalElement.querySelectorAll('input[name="import-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          this.selectedMode = e.target.value;
        });
      });
    } else {
      warningsDiv.style.display = 'none';
    }

    // Update button text to reflect valid count
    const saveBtn = this.modalElement.querySelector('#btn-save');
    if (saveBtn) {
      if (hasInvalid) {
        saveBtn.textContent = `Save & Load ${this.validCount}`;
      } else {
        saveBtn.textContent = 'Save & Load';
      }
    }
  },

  /**
   * Save data to seed file only (without loading into database)
   */
  async saveOnly() {
    if (!this.parsedData || this.parsedData.length === 0) {
      this.showError('No data to save');
      return;
    }

    try {
      const response = await fetch(`/api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.parsedData)
      });
      const result = await response.json();

      if (result.success) {
        this.hide();
        // Refresh seed manager if open
        if (typeof SeedManager !== 'undefined') {
          SeedManager.refresh();
        }
      } else {
        this.showError(result.error || 'Failed to save');
      }
    } catch (err) {
      this.showError(`Error: ${err.message}`);
    }
  },

  /**
   * Save data to server and load into database
   */
  async saveAndLoad() {
    if (!this.parsedData || this.parsedData.length === 0) {
      this.showError('No data to save');
      return;
    }

    try {
      // Step 1: Save to seed file
      const uploadResponse = await fetch(`/api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.parsedData)
      });
      const uploadResult = await uploadResponse.json();

      if (!uploadResult.success) {
        this.showError(uploadResult.error || 'Failed to save');
        return;
      }

      // Step 2: Load into database (skip invalid records, use selected mode)
      const loadResponse = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skipInvalid: true,
          mode: this.conflicts.length > 0 ? this.selectedMode : 'replace'
        })
      });
      const loadResult = await loadResponse.json();

      if (loadResult.success) {
        const hasErrors = loadResult.errors && loadResult.errors.length > 0;
        if (hasErrors && loadResult.loaded === 0) {
          this.showError(`Load failed: ${loadResult.errors[0]}`);
        } else if (hasErrors) {
          this.showError(loadResult.errors[0]);
        } else {
          this.hide();
          if (typeof SeedManager !== 'undefined') {
            SeedManager.refresh();
          }
        }
      } else {
        this.showError(loadResult.error || 'Saved but failed to load');
      }
    } catch (err) {
      this.showError(`Error: ${err.message}`);
    }
  },

  /**
   * Show error message
   */
  showError(message) {
    const tableDiv = this.modalElement.querySelector('#preview-table');
    const statusDiv = this.modalElement.querySelector('#import-status');

    // Switch to preview tab to show error
    this.switchTab('preview');

    if (tableDiv) {
      tableDiv.innerHTML = `<div class="import-error">${DomUtils.escapeHtml(message)}</div>`;
    }
    if (statusDiv) {
      statusDiv.style.display = 'none';
    }

    // Disable save buttons on error
    this.modalElement.querySelector('#btn-save').disabled = true;
    this.modalElement.querySelector('#btn-save-only').disabled = true;
  },

};
