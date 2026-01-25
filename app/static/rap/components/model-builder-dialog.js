/**
 * Model Builder Dialog
 * Modal for creating new AIDE RAP systems from design descriptions
 * V2: Immediate persistence, system selection, import modes
 */
const ModelBuilderDialog = {
    container: null,
    activeTab: 'select', // select, info, design, prompt, paste, preview
    selectedSystem: null, // null = new system, string = existing system name
    systemCreated: false, // true after Tab 1 save (system dir exists)
    systemName: '',
    displayName: '',
    description: '',
    designBrief: '',
    themeColor: '#2563eb',
    prompt: null,
    mermaidCode: '',
    parsedResult: null,
    importMode: 'replace', // replace, merge-ignore, merge-replace
    existingEntities: [], // entities in existing system
    isGenerating: false,
    areaLayoutFitContent: false, // toggle for area card layout
    existingSystems: [],

    /**
     * Initialize the dialog
     */
    init(containerId) {
        this.container = document.getElementById(containerId);
    },

    /**
     * Open the dialog
     */
    async open() {
        this.activeTab = 'select';
        this.selectedSystem = null;
        this.systemCreated = false;
        this.systemName = '';
        this.displayName = '';
        this.description = '';
        this.designBrief = '';
        this.themeColor = '#2563eb';
        this.prompt = null;
        this.mermaidCode = '';
        this.parsedResult = null;
        this.importMode = 'replace';
        this.existingEntities = [];
        this.isGenerating = false;

        // Load existing systems for selection
        try {
            const resp = await fetch('/api/model-builder/systems');
            const data = await resp.json();
            this.existingSystems = data.systems || [];
        } catch (e) {
            this.existingSystems = [];
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
    },

    /**
     * Render the dialog
     */
    render() {
        if (!this.container) return;

        const hasPrompt = !!this.prompt;
        const hasParsed = this.parsedResult && this.parsedResult.entities && this.parsedResult.entities.length > 0;
        const isNewSystem = this.selectedSystem === null;
        const title = isNewSystem ? 'Create New System' : `Edit: ${this.displayName || this.systemName}`;

        // Tab accessibility: select only when no system selected, info when system created or selected
        const canAccessInfo = this.selectedSystem !== null || this.activeTab !== 'select';
        const canAccessDesign = this.systemCreated || this.selectedSystem !== null;

        this.container.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-dialog model-builder-dialog">
                    <div class="modal-header" style="background-color: ${this.themeColor};">
                        <h2>${this.escapeHtml(title)}</h2>
                        <button class="modal-close" data-action="close">&times;</button>
                    </div>

                    <div class="generator-tabs">
                        <button class="generator-tab ${this.activeTab === 'select' ? 'active' : ''}" data-tab="select">
                            0. Select
                        </button>
                        <button class="generator-tab ${this.activeTab === 'info' ? 'active' : ''}" data-tab="info" ${!canAccessInfo ? 'disabled' : ''}>
                            1. System Info
                        </button>
                        <button class="generator-tab ${this.activeTab === 'design' ? 'active' : ''}" data-tab="design" ${!canAccessDesign ? 'disabled' : ''}>
                            2. Design Brief
                        </button>
                        <button class="generator-tab ${this.activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt" ${!hasPrompt ? 'disabled' : ''}>
                            3. AI Prompt
                        </button>
                        <button class="generator-tab tab-paste ${this.activeTab === 'paste' ? 'active' : ''}" data-tab="paste" ${!hasPrompt ? 'disabled' : ''}>
                            4. Paste Response
                        </button>
                        <button class="generator-tab ${this.activeTab === 'preview' ? 'active' : ''} ${hasParsed ? 'has-data' : ''}" data-tab="preview" ${!hasParsed ? 'disabled' : ''}>
                            5. Import ${hasParsed ? `(${this.parsedResult.entities.length})` : ''}
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
            case 'select':
                return `
                    <div class="tab-content-select">
                        <div class="form-group">
                            <label for="system-select">Select or create a system:</label>
                            <select id="system-select">
                                <option value="">-- Create New System --</option>
                                ${this.existingSystems.map(s =>
                                    `<option value="${this.escapeHtml(s.name)}" ${this.selectedSystem === s.name ? 'selected' : ''}>
                                        ${this.escapeHtml(s.displayName)} (${this.escapeHtml(s.name)})
                                    </option>`
                                ).join('')}
                            </select>
                        </div>
                        ${this.existingSystems.length === 0 ? `
                            <p class="field-hint">No existing systems found. Create a new one to get started.</p>
                        ` : `
                            <p class="field-hint">Select an existing system to continue editing, or create a new one.</p>
                        `}
                    </div>
                `;

            case 'info':
                const isEditing = this.systemCreated || this.selectedSystem !== null;
                return `
                    <div class="tab-content-info">
                        <div class="form-group">
                            <label for="system-name">System Name (snake_case)</label>
                            <input type="text" id="system-name" value="${this.escapeHtml(this.systemName)}"
                                   placeholder="my_system" pattern="[a-z][a-z0-9_]*" ${isEditing ? 'readonly' : ''}>
                            <div class="field-hint">${isEditing ? 'System name cannot be changed after creation' : 'Lowercase letters, numbers, underscores. E.g., library, inventory_app'}</div>
                        </div>
                        <div class="form-group">
                            <label for="display-name">Display Name</label>
                            <input type="text" id="display-name" value="${this.escapeHtml(this.displayName)}"
                                   placeholder="My System">
                        </div>
                        <div class="form-group">
                            <label for="system-description">Description</label>
                            <input type="text" id="system-description" value="${this.escapeHtml(this.description)}"
                                   placeholder="A brief description of what this system manages">
                        </div>
                        <div class="form-group">
                            <label for="theme-color">Theme Color</label>
                            <div class="color-picker-row">
                                <input type="color" id="theme-color" value="${this.themeColor}">
                                <span class="color-value">${this.themeColor}</span>
                            </div>
                        </div>
                    </div>
                `;

            case 'design':
                return `
                    <div class="tab-content-design">
                        <div class="form-group">
                            <label for="design-brief">Design Brief</label>
                            <div class="field-hint" style="margin-bottom: 8px;">
                                Describe your data model in natural language. You can write in your own language -
                                the AI will generate English entity names.
                            </div>
                            <textarea id="design-brief" rows="10" placeholder="Example:
I need a library system with:
- Books with title, ISBN, publication year
- Authors with name and biography
- Categories for organizing books
- Each book has one author and can belong to multiple categories">${this.escapeHtml(this.designBrief)}</textarea>
                        </div>
                    </div>
                `;

            case 'prompt':
                return `
                    <div class="tab-content-prompt">
                        <textarea id="ai-prompt-text" readonly rows="12">${this.escapeHtml(this.prompt || '')}</textarea>
                    </div>
                `;

            case 'paste':
                return `
                    <div class="tab-content-paste" id="paste-drop-zone">
                        <div class="paste-hint">
                            <strong>Download the markdown file</strong> from the AI, then <strong>drag &amp; drop</strong> it here or paste the contents.
                            <br><small>Copying from rendered chat views loses the \`\`\`mermaid code block markers!</small>
                        </div>
                        <textarea id="mermaid-response-text" rows="10" placeholder="Drag & drop the .md file here, or paste its contents...

The file should contain:
\`\`\`mermaid
erDiagram
    Author {
        string name \"[LABEL] Author name\"
        text biography \"Short bio\"
    }
    Book {
        string title \"[LABEL] Book title\"
        string isbn \"ISBN number\"
    }
    Author ||--o{ Book : \"author\"
\`\`\`

SEEDING:
- Author: ...
- Book: ...">${this.escapeHtml(this.mermaidCode)}</textarea>
                    </div>
                `;

            case 'preview':
                return `
                    <div class="tab-content-preview">
                        ${this.renderPreviewContent()}
                        ${this.renderImportOptions()}
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
        const hasPrompt = !!this.prompt;
        const hasParsed = this.parsedResult && this.parsedResult.entities && this.parsedResult.entities.length > 0;

        switch (this.activeTab) {
            case 'select':
                // Get selected value from dropdown to show/hide delete button
                const selectedValue = this.container?.querySelector('#system-select')?.value || '';
                const showDelete = selectedValue !== '';
                return `
                    ${showDelete ? '<button class="btn-seed btn-danger" data-action="delete-system">Delete System</button>' : ''}
                    <button class="btn-seed primary" data-action="select-system">Continue &rarr;</button>
                `;

            case 'info':
                const isEditing = this.systemCreated || this.selectedSystem !== null;
                return `
                    <button class="btn-seed" data-action="goto-select">&larr; Back</button>
                    <button class="btn-seed primary" data-action="save-info">
                        ${isEditing ? 'Continue &rarr;' : 'Save &amp; Continue &rarr;'}
                    </button>
                `;

            case 'design':
                return `
                    <button class="btn-seed" data-action="goto-info">&larr; Back</button>
                    <button class="btn-seed primary" data-action="build-prompt">Save &amp; Build Prompt &rarr;</button>
                `;

            case 'prompt':
                return `
                    <button class="btn-seed" data-action="copy-prompt">Copy Prompt</button>
                    <button class="btn-seed primary" data-action="goto-paste">Paste Response &rarr;</button>
                `;

            case 'paste':
                return `
                    <button class="btn-seed primary" data-action="parse-mermaid">Parse Mermaid &rarr;</button>
                `;

            case 'preview':
                return `
                    <button class="btn-seed" data-action="goto-paste">&larr; Back</button>
                    <button class="btn-seed primary" data-action="import-entities" ${this.isGenerating ? 'disabled' : ''}>
                        ${this.isGenerating ? 'Importing...' : 'Import Entities'}
                    </button>
                `;

            default:
                return `<button class="btn-seed" data-action="close">Close</button>`;
        }
    },

    /**
     * Render preview content (parsed entities)
     */
    renderPreviewContent() {
        if (!this.parsedResult) {
            return '<p class="empty-result">Parse the Mermaid diagram first.</p>';
        }

        const { entities, validation, seedingInstructions, areas, descriptions } = this.parsedResult;

        let html = '';

        // Validation messages
        if (validation.errors.length > 0) {
            html += `<div class="validation-errors">
                <strong>Errors:</strong>
                <ul>${validation.errors.map(e => `<li>${this.escapeHtml(e)}</li>`).join('')}</ul>
            </div>`;
        }
        if (validation.warnings.length > 0) {
            html += `<div class="validation-warnings">
                <strong>Warnings:</strong>
                <ul>${validation.warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('')}</ul>
            </div>`;
        }

        // Areas preview (if defined)
        if (areas && Object.keys(areas).length > 0) {
            const fitContent = this.areaLayoutFitContent ? 'fit-content' : '';
            html += `<div class="areas-preview">
                <div class="areas-header">
                    <h4>Areas of Competence</h4>
                    <label class="layout-toggle">
                        <input type="checkbox" id="area-layout-toggle" ${this.areaLayoutFitContent ? 'checked' : ''}>
                        <span>Fit to content</span>
                    </label>
                </div>
                <div class="areas-grid ${fitContent}">
                    ${Object.entries(areas).map(([areaName, areaData]) => `
                        <div class="area-card" style="border-left: 4px solid ${areaData.color}; background: ${areaData.color}20;">
                            <div class="area-header">
                                <span class="area-color" style="background: ${areaData.color};"></span>
                                <strong>${this.escapeHtml(areaName)}</strong>
                            </div>
                            <div class="area-entities">
                                ${areaData.entities.map(e => `<span class="area-entity">${this.escapeHtml(e)}</span>`).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }

        // Helper to get entity description
        const getDescription = (entityName) => {
            return descriptions && descriptions[entityName] ? descriptions[entityName] : null;
        };

        // Helper to get area color for entity
        const getEntityAreaColor = (entityName) => {
            if (!areas) return null;
            for (const [, areaData] of Object.entries(areas)) {
                if (areaData.entities.includes(entityName)) {
                    return areaData.color;
                }
            }
            return null;
        };

        // Entities table
        html += `<div class="entities-preview">
            <h4>Entities (${entities.length})</h4>
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>Entity</th>
                        <th>Attributes</th>
                        <th>Seeding</th>
                    </tr>
                </thead>
                <tbody>
                    ${entities.map(entity => {
                        const desc = getDescription(entity.name);
                        const areaColor = getEntityAreaColor(entity.name);
                        const rowStyle = areaColor ? `style="border-left: 6px solid ${areaColor};"` : '';
                        return `
                        <tr class="${entity.isJunction ? 'junction-entity' : ''}" ${rowStyle}>
                            <td>
                                <strong>${this.escapeHtml(entity.name)}</strong>
                                ${entity.isJunction ? '<span class="badge">Junction</span>' : ''}
                                ${desc ? `<div class="entity-description">${this.escapeHtml(desc)}</div>` : ''}
                            </td>
                            <td>
                                ${entity.attributes.map(attr => {
                                    const markers = [];
                                    if (attr.label) markers.push('[LABEL]');
                                    if (attr.label2) markers.push('[LABEL2]');
                                    if (attr.foreignKey) markers.push(`FK→${attr.foreignKey}`);
                                    const markerStr = markers.length > 0 ? ` <span class="attr-markers">${markers.join(' ')}</span>` : '';
                                    return `<div class="attr-item">${this.escapeHtml(attr.name)}: ${attr.foreignKey || attr.type}${markerStr}</div>`;
                                }).join('')}
                            </td>
                            <td class="seeding-cell">
                                ${seedingInstructions[entity.name] ? this.escapeHtml(seedingInstructions[entity.name]) : '<span class="text-muted">—</span>'}
                            </td>
                        </tr>
                    `;}).join('')}
                </tbody>
            </table>
        </div>`;

        return html;
    },

    /**
     * Render import options (shown in preview tab)
     */
    renderImportOptions() {
        if (!this.parsedResult || !this.parsedResult.entities.length) {
            return '';
        }

        const hasExisting = this.existingEntities.length > 0;

        return `
            <div class="import-options">
                <h4>Import Mode</h4>
                ${hasExisting ? `
                    <p class="field-hint">This system has ${this.existingEntities.length} existing entities: ${this.existingEntities.join(', ')}</p>
                ` : ''}
                <div class="import-mode-radio">
                    <label>
                        <input type="radio" name="import-mode" value="replace" ${this.importMode === 'replace' ? 'checked' : ''}>
                        <strong>Replace All</strong> - Delete all existing entities and create only the new ones
                    </label>
                    <label>
                        <input type="radio" name="import-mode" value="merge-ignore" ${this.importMode === 'merge-ignore' ? 'checked' : ''}>
                        <strong>Merge (keep existing)</strong> - Add new entities, skip entities that already exist
                    </label>
                    <label>
                        <input type="radio" name="import-mode" value="merge-replace" ${this.importMode === 'merge-replace' ? 'checked' : ''}>
                        <strong>Merge (replace existing)</strong> - Add new entities, replace entities that already exist
                    </label>
                </div>
            </div>
        `;
    },

    /**
     * Attach event handlers
     */
    attachEventHandlers() {
        // Modal dialog: do NOT close on overlay click
        // Dialog can only be closed via X button or completing the workflow

        // Close button
        this.container.querySelectorAll('.modal-close').forEach(el => {
            el.addEventListener('click', () => this.close());
        });

        // Tab switching
        this.container.querySelectorAll('.generator-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                if (!tab.disabled) {
                    this.saveCurrentTabData();
                    this.activeTab = tab.dataset.tab;
                    this.render();
                }
            });
        });

        // System selection
        this.container.querySelector('[data-action="select-system"]')?.addEventListener('click', () => {
            this.selectSystem();
        });

        // Delete system
        this.container.querySelector('[data-action="delete-system"]')?.addEventListener('click', () => {
            this.deleteSystem();
        });

        // Update footer when dropdown changes (to show/hide delete button)
        this.container.querySelector('#system-select')?.addEventListener('change', () => {
            // Re-render footer to show/hide delete button
            const footer = this.container.querySelector('.modal-footer');
            if (footer) {
                footer.innerHTML = this.renderFooterButtons();
                // Re-attach delete handler
                this.container.querySelector('[data-action="delete-system"]')?.addEventListener('click', () => {
                    this.deleteSystem();
                });
                this.container.querySelector('[data-action="select-system"]')?.addEventListener('click', () => {
                    this.selectSystem();
                });
            }
        });

        // Navigation buttons
        this.container.querySelector('[data-action="goto-select"]')?.addEventListener('click', () => {
            this.saveCurrentTabData();
            this.activeTab = 'select';
            this.render();
        });

        this.container.querySelector('[data-action="goto-info"]')?.addEventListener('click', () => {
            this.saveCurrentTabData();
            this.activeTab = 'info';
            this.render();
        });

        this.container.querySelector('[data-action="save-info"]')?.addEventListener('click', () => {
            this.saveSystemInfo();
        });

        this.container.querySelector('[data-action="goto-paste"]')?.addEventListener('click', () => {
            this.saveCurrentTabData();
            this.activeTab = 'paste';
            this.render();
        });

        // Build prompt
        this.container.querySelector('[data-action="build-prompt"]')?.addEventListener('click', () => {
            this.buildPrompt();
        });

        // Copy prompt
        this.container.querySelector('[data-action="copy-prompt"]')?.addEventListener('click', () => {
            this.copyPrompt();
        });

        // Parse Mermaid
        this.container.querySelector('[data-action="parse-mermaid"]')?.addEventListener('click', () => {
            this.parseMermaid();
        });

        // Import entities
        this.container.querySelector('[data-action="import-entities"]')?.addEventListener('click', () => {
            this.importEntities();
        });

        // Import mode radio buttons
        this.container.querySelectorAll('input[name="import-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.importMode = e.target.value;
            });
        });

        // Area layout toggle
        const areaLayoutToggle = this.container.querySelector('#area-layout-toggle');
        if (areaLayoutToggle) {
            areaLayoutToggle.addEventListener('change', (e) => {
                this.areaLayoutFitContent = e.target.checked;
                const grid = this.container.querySelector('.areas-grid');
                if (grid) {
                    grid.classList.toggle('fit-content', this.areaLayoutFitContent);
                }
            });
        }

        // Color picker updates header
        const colorInput = this.container.querySelector('#theme-color');
        if (colorInput) {
            colorInput.addEventListener('input', (e) => {
                this.themeColor = e.target.value;
                const header = this.container.querySelector('.modal-header');
                if (header) header.style.backgroundColor = this.themeColor;
                const colorValue = this.container.querySelector('.color-value');
                if (colorValue) colorValue.textContent = this.themeColor;
            });
        }

        // Drag and drop for paste tab (supports file drops)
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

                // Check for dropped files first
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    // Accept .md, .txt, or any text file
                    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const textarea = this.container.querySelector('#mermaid-response-text');
                            if (textarea) {
                                textarea.value = event.target.result;
                                this.showMessage(`Loaded: ${file.name}`);
                            }
                        };
                        reader.onerror = () => {
                            this.showMessage('Failed to read file', true);
                        };
                        reader.readAsText(file);
                    } else {
                        this.showMessage('Please drop a .md or .txt file', true);
                    }
                    return;
                }

                // Fallback to text data
                const text = e.dataTransfer.getData('text');
                if (text) {
                    const textarea = this.container.querySelector('#mermaid-response-text');
                    if (textarea) textarea.value = text;
                }
            });
        }
    },

    /**
     * Save current tab data before switching
     */
    saveCurrentTabData() {
        switch (this.activeTab) {
            case 'select':
                // Selection is handled by selectSystem()
                break;
            case 'info':
                this.systemName = (this.container.querySelector('#system-name')?.value || '').trim();
                this.displayName = (this.container.querySelector('#display-name')?.value || '').trim();
                this.description = (this.container.querySelector('#system-description')?.value || '').trim();
                this.themeColor = this.container.querySelector('#theme-color')?.value || '#2563eb';
                break;
            case 'design':
                this.designBrief = (this.container.querySelector('#design-brief')?.value || '').trim();
                break;
            case 'paste':
                this.mermaidCode = (this.container.querySelector('#mermaid-response-text')?.value || '').trim();
                break;
            case 'preview':
                // Import mode is handled by radio change handler
                break;
        }
    },

    /**
     * Handle system selection from dropdown
     */
    async selectSystem() {
        const select = this.container.querySelector('#system-select');
        const selectedValue = select?.value || '';

        if (selectedValue === '') {
            // New system
            this.selectedSystem = null;
            this.systemCreated = false;
            this.systemName = '';
            this.displayName = '';
            this.description = '';
            this.designBrief = '';
            this.themeColor = '#2563eb';
            this.existingEntities = [];
            this.activeTab = 'info';
        } else {
            // Existing system - load its state
            this.selectedSystem = selectedValue;
            await this.loadSystemState(selectedValue);
            // If system has entities, go to design; otherwise go to info
            this.activeTab = 'info';
        }
        this.render();
    },

    /**
     * Load state of an existing system
     */
    async loadSystemState(systemName) {
        try {
            const resp = await fetch(`/api/model-builder/systems/${encodeURIComponent(systemName)}`);
            const data = await resp.json();

            if (data.success) {
                this.systemName = systemName;
                this.displayName = data.displayName || systemName;
                this.description = data.description || '';
                this.designBrief = data.designBrief || '';
                this.themeColor = data.themeColor || '#2563eb';
                this.existingEntities = data.existingEntities || [];
                this.systemCreated = true; // System dir exists
            } else {
                this.showMessage(data.error || 'Failed to load system', true);
            }
        } catch (e) {
            this.showMessage(`Error loading system: ${e.message}`, true);
        }
    },

    /**
     * Save system info (Tab 1) - creates minimal system for new systems
     */
    async saveSystemInfo() {
        this.saveCurrentTabData();

        if (!this.validateInfo()) return;

        // For new systems, create the minimal system directory
        if (!this.systemCreated && this.selectedSystem === null) {
            try {
                const resp = await fetch(`/api/model-builder/systems/${encodeURIComponent(this.systemName)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        displayName: this.displayName,
                        description: this.description || this.displayName,
                        themeColor: this.themeColor
                    })
                });
                const result = await resp.json();

                if (result.success) {
                    this.systemCreated = true;
                    this.selectedSystem = this.systemName;
                    // Add to existing systems list
                    this.existingSystems.push({
                        name: this.systemName,
                        displayName: this.displayName,
                        port: result.port
                    });
                    this.showMessage(`System '${this.systemName}' created`);
                } else {
                    this.showMessage(result.error || 'Failed to create system', true);
                    return;
                }
            } catch (e) {
                this.showMessage(`Error: ${e.message}`, true);
                return;
            }
        }

        this.activeTab = 'design';
        this.render();
    },

    /**
     * Validate system info
     */
    validateInfo() {
        this.saveCurrentTabData();

        if (!this.systemName) {
            this.showMessage('Please enter a system name', true);
            return false;
        }

        if (!/^[a-z][a-z0-9_]*$/.test(this.systemName)) {
            this.showMessage('System name must be lowercase, start with a letter, and contain only letters, numbers, and underscores', true);
            return false;
        }

        // Only check for existing system if this is a new system being created
        if (!this.systemCreated && this.selectedSystem === null) {
            if (this.existingSystems.some(s => s.name === this.systemName)) {
                this.showMessage(`System '${this.systemName}' already exists. Select it from the dropdown instead.`, true);
                return false;
            }
        }

        if (!this.displayName) {
            this.showMessage('Please enter a display name', true);
            return false;
        }

        return true;
    },

    /**
     * Build AI prompt (saves design brief first)
     */
    async buildPrompt() {
        this.saveCurrentTabData();

        if (!this.validateInfo()) {
            this.activeTab = 'info';
            this.render();
            return;
        }

        if (!this.designBrief) {
            this.showMessage('Please enter a design brief', true);
            return;
        }

        // Save design brief to system
        try {
            const saveResp = await fetch(`/api/model-builder/systems/${encodeURIComponent(this.systemName)}/design`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ designBrief: this.designBrief })
            });
            const saveResult = await saveResp.json();
            if (!saveResult.success) {
                this.showMessage(saveResult.error || 'Failed to save design brief', true);
                return;
            }
        } catch (e) {
            this.showMessage(`Error saving design: ${e.message}`, true);
            return;
        }

        // Build the prompt
        try {
            const resp = await fetch('/api/model-builder/prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemName: this.systemName,
                    displayName: this.displayName,
                    description: this.description || this.displayName,
                    designBrief: this.designBrief
                })
            });
            const result = await resp.json();

            if (result.success) {
                this.prompt = result.prompt;
                this.activeTab = 'prompt';
                this.showMessage('Design saved. Copy prompt and paste to your AI assistant.');
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
        if (!this.prompt) return;

        try {
            await navigator.clipboard.writeText(this.prompt);
            this.showMessage('Prompt copied to clipboard');
        } catch (e) {
            const textarea = this.container.querySelector('#ai-prompt-text');
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
     * Parse Mermaid response
     */
    async parseMermaid() {
        this.saveCurrentTabData();

        if (!this.mermaidCode) {
            this.showMessage('Please paste the Mermaid diagram first', true);
            return;
        }

        try {
            const resp = await fetch('/api/model-builder/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mermaidCode: this.mermaidCode })
            });
            const result = await resp.json();

            if (result.success) {
                this.parsedResult = result;
                this.activeTab = 'preview';
                this.showMessage(`Parsed ${result.entities.length} entities`);
            } else {
                this.showMessage(result.error || 'Failed to parse Mermaid', true);
            }
        } catch (e) {
            this.showMessage(`Error: ${e.message}`, true);
        }

        this.render();
    },

    /**
     * Import entities into the system
     */
    async importEntities() {
        if (!this.parsedResult || !this.parsedResult.entities.length) {
            this.showMessage('No entities to import', true);
            return;
        }

        if (this.parsedResult.validation.errors.length > 0) {
            this.showMessage('Please fix validation errors first', true);
            return;
        }

        this.isGenerating = true;
        this.render();

        try {
            const resp = await fetch(`/api/model-builder/systems/${encodeURIComponent(this.systemName)}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entities: this.parsedResult.entities,
                    seedingInstructions: this.parsedResult.seedingInstructions || {},
                    mode: this.importMode,
                    areas: this.parsedResult.areas || {},
                    descriptions: this.parsedResult.descriptions || {}
                })
            });
            const result = await resp.json();

            this.isGenerating = false;

            if (result.success) {
                const summary = [];
                if (result.imported > 0) summary.push(`${result.imported} imported`);
                if (result.skipped > 0) summary.push(`${result.skipped} skipped`);
                if (result.replaced > 0) summary.push(`${result.replaced} replaced`);
                if (result.deleted > 0) summary.push(`${result.deleted} deleted`);

                this.showMessage(`Import complete: ${summary.join(', ')}`);

                // Show success dialog
                setTimeout(() => {
                    const portInfo = result.port ? `Port: ${result.port}` : 'Port: will be assigned automatically';
                    const details = [
                        `System '${this.systemName}' updated!`,
                        '',
                        `Start with: ./run -s ${this.systemName}`,
                        portInfo,
                        '',
                        `Import mode: ${this.importMode}`,
                        `Imported: ${result.imported}`,
                        result.skipped > 0 ? `Skipped: ${result.skipped}` : null,
                        result.replaced > 0 ? `Replaced: ${result.replaced}` : null,
                        result.deleted > 0 ? `Deleted: ${result.deleted}` : null,
                        '',
                        'Server restart required to see changes.'
                    ].filter(Boolean).join('\n');

                    alert(details);
                    this.close();
                }, 500);
            } else {
                this.showMessage(result.error || 'Failed to import entities', true);
                this.render();
            }
        } catch (e) {
            this.isGenerating = false;
            this.showMessage(`Error: ${e.message}`, true);
            this.render();
        }
    },

    /**
     * Delete a system completely
     */
    async deleteSystem() {
        const select = this.container.querySelector('#system-select');
        const systemName = select?.value;

        if (!systemName) {
            this.showMessage('No system selected', true);
            return;
        }

        // Find display name for confirmation message
        const system = this.existingSystems.find(s => s.name === systemName);
        const displayName = system?.displayName || systemName;

        // Confirm deletion
        const confirmed = confirm(
            `Are you sure you want to delete the system "${displayName}" (${systemName})?\n\n` +
            `This will permanently remove:\n` +
            `- All entity definitions\n` +
            `- All seed data files\n` +
            `- All configuration\n\n` +
            `This action cannot be undone!`
        );

        if (!confirmed) return;

        try {
            const resp = await fetch(`/api/model-builder/systems/${encodeURIComponent(systemName)}`, {
                method: 'DELETE'
            });
            const result = await resp.json();

            if (result.success) {
                // Remove from local list
                this.existingSystems = this.existingSystems.filter(s => s.name !== systemName);

                // Reset selection
                this.selectedSystem = null;
                this.systemCreated = false;
                this.systemName = '';
                this.displayName = '';
                this.description = '';
                this.designBrief = '';

                this.showMessage(`System '${displayName}' deleted successfully`);
                this.render();
            } else {
                this.showMessage(result.error || 'Failed to delete system', true);
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

        setTimeout(() => msg.remove(), 4000);
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
