/**
 * Unified Import Dialog Component
 * Tabs: Schema | Rule | Run | Load | Paste
 * Persistent log at bottom
 */
const SeedImportDialog = {
  modalElement: null,
  entityName: null,
  hasDefinition: false,
  logMessages: [],

  // Paste tab state
  parsedData: null,
  fkWarnings: [],
  invalidRows: [],
  validCount: 0,
  detectedFormat: null,
  conflicts: [],
  selectedMode: 'merge',

  // Load tab state
  importData: null,
  importConflicts: [],
  importMeta: null,  // { conflictCount, dbRowCount }
  previewLimit: 100,  // Default preview limit, null = show all

  // Rule tab state
  ruleOriginalContent: null,
  ruleModified: false,

  /**
   * Initialize the dialog (called from rap.js)
   */
  init(containerId) {
    // No persistent DOM needed - dialog is created on show()
  },

  /**
   * Show the import dialog for an entity
   */
  async show(entityName) {
    this.entityName = entityName;
    this.reset();
    await this.checkDefinition();
    this.render();
  },

  /**
   * Check if entity has import definition
   */
  async checkDefinition() {
    try {
      const res = await fetch(`/api/import/definition/${this.entityName}`);
      this.hasDefinition = res.ok;
    } catch {
      this.hasDefinition = false;
    }
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
    this.importData = null;
    this.importConflicts = [];
    this.importMeta = null;
    this.previewLimit = 100;
    this.logMessages = [];
    this.ruleOriginalContent = null;
    this.ruleModified = false;
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
   * Add message to log
   */
  log(type, message) {
    const icons = { success: '✓', warning: '⚠', error: '✗', info: 'ℹ' };
    this.logMessages.push({ type, message, icon: icons[type] || '•', time: new Date() });
    this.renderLog();
  },

  /**
   * Clear log
   */
  clearLog() {
    this.logMessages = [];
    this.renderLog();
  },

  /**
   * Render log container
   */
  renderLog() {
    const logDiv = this.modalElement?.querySelector('#import-log-content');
    if (!logDiv) return;

    if (this.logMessages.length === 0) {
      logDiv.innerHTML = '<div class="log-empty">No messages</div>';
      return;
    }

    logDiv.innerHTML = this.logMessages.map(m => `
      <div class="log-entry log-${m.type}">
        <span class="log-icon">${m.icon}</span>
        <span class="log-message">${DomUtils.escapeHtml(m.message)}</span>
      </div>
    `).join('');

    // Auto-scroll to bottom
    logDiv.scrollTop = logDiv.scrollHeight;
  },

  /**
   * Initialize resizer for split view
   */
  initResizer() {
    const resizer = this.modalElement.querySelector('#import-resizer');
    const container = this.modalElement.querySelector('.import-split-container');
    const contentArea = this.modalElement.querySelector('.import-content-area');
    const logContainer = this.modalElement.querySelector('.import-log-container');

    if (!resizer || !container || !contentArea || !logContainer) return;

    let isResizing = false;
    let startY = 0;
    let startContentHeight = 0;

    const onMouseDown = (e) => {
      isResizing = true;
      startY = e.clientY;
      startContentHeight = contentArea.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;

      const deltaY = e.clientY - startY;
      const containerHeight = container.offsetHeight;
      const newContentHeight = Math.max(100, Math.min(containerHeight - 80, startContentHeight + deltaY));
      const newLogHeight = containerHeight - newContentHeight - 6; // 6px for resizer

      contentArea.style.flex = 'none';
      contentArea.style.height = `${newContentHeight}px`;
      logContainer.style.flex = 'none';
      logContainer.style.height = `${newLogHeight}px`;
    };

    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    resizer.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  },

  /**
   * Render the dialog
   */
  render() {
    if (this.modalElement) {
      this.modalElement.remove();
    }

    const disabledClass = this.hasDefinition ? '' : 'disabled';
    const disabledAttr = this.hasDefinition ? '' : 'disabled';

    this.modalElement = document.createElement('div');
    this.modalElement.className = 'modal-container active';
    this.modalElement.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-import-modal unified-import">
          <div class="modal-header">
            <h2>Import: ${this.entityName}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="import-tabs-bar">
              <button class="import-tab ${disabledClass}" data-tab="schema" ${disabledAttr}>Schema</button>
              <button class="import-tab ${disabledClass}" data-tab="rule" ${disabledAttr}>Rule</button>
              <button class="import-tab ${disabledClass}" data-tab="run" ${disabledAttr}>Run</button>
              <button class="import-tab ${disabledClass}" data-tab="load" ${disabledAttr}>Load</button>
              <button class="import-tab active" data-tab="paste">Paste</button>
            </div>

            <div class="import-split-container">
              <div class="import-content-area">
                <div class="import-tab-content" id="tab-schema" style="display: none;">
              <div class="tab-content-scroll">
                <div id="schema-content" class="schema-content">
                  ${this.hasDefinition ? '<div class="loading">Loading schema...</div>' : '<div class="no-definition">No import definition</div>'}
                </div>
              </div>
            </div>

            <div class="import-tab-content" id="tab-rule" style="display: none;">
              <div class="rule-toolbar">
                <span class="rule-path" id="rule-path"></span>
                <button class="btn-seed btn-save-rule" id="btn-save-rule" disabled>Save</button>
              </div>
              <div id="rule-content" class="rule-content">
                ${this.hasDefinition
                  ? '<textarea id="rule-editor" class="rule-editor" placeholder="Loading..."></textarea>'
                  : '<div class="no-definition">No import definition</div>'}
              </div>
            </div>

            <div class="import-tab-content" id="tab-run" style="display: none;">
              <div class="tab-content-scroll">
                <div id="run-content" class="run-content">
                  ${this.hasDefinition ? `
                    <p>Convert XLSX source file to JSON import file.</p>
                    <button class="btn-seed btn-run-import" id="btn-run-import">Run Import (XLSX → JSON)</button>
                    <div id="run-result"></div>
                  ` : '<div class="no-definition">No import definition</div>'}
                </div>
              </div>
            </div>

            <div class="import-tab-content" id="tab-load" style="display: none;">
              <div class="tab-content-scroll">
                <div id="load-content" class="load-content">
                  ${this.hasDefinition ? `
                    <div class="load-toolbar">
                      <button class="btn-seed btn-load-preview" id="btn-load-preview">Preview</button>
                      <div class="load-mode-options" id="load-mode-options">
                        <label><input type="radio" name="load-mode" value="merge" checked> Merge</label>
                        <label><input type="radio" name="load-mode" value="skip_conflicts"> Skip</label>
                        <label><input type="radio" name="load-mode" value="replace"> Replace</label>
                      </div>
                      <button class="btn-seed" id="btn-export-json" disabled>Export JSON</button>
                      <button class="btn-seed" id="btn-export-csv" disabled>Export CSV</button>
                      <button class="btn-seed btn-save" id="btn-load-db">Load into Database</button>
                    </div>
                    <div id="load-preview"></div>
                  ` : '<div class="no-definition">No import definition</div>'}
                </div>
              </div>
            </div>

            <div class="import-tab-content" id="tab-paste" style="display: block;">
              <div class="paste-toolbar">
                <div class="drop-zone-compact" id="import-drop-zone">
                  <span class="drop-zone-icon">📁</span>
                  <span class="drop-zone-text">Drop file or click</span>
                </div>
                <div class="paste-tabs">
                  <button class="paste-tab active" data-paste-tab="source">Source</button>
                  <button class="paste-tab" data-paste-tab="preview">Preview</button>
                </div>
                <button class="btn-seed btn-parse" id="btn-parse">Parse</button>
              </div>

              <div class="paste-tab-content" id="paste-tab-source">
                <textarea id="import-text-input" class="import-textarea"
                  placeholder="Paste JSON or CSV data here..."></textarea>
              </div>

              <div class="paste-tab-content" id="paste-tab-preview" style="display: none;">
                <div id="paste-preview" class="import-preview">
                  <div class="preview-empty">Paste data, then click "Parse"</div>
                </div>
              </div>

              <div id="paste-status" class="import-status" style="display: none;">
                <span id="paste-info"></span>
                <div id="paste-warnings" class="preview-warnings"></div>
              </div>

              <div class="paste-actions" id="paste-actions" style="display: none;">
                <button class="btn-seed btn-save-only" id="btn-save-only">Save only</button>
                <button class="btn-seed btn-save" id="btn-save">Save & Load</button>
              </div>
            </div>
              </div>

              <div class="import-resizer" id="import-resizer"></div>

              <div class="import-log-container">
                <div class="import-log-header">
                  <span>Log</span>
                  <button class="btn-clear-log" id="btn-clear-log">Clear</button>
                </div>
                <div class="import-log-content" id="import-log-content">
                  <div class="log-empty">No messages</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <input type="file" id="import-file-input" accept=".json,.csv" style="display: none">
    `;

    document.body.appendChild(this.modalElement);
    this.attachEventHandlers();

    // Load initial data if definition exists
    if (this.hasDefinition) {
      this.loadSchema();
      this.loadRule();
    }
  },

  /**
   * Attach event handlers
   */
  attachEventHandlers() {
    // Close button
    this.modalElement.querySelector('.modal-close')?.addEventListener('click', () => this.hide());

    // Main tab switching
    this.modalElement.querySelectorAll('.import-tabs-bar .import-tab:not(.disabled)').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Paste sub-tabs
    this.modalElement.querySelectorAll('.paste-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchPasteTab(tab.dataset.pasteTab));
    });

    // Clear log
    this.modalElement.querySelector('#btn-clear-log')?.addEventListener('click', () => this.clearLog());

    // Resizer for split view
    this.initResizer();

    // Drop zone
    const dropZone = this.modalElement.querySelector('#import-drop-zone');
    const fileInput = this.modalElement.querySelector('#import-file-input');

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.handleFile(e.dataTransfer.files[0]);
    });
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
      e.target.value = '';
    });

    // Parse button
    this.modalElement.querySelector('#btn-parse')?.addEventListener('click', () => {
      const text = this.modalElement.querySelector('#import-text-input')?.value;
      if (text?.trim()) this.parseInput(text);
    });

    // Paste: Save & Load
    this.modalElement.querySelector('#btn-save')?.addEventListener('click', () => this.saveAndLoad());
    this.modalElement.querySelector('#btn-save-only')?.addEventListener('click', () => this.saveOnly());

    // Run Import button
    this.modalElement.querySelector('#btn-run-import')?.addEventListener('click', () => this.runImport());

    // Load Preview button
    this.modalElement.querySelector('#btn-load-preview')?.addEventListener('click', () => this.loadPreview());

    // Load into DB button
    this.modalElement.querySelector('#btn-load-db')?.addEventListener('click', () => this.loadIntoDb());

    // Export buttons
    this.modalElement.querySelector('#btn-export-json')?.addEventListener('click', () => this.exportImportJson());
    this.modalElement.querySelector('#btn-export-csv')?.addEventListener('click', () => this.exportImportCsv());

    // Rule editor
    const ruleEditor = this.modalElement.querySelector('#rule-editor');
    ruleEditor?.addEventListener('input', () => this.onRuleEditorChange());
    this.modalElement.querySelector('#btn-save-rule')?.addEventListener('click', () => this.saveRule());

    // Ctrl+Enter in textarea
    this.modalElement.querySelector('#import-text-input')?.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        const text = e.target.value;
        if (text?.trim()) this.parseInput(text);
      }
    });
  },

  /**
   * Switch main tabs
   */
  switchTab(tabName) {
    this.modalElement.querySelectorAll('.import-tabs-bar .import-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    ['schema', 'rule', 'run', 'load', 'paste'].forEach(name => {
      const el = this.modalElement.querySelector(`#tab-${name}`);
      if (el) el.style.display = name === tabName ? 'block' : 'none';
    });
  },

  /**
   * Switch paste sub-tabs
   */
  switchPasteTab(tabName) {
    this.modalElement.querySelectorAll('.paste-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.pasteTab === tabName);
    });

    this.modalElement.querySelector('#paste-tab-source').style.display = tabName === 'source' ? 'block' : 'none';
    this.modalElement.querySelector('#paste-tab-preview').style.display = tabName === 'preview' ? 'block' : 'none';
  },

  // ========== SCHEMA TAB ==========

  async loadSchema() {
    const contentDiv = this.modalElement.querySelector('#schema-content');
    try {
      const res = await fetch(`/api/import/schema/${this.entityName}`);
      const data = await res.json();

      if (data.error) {
        contentDiv.innerHTML = `<div class="schema-error">${DomUtils.escapeHtml(data.error)}</div>`;
        this.log('error', `Schema: ${data.error}`);
        return;
      }

      contentDiv.innerHTML = `
        <div class="schema-info">
          <strong>Source:</strong> ${DomUtils.escapeHtml(data.sourceFile)}<br>
          <strong>Sheet:</strong> ${DomUtils.escapeHtml(data.sheet)}
        </div>
        <div class="schema-columns">
          <strong>Columns (${data.columns.length}):</strong>
          <ul>
            ${data.columns.map(c => `<li>${DomUtils.escapeHtml(c)}</li>`).join('')}
          </ul>
        </div>
      `;
      this.log('success', `Schema loaded: ${data.columns.length} columns`);
    } catch (err) {
      contentDiv.innerHTML = `<div class="schema-error">Failed to load schema</div>`;
      this.log('error', `Schema: ${err.message}`);
    }
  },

  // ========== RULE TAB ==========

  async loadRule() {
    const editor = this.modalElement.querySelector('#rule-editor');
    const pathSpan = this.modalElement.querySelector('#rule-path');
    const saveBtn = this.modalElement.querySelector('#btn-save-rule');

    if (!editor) return;

    try {
      const res = await fetch(`/api/import/definition/${this.entityName}/raw`);
      const data = await res.json();

      if (data.error) {
        editor.value = '';
        editor.placeholder = data.error;
        editor.disabled = true;
        return;
      }

      editor.value = data.content;
      this.ruleOriginalContent = data.content;
      this.ruleModified = false;
      pathSpan.textContent = data.path;
      saveBtn.disabled = true;
      this.log('info', 'Rule definition loaded');

      // Run validation
      this.validateRule();
    } catch (err) {
      editor.value = '';
      editor.placeholder = 'Failed to load definition';
      editor.disabled = true;
      this.log('error', `Rule: ${err.message}`);
    }
  },

  onRuleEditorChange() {
    const editor = this.modalElement.querySelector('#rule-editor');
    const saveBtn = this.modalElement.querySelector('#btn-save-rule');

    if (!editor || !saveBtn) return;

    this.ruleModified = editor.value !== this.ruleOriginalContent;
    saveBtn.disabled = !this.ruleModified;
  },

  async validateRule() {
    try {
      const res = await fetch(`/api/import/validate/${this.entityName}`);
      const result = await res.json();

      if (result.error) {
        this.log('warning', `Validation: ${result.error}`);
        return;
      }

      // Report source errors (columns in mapping not found in XLSX)
      for (const err of result.sourceErrors || []) {
        this.log('error', `Source: ${err.message}`);
      }

      // Report target errors (columns in mapping not found in entity)
      for (const err of result.targetErrors || []) {
        this.log('error', `Target: ${err.message}`);
      }

      // Report unused source columns
      if (result.unusedSourceColumns?.length > 0) {
        this.log('info', `Unused source columns: ${result.unusedSourceColumns.join(', ')}`);
      }

      // Report unmapped optional target columns
      if (result.unmappedTargetColumns?.length > 0) {
        this.log('info', `Unmapped optional columns: ${result.unmappedTargetColumns.join(', ')}`);
      }

      if (result.valid) {
        this.log('success', `Mapping valid: ${result.mappingCount || '?'} columns mapped`);
      }
    } catch (err) {
      this.log('warning', `Validation failed: ${err.message}`);
    }
  },

  async saveRule() {
    const editor = this.modalElement.querySelector('#rule-editor');
    const saveBtn = this.modalElement.querySelector('#btn-save-rule');

    if (!editor || !this.ruleModified) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const res = await fetch(`/api/import/definition/${this.entityName}/raw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editor.value })
      });
      const result = await res.json();

      if (result.error) {
        this.log('error', `Save failed: ${result.error}`);
      } else {
        this.ruleOriginalContent = editor.value;
        this.ruleModified = false;
        this.log('success', 'Rule saved');
        // Re-run validation after save
        this.validateRule();
      }
    } catch (err) {
      this.log('error', `Save failed: ${err.message}`);
    }

    saveBtn.textContent = 'Save';
    saveBtn.disabled = !this.ruleModified;
  },

  // ========== RUN TAB ==========

  async runImport() {
    const resultDiv = this.modalElement.querySelector('#run-result');
    const btn = this.modalElement.querySelector('#btn-run-import');

    btn.disabled = true;
    btn.textContent = 'Running...';
    resultDiv.innerHTML = '<div class="loading">Processing XLSX...</div>';
    this.log('info', 'Starting XLSX → JSON conversion...');

    try {
      const res = await fetch(`/api/import/run/${this.entityName}`, { method: 'POST' });
      const result = await res.json();

      if (result.success) {
        let details = `Records read: ${result.recordsRead}<br>`;
        if (result.recordsSourceFiltered > 0) {
          details += `Source filtered: ${result.recordsSourceFiltered}<br>`;
        }
        if (result.recordsDeduplicated > 0) {
          details += `Deduplicated (First): ${result.recordsDeduplicated}<br>`;
        }
        if (result.recordsFiltered > 0) {
          details += `Target filtered: ${result.recordsFiltered}<br>`;
        }
        details += `Records written: ${result.recordsWritten}<br>`;
        details += `Output: ${result.outputFile}`;

        resultDiv.innerHTML = `
          <div class="run-success">
            <strong>Success!</strong><br>
            ${details}
          </div>
        `;
        this.log('success', `Import complete: ${result.recordsWritten} records written`);

        // Auto-switch to Load tab and show preview
        btn.disabled = false;
        btn.textContent = 'Run Import (XLSX → JSON)';
        this.switchTab('load');
        this.loadPreview();
        return;
      } else {
        resultDiv.innerHTML = `<div class="run-error">${DomUtils.escapeHtml(result.error)}</div>`;
        this.log('error', `Import failed: ${result.error}`);
      }
    } catch (err) {
      resultDiv.innerHTML = `<div class="run-error">${DomUtils.escapeHtml(err.message)}</div>`;
      this.log('error', `Import error: ${err.message}`);
    }

    btn.disabled = false;
    btn.textContent = 'Run Import (XLSX → JSON)';
  },

  // ========== LOAD TAB ==========

  async loadPreview() {
    const previewDiv = this.modalElement.querySelector('#load-preview');
    const btn = this.modalElement.querySelector('#btn-load-preview');

    btn.disabled = true;
    previewDiv.innerHTML = '<div class="loading">Loading import data...</div>';
    this.log('info', 'Loading import file preview...');

    try {
      const res = await fetch(`/api/seed/content/${this.entityName}?sourceDir=import`);
      const data = await res.json();

      if (data.error) {
        previewDiv.innerHTML = `<div class="load-error">${DomUtils.escapeHtml(data.error)}</div>`;
        this.log('error', data.error);
        btn.disabled = false;
        return;
      }

      this.importData = data.records || [];
      this.importConflicts = data.conflictCount > 0 ? (data.conflicts || []) : [];
      this.importMeta = { conflictCount: data.conflictCount || 0, dbRowCount: data.dbRowCount || 0 };

      if (this.importData.length === 0) {
        previewDiv.innerHTML = '<div class="load-empty">No import data available. Run import first.</div>';
        this.log('warning', 'No import data found');
        btn.disabled = false;
        return;
      }

      this.renderLoadPreview();
      this.log('success', `Preview: ${this.importData.length} records`);

      // Enable export buttons
      const exportJsonBtn = this.modalElement.querySelector('#btn-export-json');
      const exportCsvBtn = this.modalElement.querySelector('#btn-export-csv');
      if (exportJsonBtn) exportJsonBtn.disabled = false;
      if (exportCsvBtn) exportCsvBtn.disabled = false;
    } catch (err) {
      previewDiv.innerHTML = `<div class="load-error">${DomUtils.escapeHtml(err.message)}</div>`;
      this.log('error', err.message);
    }

    btn.disabled = false;
  },

  renderLoadPreview() {
    const previewDiv = this.modalElement.querySelector('#load-preview');
    if (!this.importData?.length) return;

    // Show conflict info in preview
    const meta = this.importMeta || {};
    const conflictInfo = meta.conflictCount > 0
      ? `🔗 ${meta.conflictCount} record(s) would overwrite existing data`
      : `📥 ${meta.dbRowCount || 0} existing records in database`;

    // Use DialogUtils for table rendering
    const tableHtml = DialogUtils.renderDataTable(this.importData, {
      limit: this.previewLimit,
      showAllButton: true,
      showAllId: 'btn-show-all',
      replaceUnderscores: true
    });

    const html = `
      <div class="load-info">${this.importData.length} records in import file — ${conflictInfo}</div>
      ${tableHtml}
    `;

    previewDiv.innerHTML = html;

    // Attach "Show All" button handler
    previewDiv.querySelector('#btn-show-all')?.addEventListener('click', () => {
      this.previewLimit = null;
      this.renderLoadPreview();
    });
  },

  async loadIntoDb() {
    const btn = this.modalElement.querySelector('#btn-load-db');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading...';
    }

    const modeRadio = this.modalElement.querySelector('input[name="load-mode"]:checked');
    const mode = modeRadio?.value || 'merge';

    this.log('info', `Loading into database (mode: ${mode})...`);

    try {
      const res = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDir: 'import', mode, skipInvalid: true })
      });
      const result = await res.json();

      if (result.success) {
        this.log('success', `Loaded: ${result.loaded} records`);
        if (result.updated) this.log('info', `Updated: ${result.updated} records`);
        if (result.skipped) this.log('info', `Skipped: ${result.skipped} records`);

        // Refresh seed manager
        if (typeof SeedManager !== 'undefined') {
          SeedManager.refresh();
        }
      } else {
        this.log('error', result.error || 'Load failed');
      }

      // Show FK resolution errors prominently (aggregated by unique value)
      if (result.fkErrors?.length > 0) {
        const totalRecords = result.fkErrorsTotal || result.fkErrors.reduce((sum, e) => sum + (e.count || 1), 0);
        const uniqueErrors = result.fkErrors.length;
        this.log('warning', `FK resolution failed: ${uniqueErrors} invalid value(s) affecting ${totalRecords} record(s)`);
        result.fkErrors.forEach(e => this.log('error', e.message));
      }

      if (result.errors?.length > 0) {
        result.errors.slice(0, 5).forEach(e => this.log('error', e));
      }
    } catch (err) {
      this.log('error', err.message);
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Load into Database';
    }
  },

  // ========== PASTE TAB ==========

  async handleFile(file) {
    try {
      const text = await file.text();
      this.modalElement.querySelector('#import-text-input').value = text;
      this.parseInput(text);
    } catch (err) {
      this.log('error', `File read failed: ${err.message}`);
    }
  },

  async parseInput(text) {
    this.detectedFormat = CsvParser.detectFormat(text);
    this.log('info', `Parsing ${this.detectedFormat.toUpperCase()}...`);

    try {
      if (this.detectedFormat === 'json') {
        let data = JSON.parse(text);
        if (!Array.isArray(data)) data = [data];
        this.parsedData = data;
      } else {
        this.parsedData = CsvParser.parse(text);
      }

      if (this.parsedData.length === 0) {
        this.log('error', 'No records found');
        return;
      }

      await this.validateWithServer();
      this.renderPastePreview();
      this.log('success', `Parsed: ${this.parsedData.length} records`);
    } catch (err) {
      this.log('error', `Parse error: ${err.message}`);
    }
  },

  async validateWithServer() {
    try {
      const res = await fetch(`/api/seed/validate/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: this.parsedData })
      });
      const result = await res.json();
      this.fkWarnings = result.warnings || [];
      this.invalidRows = result.invalidRows || [];
      this.validCount = result.validCount ?? this.parsedData.length;
      this.conflicts = result.conflicts || [];

      if (this.fkWarnings.length > 0) {
        this.log('warning', `${this.fkWarnings.length} FK warnings`);
      }
      if (this.conflicts.length > 0) {
        this.log('warning', `${this.conflicts.length} conflicts detected`);
      }
    } catch (err) {
      this.fkWarnings = [];
      this.invalidRows = [];
      this.validCount = this.parsedData.length;
      this.conflicts = [];
    }
  },

  renderPastePreview() {
    const previewDiv = this.modalElement.querySelector('#paste-preview');
    const statusDiv = this.modalElement.querySelector('#paste-status');
    const infoDiv = this.modalElement.querySelector('#paste-info');
    const warningsDiv = this.modalElement.querySelector('#paste-warnings');
    const actionsDiv = this.modalElement.querySelector('#paste-actions');

    if (!this.parsedData) return;

    statusDiv.style.display = 'flex';
    actionsDiv.style.display = 'block';
    this.switchPasteTab('preview');

    // Info
    const formatLabel = this.detectedFormat === 'json' ? 'JSON' : 'CSV';
    const total = this.parsedData.length;
    const hasInvalid = this.invalidRows.length > 0;
    infoDiv.innerHTML = hasInvalid
      ? `<strong>${this.validCount} valid</strong> / ${total} total (${formatLabel})`
      : `${total} records (${formatLabel})`;

    // Warning lookup
    const warningLookup = {};
    for (const w of this.fkWarnings) {
      if (!warningLookup[w.row]) warningLookup[w.row] = {};
      warningLookup[w.row][w.field] = w;
    }
    const invalidRowSet = new Set(this.invalidRows);

    // Table
    const columns = this.parsedData.length > 0 ? Object.keys(this.parsedData[0]) : [];
    const previewRows = this.parsedData.slice(0, 10);

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

      return `<tr ${isInvalidRow ? 'class="invalid-row"' : ''}>${cells}</tr>`;
    }).join('');

    previewDiv.innerHTML = `
      <table class="preview-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    if (this.parsedData.length > 10) {
      previewDiv.innerHTML += `<div class="preview-truncated">... and ${this.parsedData.length - 10} more</div>`;
    }

    // Warnings
    let warningHtml = '';
    if (this.fkWarnings.length > 0) {
      const uniqueWarnings = new Map();
      for (const w of this.fkWarnings) {
        const key = `${w.field}:${w.value}`;
        if (!uniqueWarnings.has(key)) uniqueWarnings.set(key, w);
      }
      const lines = Array.from(uniqueWarnings.values()).slice(0, 3)
        .map(w => `"${w.value}" not found in ${w.targetEntity}`).join('<br>');
      warningHtml += `<div class="warning-section"><div class="warning-icon">⚠</div><div class="warning-text">${lines}`;
      if (uniqueWarnings.size > 3) warningHtml += `<br><span class="warning-more">... and ${uniqueWarnings.size - 3} more</span>`;
      warningHtml += '</div></div>';
    }

    if (this.conflicts.length > 0) {
      const totalBackRefs = this.conflicts.reduce((sum, c) => sum + c.backRefs, 0);
      warningHtml += `
        <div class="conflict-section">
          <div class="conflict-header">
            <span class="conflict-icon">🔗</span>
            <span class="conflict-text">${this.conflicts.length} conflict(s), ${totalBackRefs} back-ref(s)</span>
          </div>
          <div class="conflict-mode-selector">
            <label><input type="radio" name="paste-mode" value="merge" ${this.selectedMode === 'merge' ? 'checked' : ''}> Merge</label>
            <label><input type="radio" name="paste-mode" value="skip_conflicts" ${this.selectedMode === 'skip_conflicts' ? 'checked' : ''}> Skip</label>
            <label><input type="radio" name="paste-mode" value="replace" ${this.selectedMode === 'replace' ? 'checked' : ''}> Replace</label>
          </div>
        </div>
      `;
    }

    warningsDiv.innerHTML = warningHtml;
    warningsDiv.style.display = warningHtml ? 'block' : 'none';

    // Mode selector handler
    this.modalElement.querySelectorAll('input[name="paste-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => { this.selectedMode = e.target.value; });
    });

    // Update button text
    const saveBtn = this.modalElement.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.textContent = hasInvalid ? `Save & Load ${this.validCount}` : 'Save & Load';
    }
  },

  async saveOnly() {
    if (!this.parsedData?.length) return;

    this.log('info', 'Saving to seed file...');
    try {
      const res = await fetch(`/api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.parsedData)
      });
      const result = await res.json();

      if (result.success) {
        this.log('success', 'Saved to seed file');
        if (typeof SeedManager !== 'undefined') SeedManager.refresh();
      } else {
        this.log('error', result.error || 'Save failed');
      }
    } catch (err) {
      this.log('error', err.message);
    }
  },

  async saveAndLoad() {
    if (!this.parsedData?.length) return;

    this.log('info', 'Saving and loading...');
    try {
      // Save
      const uploadRes = await fetch(`/api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.parsedData)
      });
      const uploadResult = await uploadRes.json();

      if (!uploadResult.success) {
        this.log('error', uploadResult.error || 'Save failed');
        return;
      }
      this.log('success', 'Saved to seed file');

      // Load
      const mode = this.conflicts.length > 0 ? this.selectedMode : 'replace';
      const loadRes = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipInvalid: true, mode })
      });
      const loadResult = await loadRes.json();

      if (loadResult.success) {
        this.log('success', `Loaded: ${loadResult.loaded} records`);
        if (typeof SeedManager !== 'undefined') SeedManager.refresh();
      } else {
        this.log('error', loadResult.error || 'Load failed');
      }

      if (loadResult.errors?.length > 0) {
        loadResult.errors.slice(0, 3).forEach(e => this.log('error', e));
      }
    } catch (err) {
      this.log('error', err.message);
    }
  },

  // ========== EXPORT (using DialogUtils) ==========

  /**
   * Export import data as JSON file
   */
  exportImportJson() {
    if (!this.importData?.length) {
      this.log('warning', 'No data to export');
      return;
    }
    DialogUtils.exportJson(this.importData, `${this.entityName}_import.json`);
    this.log('success', `Exported ${this.importData.length} records as JSON`);
  },

  /**
   * Export import data as CSV file
   */
  exportImportCsv() {
    if (!this.importData?.length) {
      this.log('warning', 'No data to export');
      return;
    }
    DialogUtils.exportCsv(this.importData, `${this.entityName}_import.csv`);
    this.log('success', `Exported ${this.importData.length} records as CSV`);
  }
};
