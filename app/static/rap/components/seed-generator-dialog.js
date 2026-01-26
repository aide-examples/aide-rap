/**
 * Seed Generator Dialog
 * Modal for generating seed data via interactive copy/paste workflow:
 * 1. Write instruction → 2. Build prompt, copy, paste AI response → 3. Review & save
 */
const SeedGeneratorDialog = {
  container: null,
  entityName: null,
  schema: null,
  instruction: '',
  generatedData: null,
  lastPrompt: null,
  activeTab: 'instruction',  // instruction, prompt, result
  hasInstruction: false,
  emptyFKs: [],
  // Validation state (populated by /api/seed/parse)
  fkWarnings: [],
  invalidRows: [],
  validCount: 0,
  conflicts: [],
  selectedMode: 'merge',

  /**
   * Initialize the dialog
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  /**
   * Open the dialog for an entity
   */
  async open(entityName) {
    this.entityName = entityName;
    this.generatedData = null;
    this.lastPrompt = null;
    this.activeTab = 'instruction';
    this.resetValidation();

    // Load schema
    this.schema = await SchemaCache.getExtended(entityName);

    // Load instruction from markdown
    try {
      const resp = await fetch(`/api/entity/${entityName}/generator-instruction`);
      const data = await resp.json();
      this.instruction = data.instruction || '';
      this.hasInstruction = data.hasInstruction || false;
    } catch (e) {
      this.instruction = '';
      this.hasInstruction = false;
    }

    this.render();
  },

  /**
   * Reset validation state
   */
  resetValidation() {
    this.emptyFKs = [];
    this.fkWarnings = [];
    this.invalidRows = [];
    this.validCount = 0;
    this.conflicts = [];
    this.selectedMode = 'merge';
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
    const hasResult = this.generatedData && this.generatedData.length > 0;

    this.container.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog seed-generator-dialog">
          <div class="modal-header" style="background-color: ${areaColor};">
            <h2>Generate: ${this.entityName}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>

          <div class="generator-tabs">
            <button class="generator-tab ${this.activeTab === 'instruction' ? 'active' : ''}" data-tab="instruction">
              1. Instruction
            </button>
            <button class="generator-tab ${this.activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt">
              2. Prompt &amp; Paste
            </button>
            <button class="generator-tab ${this.activeTab === 'result' ? 'active' : ''} ${hasResult ? 'has-data' : ''}" data-tab="result" ${!hasResult ? 'disabled' : ''}>
              3. Result ${hasResult ? `(${this.validCount}/${this.generatedData.length})` : ''}
            </button>
          </div>

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
        return `
          <div class="tab-content-instruction">
            <div class="instruction-status ${this.hasInstruction ? 'has-instruction' : 'no-instruction'}">
              ${this.hasInstruction ? '✓ Instruction found in Markdown' : 'No instruction defined yet — write one below.'}
            </div>
            <textarea id="generator-instruction" rows="6" placeholder="Describe what data to generate...">${this.escapeHtml(this.instruction)}</textarea>
          </div>
        `;

      case 'prompt':
        return `
          <div class="tab-content-prompt-paste">
            ${this.emptyFKs.length > 0 ? `
              <div class="fk-dependency-warning">⚠ No data for: ${this.emptyFKs.join(', ')} — FK references will be unresolvable.</div>
            ` : ''}
            <div class="prompt-section">
              <div class="prompt-section-header">
                <span class="prompt-section-label">AI Prompt</span>
                ${this.lastPrompt ? `
                  <span class="prompt-actions">
                    <button class="btn-seed btn-small" data-action="copy-prompt">Copy</button>
                    <a href="https://chatgpt.com/" target="chatgpt" class="ai-link ai-link-chatgpt" data-action="open-ai">GPT</a>
                    <a href="https://claude.ai/new" target="claude" class="ai-link ai-link-claude" data-action="open-ai">Claude</a>
                    <a href="https://gemini.google.com/app" target="gemini" class="ai-link ai-link-gemini" data-action="open-ai">Gemini</a>
                  </span>
                ` : ''}
              </div>
              <textarea id="llm-prompt-text" readonly rows="8" placeholder="Build a prompt from the Instruction tab, or paste your AI response directly below.">${this.escapeHtml(this.lastPrompt || '')}</textarea>
            </div>
            <div class="paste-section" id="paste-drop-zone">
              <div class="paste-section-header">
                <span class="paste-section-label">AI Response</span>
              </div>
              <textarea id="ai-response-text" rows="8" placeholder="Paste JSON array or CSV data here..."></textarea>
            </div>
          </div>
        `;

      case 'result':
        return `
          <div class="tab-content-result">
            <div class="result-content">
              ${this.renderResultContent()}
            </div>
            ${this.renderValidationInfo()}
          </div>
        `;

      default:
        return '';
    }
  },

  /**
   * Render footer buttons based on active tab
   */
  renderFooterButtons() {
    const hasResult = this.generatedData && this.generatedData.length > 0;

    switch (this.activeTab) {
      case 'instruction':
        return `
          <button class="btn-seed" data-action="save-to-md">Save to MD</button>
          <button class="btn-seed primary" data-action="build-prompt">Build AI Prompt →</button>
        `;

      case 'prompt':
        return `
          <button class="btn-seed primary" data-action="parse-response">Parse &amp; Validate →</button>
        `;

      case 'result':
        return `
          <button class="btn-seed" data-action="save-json">Save only</button>
          <button class="btn-seed primary" data-action="save-and-load">${hasResult && this.invalidRows.length > 0 ? `Save & Load ${this.validCount}` : 'Save & Load'}</button>
        `;

      default:
        return `<button class="btn-seed" data-action="close">Close</button>`;
    }
  },

  /**
   * Render the result content (table or placeholder)
   */
  renderResultContent() {
    if (!this.generatedData) {
      return '<p class="empty-result">No data yet. Paste AI response in the Prompt & Paste tab.</p>';
    }

    if (this.generatedData.length === 0) {
      return '<p class="empty-result">No records found in response.</p>';
    }

    return this.renderResultTable();
  },

  /**
   * Render the data as an HTML table with validation warnings
   */
  renderResultTable() {
    if (!this.generatedData || !this.schema) return '';

    // Build warning lookup: row -> field -> warning
    const warningLookup = {};
    for (const w of this.fkWarnings) {
      if (!warningLookup[w.row]) warningLookup[w.row] = {};
      warningLookup[w.row][w.field] = w;
    }
    const invalidRowSet = new Set(this.invalidRows);

    // Collect columns from actual data
    const dataKeys = new Set();
    for (const record of this.generatedData) {
      Object.keys(record).forEach(k => {
        if (k !== 'id' && !k.startsWith('_')) dataKeys.add(k);
      });
    }

    const columns = [...dataKeys];
    const headerCells = columns.map(c => `<th>${this.escapeHtml(c)}</th>`).join('');

    // Limit preview to first 50 rows
    const previewRows = this.generatedData.slice(0, 50);

    const rows = previewRows.map((record, idx) => {
      const rowNum = idx + 1;
      const rowWarnings = warningLookup[rowNum] || {};
      const isInvalidRow = invalidRowSet.has(rowNum);

      const cells = columns.map(col => {
        const value = record[col];
        const warning = rowWarnings[col];
        if (value === null || value === undefined) {
          return '<td class="null-value">-</td>';
        }
        const strValue = String(value);
        const displayValue = strValue.length > 30 ? strValue.substring(0, 27) + '...' : strValue;
        if (warning) {
          return `<td class="fk-invalid" title="${this.escapeHtml(warning.message || '')}">${this.escapeHtml(displayValue)} ⚠</td>`;
        }
        return `<td title="${this.escapeHtml(strValue)}">${this.escapeHtml(displayValue)}</td>`;
      }).join('');

      const rowClass = isInvalidRow ? 'class="invalid-row"' : '';
      return `<tr ${rowClass}>${cells}</tr>`;
    }).join('');

    let html = `
      <div class="result-table-wrapper">
        <table class="seed-preview-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    if (this.generatedData.length > 50) {
      html += `<div class="preview-truncated">... and ${this.generatedData.length - 50} more records</div>`;
    }

    return html;
  },

  /**
   * Render validation info below the result table
   */
  renderValidationInfo() {
    if (!this.generatedData || this.generatedData.length === 0) return '';

    let html = '<div class="generator-validation">';

    // Summary line
    const total = this.generatedData.length;
    const hasInvalid = this.invalidRows.length > 0;
    if (hasInvalid) {
      html += `<div class="validation-summary"><strong>${this.validCount} valid</strong> / ${total} total</div>`;
    } else {
      html += `<div class="validation-summary">${total} records — all valid</div>`;
    }

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
        .map(w => `"${this.escapeHtml(w.value)}" not found in ${this.escapeHtml(w.targetEntity)}`)
        .join('<br>');

      html += `<div class="warning-section"><div class="warning-icon">⚠</div><div class="warning-text">${warningLines}`;
      if (uniqueWarnings.size > 3) {
        html += `<br><span class="warning-more">... and ${uniqueWarnings.size - 3} more FK warnings</span>`;
      }
      html += '</div></div>';
    }

    // Conflict warnings with mode selector
    if (this.conflicts.length > 0) {
      const conflictCount = this.conflicts.length;
      const totalBackRefs = this.conflicts.reduce((sum, c) => sum + c.backRefs, 0);

      html += `
        <div class="conflict-section">
          <div class="conflict-header">
            <span class="conflict-icon">🔗</span>
            <span class="conflict-text">${conflictCount} record(s) would overwrite existing data with ${totalBackRefs} back-reference(s)</span>
          </div>
          <div class="conflict-mode-selector">
            <label><input type="radio" name="gen-import-mode" value="merge" ${this.selectedMode === 'merge' ? 'checked' : ''}> <strong>Merge</strong> - Update existing, add new (preserves IDs)</label>
            <label><input type="radio" name="gen-import-mode" value="skip_conflicts" ${this.selectedMode === 'skip_conflicts' ? 'checked' : ''}> <strong>Skip</strong> - Only add new records</label>
            <label><input type="radio" name="gen-import-mode" value="replace" ${this.selectedMode === 'replace' ? 'checked' : ''}> <strong>Replace</strong> - Overwrite all (may break references!)</label>
          </div>
        </div>
      `;
    }

    html += '</div>';
    return html;
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

    // Save to markdown
    this.container.querySelector('[data-action="save-to-md"]')?.addEventListener('click', () => {
      this.saveToMarkdown();
    });

    // Build prompt
    this.container.querySelector('[data-action="build-prompt"]')?.addEventListener('click', () => {
      this.buildPrompt();
    });

    // Copy prompt to clipboard
    this.container.querySelector('[data-action="copy-prompt"]')?.addEventListener('click', () => {
      this.copyPrompt();
    });

    // AI quick-links: copy prompt before navigating
    this.container.querySelectorAll('[data-action="open-ai"]').forEach(link => {
      link.addEventListener('click', () => {
        if (this.lastPrompt) {
          navigator.clipboard.writeText(this.lastPrompt).catch(() => {
            const textarea = this.container.querySelector('#llm-prompt-text');
            if (textarea) { textarea.select(); document.execCommand('copy'); }
          });
        }
      });
    });

    // Parse & validate pasted AI response
    this.container.querySelector('[data-action="parse-response"]')?.addEventListener('click', () => {
      this.parseAndValidate();
    });

    // Save only
    this.container.querySelector('[data-action="save-json"]')?.addEventListener('click', () => {
      this.saveOnly();
    });

    // Save & Load
    this.container.querySelector('[data-action="save-and-load"]')?.addEventListener('click', () => {
      this.saveAndLoad();
    });

    // Drag and drop for paste area
    const dropZone = this.container.querySelector('#paste-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const text = e.dataTransfer.getData('text');
        if (text) {
          const textarea = this.container.querySelector('#ai-response-text');
          if (textarea) textarea.value = text;
        }
      });
    }

    // Conflict mode selector
    this.container.querySelectorAll('input[name="gen-import-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.selectedMode = e.target.value;
      });
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

    try {
      const resp = await fetch(`/api/entity/${this.entityName}/generator-instruction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const result = await resp.json();

      if (result.success) {
        this.instruction = instruction;
        this.showMessage('Instruction saved to markdown');
      } else {
        this.showMessage(result.error || 'Failed to save', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Build prompt and switch to Prompt & Paste tab
   */
  async buildPrompt() {
    const instruction = this.getCurrentInstruction();
    if (!instruction) {
      this.showMessage('Please enter an instruction first', true);
      return;
    }

    try {
      const resp = await fetch(`/api/seed/prompt/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const result = await resp.json();

      if (result.success) {
        this.lastPrompt = result.prompt;
        this.emptyFKs = result.emptyFKs || [];
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
   * Copy prompt to clipboard
   */
  async copyPrompt() {
    if (!this.lastPrompt) return;

    try {
      await navigator.clipboard.writeText(this.lastPrompt);
      this.showMessage('Prompt copied to clipboard');
    } catch (e) {
      // Fallback: select textarea content
      const textarea = this.container.querySelector('#llm-prompt-text');
      if (textarea) {
        textarea.select();
        document.execCommand('copy');
        this.showMessage('Prompt copied to clipboard');
      } else {
        this.showMessage('Failed to copy', true);
      }
    }
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

        const resp = await fetch(`/api/seed/validate/${this.entityName}`, {
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
        const resp = await fetch(`/api/seed/parse/${this.entityName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        result = await resp.json();
      }

      if (result.success) {
        this.generatedData = result.records;
        this.fkWarnings = result.warnings || [];
        this.invalidRows = result.invalidRows || [];
        this.validCount = result.validCount ?? result.count;
        this.conflicts = result.conflicts || [];
        this.selectedMode = this.conflicts.length > 0 ? 'merge' : 'replace';
        this.activeTab = 'result';
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
   * Save data to seed file only (without loading into database)
   */
  async saveOnly() {
    if (!this.generatedData) return;

    try {
      const resp = await fetch(`/api/seed/upload/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.generatedData)
      });
      const result = await resp.json();

      if (result.success) {
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
      const saveResp = await fetch(`/api/seed/upload/${this.entityName}`, {
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
      const loadResp = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skipInvalid: true,
          mode: this.conflicts.length > 0 ? this.selectedMode : 'replace'
        })
      });
      const loadResult = await loadResp.json();

      if (loadResult.success) {
        this.showMessage(`Saved and loaded ${loadResult.loaded} records`);
        setTimeout(() => {
          this.close();
          if (typeof SeedManager !== 'undefined' && SeedManager.loadStatus) {
            SeedManager.loadStatus().then(() => SeedManager.render());
          }
        }, 1000);
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
    const footer = this.container.querySelector('.modal-footer');
    if (!footer) return;

    const existing = footer.querySelector('.status-message');
    if (existing) existing.remove();

    const msg = document.createElement('div');
    msg.className = `status-message ${isError ? 'error' : 'success'}`;
    msg.textContent = message;
    footer.insertBefore(msg, footer.firstChild);

    setTimeout(() => msg.remove(), 3000);
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
};
