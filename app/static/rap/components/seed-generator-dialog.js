/**
 * Seed Generator Dialog
 * Modal for generating seed data using LLM based on natural language instructions
 */
const SeedGeneratorDialog = {
  container: null,
  entityName: null,
  schema: null,
  instruction: '',
  generatedData: null,
  lastPrompt: null,
  activeTab: 'instruction',  // instruction, prompt, paste, result
  isGenerating: false,
  llmProvider: null,

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
    this.isGenerating = false;

    // Load schema
    this.schema = await SchemaCache.getExtended(entityName);

    // Load instruction from markdown
    try {
      const resp = await fetch(`/api/entity/${entityName}/generator-instruction`);
      const data = await resp.json();
      this.instruction = data.instruction || '';
    } catch (e) {
      this.instruction = '';
    }

    // Load LLM provider info
    try {
      const resp = await fetch('/api/seed/generator-status');
      const data = await resp.json();
      // Only set provider if enabled (API key configured)
      this.llmProvider = data.enabled ? data.provider : null;
    } catch (e) {
      this.llmProvider = null;
    }

    this.render();
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
            <button class="generator-tab ${this.activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt" ${!this.lastPrompt ? 'disabled' : ''}>
              2. AI Prompt
            </button>
            <button class="generator-tab tab-paste ${this.activeTab === 'paste' ? 'active' : ''}" data-tab="paste" ${!this.lastPrompt ? 'disabled' : ''}>
              3. Paste Response
            </button>
            <button class="generator-tab ${this.activeTab === 'result' ? 'active' : ''} ${hasResult ? 'has-data' : ''}" data-tab="result" ${!hasResult ? 'disabled' : ''}>
              4. Result ${hasResult ? `(${this.generatedData.length})` : ''}
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
            <textarea id="generator-instruction" rows="6" placeholder="Describe what data to generate...">${this.escapeHtml(this.instruction)}</textarea>
          </div>
        `;

      case 'prompt':
        return `
          <div class="tab-content-prompt">
            <textarea id="llm-prompt-text" readonly rows="12">${this.escapeHtml(this.lastPrompt || '')}</textarea>
          </div>
        `;

      case 'paste':
        return `
          <div class="tab-content-paste" id="paste-drop-zone">
            <div class="paste-hint">Paste or drop JSON here</div>
            <textarea id="ai-response-text" rows="10" placeholder="Paste the JSON array from your AI chat here..."></textarea>
          </div>
        `;

      case 'result':
        return `
          <div class="tab-content-result">
            <div class="result-content">
              ${this.renderResultContent()}
            </div>
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
          <button class="btn-seed" data-action="copy-prompt">Copy Prompt</button>
          ${this.llmProvider ? `
          <button class="btn-seed" data-action="generate" ${this.isGenerating ? 'disabled' : ''}>
            ${this.isGenerating ? 'Generating...' : `Ask ${this.llmProvider}`}
          </button>
          ` : ''}
          <button class="btn-seed primary" data-action="goto-paste">Paste Response →</button>
        `;

      case 'paste':
        return `
          <button class="btn-seed primary" data-action="parse-response">Parse JSON</button>
        `;

      case 'result':
        return `
          <button class="btn-seed" data-action="save-json">Save JSON</button>
          <button class="btn-seed primary" data-action="save-and-load">Save & Load into DB</button>
        `;

      default:
        return `<button class="btn-seed" data-action="close">Close</button>`;
    }
  },

  /**
   * Render the result content (table or placeholder)
   */
  renderResultContent() {
    if (this.isGenerating) {
      return '<div class="generating-spinner">Generating data...</div>';
    }

    if (!this.generatedData) {
      return '<p class="empty-result">Click "Generate" to create seed data based on the instruction.</p>';
    }

    if (this.generatedData.length === 0) {
      return '<p class="empty-result">No data generated.</p>';
    }

    return this.renderResultTable();
  },

  /**
   * Render the data as an HTML table
   */
  renderResultTable() {
    if (!this.generatedData || !this.schema) return '';

    // Collect columns from actual data (shows what AI generated, including conceptual FK names)
    const dataKeys = new Set();
    for (const record of this.generatedData) {
      Object.keys(record).forEach(k => {
        // Exclude id (auto-generated) and internal columns
        if (k !== 'id' && !k.startsWith('_')) dataKeys.add(k);
      });
    }

    const columns = [...dataKeys];
    const headerCells = columns.map(c => `<th>${c}</th>`).join('');

    const rows = this.generatedData.map(record => {
      const cells = columns.map(col => {
        let value = record[col];
        if (value === null || value === undefined) {
          return '<td class="null-value">-</td>';
        }
        // Truncate long values
        const strValue = String(value);
        const displayValue = strValue.length > 30 ? strValue.substring(0, 27) + '...' : strValue;
        return `<td title="${this.escapeHtml(strValue)}">${this.escapeHtml(displayValue)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="result-table-wrapper">
        <table class="seed-preview-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
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

    // Build prompt and go to prompt tab
    this.container.querySelector('[data-action="build-prompt"]')?.addEventListener('click', () => {
      this.buildPrompt();
    });

    // Generate via API
    this.container.querySelector('[data-action="generate"]')?.addEventListener('click', () => {
      this.generate();
    });

    // Go to paste tab
    this.container.querySelector('[data-action="goto-paste"]')?.addEventListener('click', () => {
      this.activeTab = 'paste';
      this.render();
    });

    // Copy prompt to clipboard
    this.container.querySelector('[data-action="copy-prompt"]')?.addEventListener('click', () => {
      this.copyPrompt();
    });

    // Parse pasted AI response
    this.container.querySelector('[data-action="parse-response"]')?.addEventListener('click', () => {
      this.parseResponse();
    });

    // Save JSON
    this.container.querySelector('[data-action="save-json"]')?.addEventListener('click', () => {
      this.saveJSON();
    });

    // Save & Load
    this.container.querySelector('[data-action="save-and-load"]')?.addEventListener('click', () => {
      this.saveAndLoad();
    });

    // Drag and drop for paste tab
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
   * Build prompt without calling API
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
        this.activeTab = 'prompt';  // Switch to prompt tab
      } else {
        this.showMessage(result.error || 'Failed to build prompt', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }

    this.render();
  },

  /**
   * Generate seed data using LLM API
   */
  async generate() {
    const instruction = this.getCurrentInstruction();
    if (!instruction) {
      this.showMessage('Please enter an instruction first', true);
      return;
    }

    this.isGenerating = true;
    this.generatedData = null;
    this.render();

    try {
      const resp = await fetch(`/api/seed/generate/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const result = await resp.json();
      console.log('Generate result:', result); // Debug

      this.isGenerating = false;

      if (result.success) {
        this.generatedData = result.data;
        this.lastPrompt = result.prompt || null;
        this.activeTab = 'result';  // Switch to result tab
        this.showMessage(`Generated ${result.count} records`);
      } else {
        this.showMessage(result.error || 'Generation failed', true);
      }
    } catch (e) {
      this.isGenerating = false;
      this.showMessage(`Error: ${e.message}`, true);
    }

    this.render();
  },

  /**
   * Save generated data to JSON file
   */
  async saveJSON() {
    if (!this.generatedData) return;

    try {
      const resp = await fetch(`/api/seed/save/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: this.generatedData })
      });
      const result = await resp.json();

      if (result.success) {
        this.showMessage(`Saved to ${result.path}`);
      } else {
        this.showMessage(result.error || 'Failed to save', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Load generated data into database
   */
  async loadIntoDB() {
    if (!this.generatedData) return;

    // First save, then load
    try {
      // Save to file first
      await fetch(`/api/seed/save/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: this.generatedData })
      });

      // Then load into DB
      const resp = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST'
      });
      const result = await resp.json();

      if (result.success) {
        this.showMessage(`Loaded ${result.loaded} records into database`);
      } else {
        this.showMessage(result.error || 'Failed to load', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
  },

  /**
   * Save JSON and load into DB
   */
  async saveAndLoad() {
    if (!this.generatedData) return;

    try {
      // Save to file
      const saveResp = await fetch(`/api/seed/save/${this.entityName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: this.generatedData })
      });
      const saveResult = await saveResp.json();

      if (!saveResult.success) {
        this.showMessage(saveResult.error || 'Failed to save', true);
        return;
      }

      // Load into DB
      const loadResp = await fetch(`/api/seed/load/${this.entityName}`, {
        method: 'POST'
      });
      const loadResult = await loadResp.json();

      if (loadResult.success) {
        this.showMessage(`Saved and loaded ${loadResult.loaded} records`);
        // Close dialog and refresh parent
        setTimeout(() => {
          this.close();
          if (typeof SeedManager !== 'undefined' && SeedManager.loadStatus) {
            SeedManager.loadStatus().then(() => SeedManager.render());
          }
        }, 1000);
      } else {
        this.showMessage(loadResult.error || 'Failed to load', true);
      }
    } catch (e) {
      this.showMessage(`Error: ${e.message}`, true);
    }
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
   * Parse pasted AI response JSON
   */
  parseResponse() {
    const textarea = this.container.querySelector('#ai-response-text');
    if (!textarea) return;

    let text = textarea.value.trim();
    if (!text) {
      this.showMessage('Please paste the AI response first', true);
      return;
    }

    try {
      // Remove markdown code blocks if present
      if (text.startsWith('```')) {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          text = match[1].trim();
        } else {
          text = text.replace(/^```(?:json)?\s*/, '');
        }
      }

      // Find JSON array
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        if (text.includes('[') && !text.includes(']')) {
          throw new Error('Response appears truncated. JSON array is incomplete.');
        }
        throw new Error('No valid JSON array found in response');
      }

      const data = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(data)) {
        throw new Error('Response is not an array');
      }

      // Remove 'id' fields - they should be auto-generated
      for (const record of data) {
        delete record.id;
      }

      this.generatedData = data;
      this.activeTab = 'result';  // Switch to result tab
      this.showMessage(`Parsed ${data.length} records`);
      this.render();
    } catch (e) {
      this.showMessage(`Parse error: ${e.message}`, true);
    }
  },

  /**
   * Show a status message
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
   * Escape HTML
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
};
