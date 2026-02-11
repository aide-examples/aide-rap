/**
 * Seed Generator/Completer Dialog
 * Modal for seed data operations with 4 navigable tabs:
 * - Instruction: Edit AI instruction (## Data Generator / ## Data Completer)
 * - Prompt: Build AI prompt, copy to clipboard
 * - Response: Paste AI response, parse & validate
 * - Load: Preview data, export, load into database
 *
 * Entry modes:
 * - 'generate': Opens at Instruction tab, uses ## Data Generator
 * - 'complete': Opens at Instruction tab, uses ## Data Completer
 * - 'export': Opens at Load tab with current DB data
 */
const SeedGeneratorDialog = {
  container: null,
  entityName: null,
  entryMode: 'generate',  // 'generate', 'complete', or 'export'
  instructionType: 'generator',  // 'generator' or 'completer'
  schema: null,
  instruction: '',
  generatedData: null,
  lastPrompt: null,
  activeTab: 'instruction',  // instruction, prompt, response, load
  hasInstruction: false,
  hasSeedFile: false,
  seedFileCount: 0,
  emptyFKs: [],
  seedOnlyFKs: [], // FK entities with data only in seed files (not loaded in DB)
  // Validation state (populated by /api/seed/parse)
  seedFallbacks: [], // FK entities resolved from seed files during validation
  fkWarnings: [],
  invalidRows: [],
  validCount: 0,
  conflicts: [],
  selectedMode: 'merge',
  // Load tab state
  dbRowCount: 0,
  conflictCount: 0,

  /**
   * Initialize the dialog
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  /**
   * Open the dialog for an entity
   * @param {string} entityName - Entity name
   * @param {string} entryMode - 'generate', 'complete', or 'export'
   */
  async open(entityName, entryMode = 'generate') {
    this.entityName = entityName;
    this.entryMode = entryMode;
    this.generatedData = null;
    this.lastPrompt = null;
    this.resetValidation();

    // Load schema
    this.schema = await SchemaCache.getExtended(entityName);

    // Check if seed file exists
    await this.checkSeedFileExists();

    if (entryMode === 'export') {
      // Export: load DB data, go directly to Load tab
      await this.loadDbContent();
      this.instructionType = null;
      this.activeTab = 'load';
    } else {
      // Generate/Complete: load instruction
      this.instructionType = entryMode === 'complete' ? 'completer' : 'generator';
      await this.loadInstruction();
      this.activeTab = 'instruction';
    }

    this.render();
  },

  /**
   * Check if seed file exists and get record count
   */
  async checkSeedFileExists() {
    try {
      const resp = await fetch(`api/seed/content/${this.entityName}?checkOnly=true`);
      const data = await resp.json();
      this.hasSeedFile = data.exists || false;
      this.seedFileCount = data.count || 0;
    } catch (e) {
      this.hasSeedFile = false;
      this.seedFileCount = 0;
    }
  },

  /**
   * Load instruction from entity markdown
   */
  async loadInstruction() {
    const endpoint = this.instructionType === 'completer'
      ? `api/entity/${this.entityName}/completer-instruction`
      : `api/entity/${this.entityName}/generator-instruction`;
    try {
      const resp = await fetch(endpoint);
      const data = await resp.json();
      this.instruction = data.instruction || '';
      this.hasInstruction = data.hasInstruction || false;
    } catch (e) {
      this.instruction = '';
      this.hasInstruction = false;
    }
  },

  /**
   * Reset validation state
   */
  resetValidation() {
    this.emptyFKs = [];
    this.seedOnlyFKs = [];
    this.seedFallbacks = [];
    this.fkWarnings = [];
    this.invalidRows = [];
    this.validCount = 0;
    this.conflicts = [];
    this.selectedMode = 'merge';
    this.dbRowCount = 0;
    this.conflictCount = 0;
  },

  /**
   * Close the dialog
   */
  close() {
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('active');
    }
    this.entityName = null;
    this.generatedData = null;
  },

  /**
   * Render the dialog
   */
  render() {
    if (!this.container) return;

    const areaColor = this.schema?.areaColor || '#f5f5f5';

    // Entry mode labels for title
    const modeLabels = {
      'generate': 'Generate',
      'complete': 'Complete',
      'export': 'Export'
    };
    const modeLabel = modeLabels[this.entryMode] || 'Seed';

    // Tab enable/disable logic
    const canPrompt = this.hasInstruction || this.instruction?.trim();
    const canResponse = !!this.lastPrompt;
    const canLoad = this.hasSeedFile || (this.generatedData && this.generatedData.length > 0);

    // Record count badge for Load tab
    const loadCount = this.generatedData?.length || this.seedFileCount || 0;
    const loadBadge = loadCount > 0 ? ` (${loadCount})` : '';

    const tabBar = `
      <div class="generator-tabs">
        <button class="generator-tab ${this.activeTab === 'instruction' ? 'active' : ''}"
                data-tab="instruction"
                ${this.entryMode === 'export' ? 'disabled' : ''}>
          1. Instruction
        </button>
        <button class="generator-tab ${this.activeTab === 'prompt' ? 'active' : ''}"
                data-tab="prompt"
                ${!canPrompt || this.entryMode === 'export' ? 'disabled' : ''}>
          2. Prompt
        </button>
        <button class="generator-tab ${this.activeTab === 'response' ? 'active' : ''}"
                data-tab="response"
                ${!canResponse || this.entryMode === 'export' ? 'disabled' : ''}>
          3. Response
        </button>
        <button class="generator-tab ${this.activeTab === 'load' ? 'active' : ''} ${canLoad ? 'has-data' : ''}"
                data-tab="load"
                ${!canLoad ? 'disabled' : ''}>
          4. Load${loadBadge}
        </button>
      </div>
    `;

    this.container.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-generator-dialog">
          <div class="modal-header" style="background-color: ${areaColor};">
            <h2>${modeLabel}: ${this.entityName}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>

          ${tabBar}

          <div class="modal-body">
            ${this.renderTabContent()}
          </div>

          <div class="modal-footer">
            ${this.renderFooterButtons()}
          </div>
        </div>
      </div>
    `;

    this.container.classList.add('active');
    this.attachEventHandlers();
  },

  /**
   * Render content for the active tab
   */
  renderTabContent() {
    switch (this.activeTab) {
      case 'instruction':
        return this.renderInstructionTab();
      case 'prompt':
        return this.renderPromptTab();
      case 'response':
        return this.renderResponseTab();
      case 'load':
        return this.renderLoadTab();
      default:
        return '';
    }
  },

  /**
   * Render Instruction tab content
   */
  renderInstructionTab() {
    const sectionName = this.instructionType === 'completer' ? 'Data Completer' : 'Data Generator';
    const statusText = this.hasInstruction
      ? `✓ ${sectionName} instruction found in Markdown`
      : `No ${sectionName} instruction defined yet — write one below.`;
    const placeholder = this.instructionType === 'completer'
      ? 'Describe which fields to fill and how...'
      : 'Describe what data to generate...';
    return `
      <div class="tab-content-instruction">
        <div class="instruction-status ${this.hasInstruction ? 'has-instruction' : 'no-instruction'}">
          ${statusText}
        </div>
        <textarea id="generator-instruction" rows="6" placeholder="${placeholder}">${DomUtils.escapeHtml(this.instruction)}</textarea>
      </div>
    `;
  },

  /**
   * Render Prompt tab content
   */
  renderPromptTab() {
    return `
      <div class="tab-content-prompt-paste">
        ${this.emptyFKs.length > 0 ? `
          <div class="fk-dependency-warning">⚠ No data for: ${this.emptyFKs.join(', ')} — FK references will be unresolvable.</div>
        ` : ''}
        ${this.seedOnlyFKs.length > 0 ? `
          <div class="fk-dependency-warning seed-only">⚠ ${this.seedOnlyFKs.join(', ')} — not loaded in DB, using seed files. Load dependencies first or use "Load All".</div>
        ` : ''}
        <div class="prompt-section">
          <div class="prompt-section-header">
            <span class="prompt-section-label">${i18n.t('sg_ai_prompt')}</span>
            ${DomUtils.renderAILinks(!!this.lastPrompt)}
          </div>
          <textarea id="llm-prompt-text" readonly rows="8" placeholder="${i18n.t('sg_prompt_placeholder')}">${DomUtils.escapeHtml(this.lastPrompt || '')}</textarea>
        </div>
      </div>
    `;
  },

  /**
   * Render Response tab content (paste AI output, parse & validate)
   */
  renderResponseTab() {
    return `
      <div class="tab-content-response" id="paste-drop-zone">
        <div class="paste-section-header">
          <span class="paste-section-label">${i18n.t('sg_ai_response')}</span>
        </div>
        <textarea id="ai-response-text" rows="12" placeholder="${i18n.t('sg_response_placeholder')}"></textarea>
      </div>
    `;
  },

  /**
   * Render Load tab content (preview, export, load)
   */
  renderLoadTab() {
    // If no data, show hint
    if (!this.generatedData && !this.hasSeedFile) {
      return `
        <div class="tab-content-load empty-state">
          <p>No data available. Either:</p>
          <ul>
            <li>Complete the Instruction → Prompt → Response workflow</li>
            <li>Or load an existing seed file</li>
          </ul>
        </div>
      `;
    }

    // If we have seed file but no loaded data yet, offer to load it
    if (!this.generatedData && this.hasSeedFile) {
      return `
        <div class="tab-content-load">
          <div class="seed-file-info">
            <p>Seed file contains ${this.seedFileCount} record${this.seedFileCount !== 1 ? 's' : ''}</p>
            <button class="btn-seed" data-action="load-seed-preview">Load Preview</button>
          </div>
        </div>
      `;
    }

    // Show data preview table using DialogUtils
    const tableHtml = DialogUtils.renderDataTable(this.generatedData, {
      limit: 100,
      fkWarnings: this.fkWarnings,
      invalidRows: this.invalidRows,
      showAllButton: true,
      showAllId: 'btn-show-all-load'
    });

    return `
      <div class="tab-content-load">
        <div class="result-content">
          ${tableHtml}
        </div>
        ${this.renderLoadValidationInfo()}
      </div>
    `;
  },

  /**
   * Render validation info for Load tab
   */
  renderLoadValidationInfo() {
    if (!this.generatedData || this.generatedData.length === 0) return '';

    let html = '<div class="generator-validation">';
    const total = this.generatedData.length;

    // Summary line
    if (this.entryMode === 'export') {
      html += `<div class="validation-summary">${total} records in database</div>`;
    } else if (this.invalidRows.length > 0) {
      html += `<div class="validation-summary"><strong>${this.validCount} valid</strong> / ${total} total</div>`;
    } else {
      html += `<div class="validation-summary">${total} records — all valid</div>`;
    }

    // Seed fallback info
    if (this.seedFallbacks.length > 0) {
      html += `<div class="warning-section seed-fallback-info">
        <div class="warning-icon">⚠</div>
        <div class="warning-text">FK labels resolved from seed files (not loaded in DB): <strong>${this.seedFallbacks.join(', ')}</strong>.
          <br>Load dependencies first or use "Load All".</div>
      </div>`;
    }

    // FK warnings using DialogUtils
    html += DialogUtils.renderFKWarnings(this.fkWarnings, 3);

    // Conflict mode selector using DialogUtils
    if (this.conflicts.length > 0 || this.conflictCount > 0) {
      html += DialogUtils.renderConflictSelector({
        conflicts: this.conflicts,
        conflictCount: this.conflictCount,
        totalRecords: total,
        dbRowCount: this.dbRowCount,
        selected: this.selectedMode,
        radioName: 'gen-import-mode',
        showDescriptions: this.conflicts.length > 0
      });
    }

    html += '</div>';
    return html;
  },

  /**
   * Render footer buttons based on active tab
   */
  renderFooterButtons() {
    const hasData = this.generatedData && this.generatedData.length > 0;
    const count = this.generatedData?.length || 0;

    switch (this.activeTab) {
      case 'instruction':
        return `
          <button class="btn-seed" data-action="save-to-md">Save to MD</button>
          <button class="btn-seed primary" data-action="build-prompt">Build AI Prompt →</button>
        `;

      case 'prompt':
        return `
          <button class="btn-seed" data-action="close">Cancel</button>
        `;

      case 'response':
        return `
          <button class="btn-seed" data-action="close">Cancel</button>
          <button class="btn-seed primary" data-action="parse-response">Parse &amp; Validate →</button>
        `;

      case 'load':
        if (this.entryMode === 'export') {
          return `
            <button class="btn-seed" data-action="export-json">Export JSON</button>
            <button class="btn-seed" data-action="export-csv">Export CSV</button>
            <button class="btn-seed" data-action="close">Cancel</button>
          `;
        }
        if (!hasData) {
          return `<button class="btn-seed" data-action="close">Cancel</button>`;
        }
        const loadLabel = this.invalidRows.length > 0 ? `Load ${this.validCount}` : `Load ${count}`;
        return `
          <button class="btn-seed" data-action="export-json">Export JSON</button>
          <button class="btn-seed" data-action="export-csv">Export CSV</button>
          <span class="footer-separator"></span>
          <button class="btn-seed" data-action="save-only">Save to Seed File</button>
          <button class="btn-seed primary" data-action="save-and-load">${loadLabel} to DB</button>
        `;

      default:
        return `<button class="btn-seed" data-action="close">Close</button>`;
    }
  },

  /**
   * Attach event handlers
   */
  attachEventHandlers() {
    // Close button
    this.container.querySelectorAll('.modal-close').forEach(el => {
      el.addEventListener('click', () => this.close());
    });

    // Tab switching
    this.container.querySelectorAll('.generator-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (!tab.disabled) {
          this.activeTab = tab.dataset.tab;
          this.render();
        }
      });
    });

    // Attach all data-action handlers
    DomUtils.attachDataActionHandlers(this.container, {
      'save-to-md': () => this.saveToMarkdown(),
      'build-prompt': () => this.buildPrompt(),
      'parse-response': () => this.parseAndValidate(),
      'save-only': () => this.saveOnly(),
      'save-and-load': () => this.saveAndLoad(),
      'export-json': () => this.exportJson(),
      'export-csv': () => this.exportCsv(),
      'load-seed-preview': () => this.loadSeedPreview(),
      'close': () => this.close(),
    });

    // Show All button in Load tab
    const showAllBtn = this.container.querySelector('#btn-show-all-load');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        // Re-render with no limit
        const tableContainer = this.container.querySelector('.result-content');
        if (tableContainer && this.generatedData) {
          tableContainer.innerHTML = DialogUtils.renderDataTable(this.generatedData, {
            limit: 0,  // No limit
            fkWarnings: this.fkWarnings,
            invalidRows: this.invalidRows
          });
        }
      });
    }

    // Copy prompt + AI service links
    DomUtils.attachAILinkHandlers(
      this.container, () => this.lastPrompt, '#llm-prompt-text',
      (msg, err) => this.showMessage(msg, err)
    );

    // Drag and drop for paste area
    DomUtils.setupDropZone(this.container, '#paste-drop-zone', '#ai-response-text');

    // Conflict mode selector
    DomUtils.attachRadioGroupHandler(this.container, 'gen-import-mode', (value) => {
      this.selectedMode = value;
    });
  },

  /**
   * Get current instruction from textarea
   */
  getCurrentInstruction() {
    const textarea = this.container.querySelector('#generator-instruction');
    return textarea ? textarea.value.trim() : this.instruction;
  },

  /**
   * Save instruction to markdown file
   */
  async saveToMarkdown() {
    const instruction = this.getCurrentInstruction();
    if (!instruction) {
      this.showMessage('Please enter an instruction first', true);
      return;
    }

    const endpoint = this.instructionType === 'completer'
      ? `api/entity/${this.entityName}/completer-instruction`
      : `api/entity/${this.entityName}/generator-instruction`;

    try {
      const resp = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const result = await resp.json();

      if (result.success) {
        this.instruction = instruction;
        this.hasInstruction = true;
        this.showMessage('Instruction saved to markdown');
        this.render();  // Re-render to update tab states
      } else {
        this.showMessage(result.error || 'Failed to save', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Build prompt and switch to Prompt tab
   */
  async buildPrompt() {
    const instruction = this.getCurrentInstruction();
    if (!instruction) {
      this.showMessage('Please enter an instruction first', true);
      return;
    }

    const endpoint = this.instructionType === 'completer'
      ? `api/seed/complete-prompt/${this.entityName}`
      : `api/seed/prompt/${this.entityName}`;

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const result = await resp.json();

      if (result.success) {
        this.lastPrompt = result.prompt;
        this.emptyFKs = result.emptyFKs || [];
        this.seedOnlyFKs = result.seedOnlyFKs || [];
        this.activeTab = 'prompt';
      } else {
        this.showMessage(result.error || 'Failed to build prompt', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }

    this.render();
  },

  /**
   * Parse pasted AI response and validate via server
   */
  async parseAndValidate() {
    const textarea = this.container.querySelector('#ai-response-text');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) {
      this.showMessage('Please paste the AI response first', true);
      return;
    }

    try {
      let result;
      const format = CsvParser.detectFormat(text);

      if (format === 'csv') {
        // CSV: parse client-side, validate via existing endpoint
        const records = CsvParser.parse(text);
        if (records.length === 0) throw new Error('No records found in CSV input');
        for (const record of records) { delete record.id; }

        const resp = await fetch(`api/seed/validate/${this.entityName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records })
        });
        result = await resp.json();
        result.records = records;
        result.count = records.length;
        result.success = true;
      } else {
        // JSON: server-side parse (strips markdown) + validate
        const resp = await fetch(`api/seed/parse/${this.entityName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        result = await resp.json();
      }

      if (result.success) {
        this.generatedData = result.records;
        this.seedFallbacks = result.seedFallbacks || [];
        this.fkWarnings = result.warnings || [];
        this.invalidRows = result.invalidRows || [];
        this.validCount = result.validCount ?? result.count;
        this.conflicts = result.conflicts || [];
        this.conflictCount = result.conflictCount || this.conflicts.length;
        this.dbRowCount = result.dbRowCount || 0;
        this.selectedMode = this.conflicts.length > 0 || this.conflictCount > 0 ? 'merge' : 'replace';
        this.activeTab = 'load';
        this.showMessage(`Parsed ${result.count} records${format === 'csv' ? ' (CSV)' : ''}`);
      } else {
        this.showMessage(result.error || 'Parse failed', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }

    this.render();
  },

  /**
   * Load seed file preview for Load tab
   */
  async loadSeedPreview() {
    try {
      const url = `api/seed/content/${this.entityName}`;
      const response = await fetch(url);
      const data = await response.json();
      this.generatedData = data.records || [];
      this.dbRowCount = data.dbRowCount || 0;
      this.conflictCount = data.conflictCount || 0;
      this.validCount = this.generatedData.length;
      this.selectedMode = this.conflictCount > 0 ? 'skip_conflicts' : 'replace';
      this.render();
    } catch (err) {
      console.error('Failed to load seed preview:', err);
      this.showMessage('Failed to load seed file', true);
    }
  },

  /**
   * Save data to seed file only (without loading into database)
   */
  async saveOnly() {
    if (!this.generatedData) return;

    try {
      const resp = await fetch(`api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.generatedData)
      });
      const result = await resp.json();

      if (result.success) {
        this.hasSeedFile = true;
        this.seedFileCount = this.generatedData.length;
        this.showMessage('Saved to seed file');
      } else {
        this.showMessage(result.error || 'Failed to save', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Save to seed file and load into database
   */
  async saveAndLoad() {
    if (!this.generatedData) return;

    try {
      // Step 1: Save to seed file
      const saveResp = await fetch(`api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.generatedData)
      });
      const saveResult = await saveResp.json();

      if (!saveResult.success) {
        this.showMessage(saveResult.error || 'Failed to save', true);
        return;
      }

      // Step 2: Load into database
      // Completer always updates existing records → force merge mode
      const mode = this.instructionType === 'completer' ? 'merge'
        : (this.conflicts.length > 0 || this.conflictCount > 0) ? this.selectedMode : 'replace';
      const loadResp = await fetch(`api/seed/load/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skipInvalid: true,
          mode: mode
        })
      });
      const loadResult = await loadResp.json();

      if (loadResult.success) {
        const hasErrors = loadResult.errors && loadResult.errors.length > 0;
        if (hasErrors && loadResult.loaded === 0 && (loadResult.updated || 0) === 0) {
          this.showMessage(`Load failed: ${loadResult.errors[0]}`, true);
        } else {
          const parts = [];
          if (loadResult.loaded > 0) parts.push(`${loadResult.loaded} loaded`);
          if (loadResult.updated > 0) parts.push(`${loadResult.updated} updated`);
          if (loadResult.replaced > 0) parts.push(`${loadResult.replaced} replaced`);
          if (loadResult.skipped > 0) parts.push(`${loadResult.skipped} skipped`);
          const msg = `Saved: ${parts.join(', ')}`;
          this.showMessage(hasErrors ? `${msg} — ${loadResult.errors[0]}` : msg, hasErrors);
          setTimeout(() => {
            this.close();
            if (typeof SeedManager !== 'undefined' && SeedManager.loadStatus) {
              SeedManager.loadStatus().then(() => SeedManager.render());
            }
          }, 1000);
        }
      } else {
        this.showMessage(loadResult.error || 'Saved but failed to load', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Show a status message
   */
  showMessage(message, isError = false) {
    DomUtils.showMessage(this.container, message, isError);
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
      const response = await fetch(`api/entities/${this.entityName}?limit=10000`);
      const data = await response.json();
      const rawRecords = data.data || [];

      this.generatedData = rawRecords.map(record => {
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

      this.validCount = this.generatedData.length;
    } catch (err) {
      console.error('Failed to load DB content:', err);
      this.generatedData = [];
      this.validCount = 0;
    }
  },

  /**
   * Export as JSON file using DialogUtils
   */
  exportJson() {
    if (!this.generatedData || this.generatedData.length === 0) return;
    DialogUtils.exportJson(this.generatedData, `${this.entityName}.json`);
    this.close();
  },

  /**
   * Export as CSV file using DialogUtils
   */
  exportCsv() {
    if (!this.generatedData || this.generatedData.length === 0) return;
    DialogUtils.exportCsv(this.generatedData, `${this.entityName}.csv`);
    this.close();
  },

};
