/**
 * ProcessPanel - Renders a business process as tabbed markdown content.
 *
 * Not a modal dialog — renders into the main content area (#process-panel-container).
 * Each step is a tab; step body is rendered as markdown via marked.js.
 * Action buttons ("Open View" / "Open Entity") navigate to views/entities.
 *
 * Admin features:
 * - Step-Edit: Pencil button per step → edit title + body inline
 * - Raw-Edit: </> button in header → edit full markdown file
 * - Description-Edit: Pencil button next to description
 */
const ProcessPanel = {

  container: null,
  currentProcess: null,
  activeStepIndex: 0,
  context: {},           // { EntityType: "label" } — accumulated context

  // Edit state
  editingStep: null,        // Step index being edited (null = view mode)
  editingRaw: false,        // Raw markdown editor active
  editingDescription: false, // Description editor active
  _editOriginalBody: null,
  _editOriginalTitle: null,
  _editOriginalDesc: null,
  _rawOriginalContent: null,

  /** Simple English plural: Engine→Engines, Process→Processes, Category→Categories */
  _pluralize(word) {
    if (/(?:s|x|z|ch|sh)$/i.test(word)) return word + 'es';
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
    return word + 's';
  },

  _isAdmin() {
    return window.currentUser && window.currentUser.role === 'admin';
  },

  init() {
    this.container = document.getElementById('process-panel-container');
  },

  /**
   * Load and display a process.
   * @param {Object} processData - { name, description, color, required, steps: [{title, body, view, entity}] }
   * @param {Object} [initialContext] - Optional initial context { EntityType: "label" }
   */
  show(processData, initialContext) {
    this.currentProcess = processData;
    this.activeStepIndex = 0;
    this.context = initialContext || {};
    this.editingStep = null;
    this.editingRaw = false;
    this.editingDescription = false;
    this.render();
  },

  /**
   * Set the active step and update tab highlight + content.
   * @param {number} index - Step index (0-based)
   */
  setActiveStep(index) {
    if (!this.currentProcess || index < 0 || index >= this.currentProcess.steps.length) return;
    this.editingStep = null; // Exit step edit when switching tabs
    this.activeStepIndex = index;
    this.renderStep();
    // Update active tab highlight
    this.container?.querySelectorAll('.process-tab').forEach(t =>
      t.classList.toggle('active', parseInt(t.dataset.step, 10) === index)
    );
  },

  /**
   * Clear the process panel.
   */
  clear() {
    this.currentProcess = null;
    this.activeStepIndex = 0;
    this.context = {};
    this.editingStep = null;
    this.editingRaw = false;
    this.editingDescription = false;
    if (this.container) this.container.innerHTML = '';
  },

  // ─── MAIN RENDER ─────────────────────────────────────────────────

  /**
   * Render the full process panel (tabs + content).
   */
  render() {
    if (!this.container || !this.currentProcess) return;

    const process = this.currentProcess;
    const steps = process.steps || [];
    const isAdmin = this._isAdmin();

    // Build tab bar
    const tabsHtml = steps.map((step, i) => {
      const activeClass = i === this.activeStepIndex ? ' active' : '';
      const title = DomUtils.escapeHtml(step.title);
      return `<button class="process-tab${activeClass}" data-step="${i}" title="${title}">${title}</button>`;
    }).join('');

    // Build description line with optional edit button
    const descEditBtn = isAdmin
      ? `<button class="process-edit-btn process-desc-edit-btn" title="Edit description"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>`
      : '';
    const descHtml = process.description
      ? `<div class="process-description" id="process-desc-display">${DomUtils.escapeHtml(process.description)}${descEditBtn}</div>`
      : (isAdmin ? `<div class="process-description process-description-empty" id="process-desc-display"><em>No description</em>${descEditBtn}</div>` : '');

    // Build context display (filter internal keys like _ids)
    const contextEntries = Object.entries(this.context).filter(([k]) => !k.startsWith('_'));
    const contextHtml = contextEntries.length > 0
      ? `<div class="process-context">${contextEntries.map(([k, v]) =>
          `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(String(v))}</strong></span>`
        ).join(' ')}</div>`
      : '';

    // Admin: raw-edit button in title row
    const rawEditBtn = isAdmin
      ? `<button class="process-raw-edit-btn" title="Edit Markdown"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 18 22 12"/><polyline points="8 6 2 6 2 12"/><line x1="2" y1="12" x2="22" y2="12"/></svg></button>`
      : '';

    this.container.innerHTML = `
      <div class="process-header">
        <div class="process-title-row">
          <span class="process-title">${DomUtils.escapeHtml(process.name)}</span>
          <div class="process-title-actions">
            ${rawEditBtn}
            <button class="process-close-btn" title="Close process">&times;</button>
          </div>
        </div>
        <div id="process-desc-container">${descHtml}</div>
        ${contextHtml}
      </div>
      <div class="process-tabs-bar">
        <button class="process-tabs-arrow process-tabs-arrow-left">&#9666;</button>
        <div class="process-tabs-scroll">${tabsHtml}</div>
        <button class="process-tabs-arrow process-tabs-arrow-right">&#9656;</button>
      </div>
      <div class="process-step-content"></div>
    `;

    // Attach tab click handlers
    this.container.querySelectorAll('.process-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.setActiveStep(parseInt(tab.dataset.step, 10));
      });
    });

    // Close button
    this.container.querySelector('.process-close-btn')?.addEventListener('click', () => {
      if (typeof EntityExplorer !== 'undefined') EntityExplorer.closeProcess();
    });

    // Raw-edit button
    this.container.querySelector('.process-raw-edit-btn')?.addEventListener('click', () => {
      this.enterRawEdit();
    });

    // Description edit button
    this.container.querySelector('.process-desc-edit-btn')?.addEventListener('click', () => {
      this.enterDescriptionEdit();
    });

    // Scroll arrows for tab overflow
    const scrollEl = this.container.querySelector('.process-tabs-scroll');
    if (scrollEl) {
      const updateIndicators = () => {
        const bar = scrollEl.parentElement;
        bar.classList.toggle('scroll-left', scrollEl.scrollLeft > 0);
        bar.classList.toggle('scroll-right', scrollEl.scrollLeft + scrollEl.clientWidth < scrollEl.scrollWidth - 1);
      };
      scrollEl.addEventListener('scroll', updateIndicators);
      requestAnimationFrame(updateIndicators);
      // Arrow click scrolling
      this.container.querySelector('.process-tabs-arrow-left')?.addEventListener('click', () => {
        scrollEl.scrollBy({ left: -120, behavior: 'smooth' });
      });
      this.container.querySelector('.process-tabs-arrow-right')?.addEventListener('click', () => {
        scrollEl.scrollBy({ left: 120, behavior: 'smooth' });
      });
    }

    this.renderStep();
  },

  // ─── STEP VIEW / EDIT ────────────────────────────────────────────

  /**
   * Render the active step content (view or edit mode).
   */
  renderStep() {
    const contentEl = this.container?.querySelector('.process-step-content');
    if (!contentEl || !this.currentProcess) return;

    // If in raw-edit mode, don't render step
    if (this.editingRaw) return;

    const step = this.currentProcess.steps[this.activeStepIndex];
    if (!step) {
      contentEl.innerHTML = '<p>No step content.</p>';
      return;
    }

    if (this.editingStep === this.activeStepIndex) {
      this._renderStepEdit(contentEl, step);
    } else {
      this._renderStepView(contentEl, step);
    }
  },

  /**
   * Render step in view mode (markdown + action buttons).
   */
  _renderStepView(contentEl, step) {
    const isAdmin = this._isAdmin();

    // Render markdown body
    let bodyHtml = '';
    if (step.body && typeof marked !== 'undefined') {
      bodyHtml = marked.parse(step.body);
    } else if (step.body) {
      bodyHtml = `<pre>${DomUtils.escapeHtml(step.body)}</pre>`;
    }

    // Admin edit button
    const editBtnHtml = isAdmin
      ? `<div class="process-step-header-row"><button class="process-edit-btn" title="Edit step"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button></div>`
      : '';

    // Build action buttons
    const actionsHtml = this._buildActionButtons(step);

    contentEl.innerHTML = `
      ${editBtnHtml}
      <div class="process-step-body">${bodyHtml}</div>
      ${actionsHtml ? `<div class="process-actions">${actionsHtml}</div>` : ''}
    `;

    // Edit button handler
    contentEl.querySelector('.process-edit-btn')?.addEventListener('click', () => {
      this.editingStep = this.activeStepIndex;
      this._editOriginalBody = step.body || '';
      this._editOriginalTitle = step.title || '';
      this.renderStep();
    });

    // Attach action button handlers
    this._attachActionHandlers(contentEl);
  },

  /**
   * Render step in edit mode (title input + textarea + save/cancel).
   */
  _renderStepEdit(contentEl, step) {
    // Build directives info (read-only)
    const directives = [];
    for (const e of (step.entities || [])) directives.push(`Entity: ${e}`);
    if (step.view) directives.push(`View: ${step.view}`);
    if (step.call) directives.push(`Call: ${step.call}`);
    const directivesHtml = directives.length > 0
      ? `<div class="process-edit-directives">
          <span class="process-edit-directives-label">Directives (read-only):</span>
          ${directives.map(d => `<code>${DomUtils.escapeHtml(d)}</code>`).join(' ')}
        </div>`
      : '';

    contentEl.innerHTML = `
      <div class="process-edit-form">
        <label class="process-edit-label">Step Title</label>
        <input type="text" class="process-edit-title" value="${DomUtils.escapeHtml(step.title || '')}">
        <label class="process-edit-label">Step Content (Markdown)</label>
        <textarea class="process-edit-body">${DomUtils.escapeHtml(step.body || '')}</textarea>
        ${directivesHtml}
        <div class="process-edit-actions">
          <button class="process-edit-cancel">Cancel</button>
          <button class="process-edit-save" disabled>Save</button>
        </div>
      </div>
    `;

    const titleInput = contentEl.querySelector('.process-edit-title');
    const bodyTextarea = contentEl.querySelector('.process-edit-body');
    const saveBtn = contentEl.querySelector('.process-edit-save');
    const cancelBtn = contentEl.querySelector('.process-edit-cancel');

    // Dirty detection
    const checkDirty = () => {
      const dirty = titleInput.value !== this._editOriginalTitle || bodyTextarea.value !== this._editOriginalBody;
      saveBtn.disabled = !dirty;
    };
    titleInput.addEventListener('input', checkDirty);
    bodyTextarea.addEventListener('input', checkDirty);

    // Cancel
    cancelBtn.addEventListener('click', () => {
      this.editingStep = null;
      this.renderStep();
    });

    // Save
    saveBtn.addEventListener('click', () => {
      this._saveStep(titleInput.value, bodyTextarea.value);
    });

    // Ctrl+S shortcut
    const ctrlSHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!saveBtn.disabled) this._saveStep(titleInput.value, bodyTextarea.value);
      }
    };
    titleInput.addEventListener('keydown', ctrlSHandler);
    bodyTextarea.addEventListener('keydown', ctrlSHandler);

    // Focus textarea
    bodyTextarea.focus();
  },

  /**
   * Save step changes via structured PUT.
   */
  async _saveStep(newTitle, newBody) {
    const process = this.currentProcess;
    const stepIndex = this.activeStepIndex;

    const payload = {
      description: process.description,
      steps: process.steps.map((s, i) => ({
        title: i === stepIndex ? newTitle : s.title,
        body: i === stepIndex ? newBody : s.body
      }))
    };

    const saveBtn = this.container?.querySelector('.process-edit-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
      const res = await fetch(`/api/processes/${encodeURIComponent(process.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();

      if (result.error) {
        alert('Save failed: ' + result.error);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        return;
      }

      // Update in-memory
      process.steps[stepIndex].title = newTitle;
      process.steps[stepIndex].body = newBody;

      // Update tab title
      const tab = this.container?.querySelector(`.process-tab[data-step="${stepIndex}"]`);
      if (tab) {
        tab.textContent = newTitle;
        tab.title = newTitle;
      }

      // Exit edit mode
      this.editingStep = null;
      this.renderStep();
    } catch (err) {
      alert('Save failed: ' + err.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  },

  // ─── RAW EDIT ────────────────────────────────────────────────────

  /**
   * Enter raw markdown edit mode.
   */
  async enterRawEdit() {
    const process = this.currentProcess;
    if (!process) return;

    this.editingRaw = true;
    this.editingStep = null;

    // Hide tabs, show raw editor in step-content area
    const tabsBar = this.container?.querySelector('.process-tabs-bar');
    const contentEl = this.container?.querySelector('.process-step-content');
    if (!contentEl) return;

    if (tabsBar) tabsBar.style.display = 'none';

    contentEl.innerHTML = `
      <div class="process-raw-editor">
        <div class="process-raw-path">Loading...</div>
        <textarea class="process-raw-textarea" disabled>Loading...</textarea>
        <div class="process-edit-actions">
          <button class="process-edit-cancel">Cancel</button>
          <button class="process-edit-save" disabled>Save</button>
        </div>
      </div>
    `;

    // Load raw content
    try {
      const res = await fetch(`/api/processes/${encodeURIComponent(process.name)}/raw`);
      const data = await res.json();

      if (data.error) {
        contentEl.innerHTML = `<div class="process-raw-editor"><p>Error: ${DomUtils.escapeHtml(data.error)}</p></div>`;
        return;
      }

      this._rawOriginalContent = data.content;

      const pathEl = contentEl.querySelector('.process-raw-path');
      const textarea = contentEl.querySelector('.process-raw-textarea');
      const saveBtn = contentEl.querySelector('.process-edit-save');
      const cancelBtn = contentEl.querySelector('.process-edit-cancel');

      pathEl.textContent = data.path;
      textarea.value = data.content;
      textarea.disabled = false;

      // Dirty detection
      textarea.addEventListener('input', () => {
        saveBtn.disabled = textarea.value === this._rawOriginalContent;
      });

      // Cancel
      cancelBtn.addEventListener('click', () => {
        this.exitRawEdit();
      });

      // Save
      saveBtn.addEventListener('click', () => {
        this._saveRaw(textarea.value);
      });

      // Ctrl+S
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          if (!saveBtn.disabled) this._saveRaw(textarea.value);
        }
      });

      textarea.focus();
    } catch (err) {
      contentEl.innerHTML = `<div class="process-raw-editor"><p>Error: ${DomUtils.escapeHtml(err.message)}</p></div>`;
    }
  },

  /**
   * Exit raw-edit mode, re-render process.
   */
  exitRawEdit() {
    this.editingRaw = false;
    const tabsBar = this.container?.querySelector('.process-tabs-bar');
    if (tabsBar) tabsBar.style.display = '';
    this.renderStep();
  },

  /**
   * Save raw markdown via PUT.
   */
  async _saveRaw(content) {
    const process = this.currentProcess;
    const saveBtn = this.container?.querySelector('.process-edit-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
      const res = await fetch(`/api/processes/${encodeURIComponent(process.name)}/raw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const result = await res.json();

      if (result.error) {
        alert('Save failed: ' + result.error);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        return;
      }

      this._rawOriginalContent = content;

      // Reload process data and re-render completely
      await this._reloadProcess();
    } catch (err) {
      alert('Save failed: ' + err.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  },

  /**
   * Reload current process from server and re-render.
   */
  async _reloadProcess() {
    const process = this.currentProcess;
    if (!process) return;

    try {
      const res = await fetch(`/api/processes/${encodeURIComponent(process.name)}`);
      const data = await res.json();

      if (data.error) {
        console.error('Failed to reload process:', data.error);
        return;
      }

      // Preserve context
      const ctx = this.context;
      this.currentProcess = data;
      this.context = ctx;
      this.editingRaw = false;
      this.editingStep = null;
      this.activeStepIndex = Math.min(this.activeStepIndex, (data.steps || []).length - 1);
      if (this.activeStepIndex < 0) this.activeStepIndex = 0;
      this.render();
    } catch (err) {
      console.error('Failed to reload process:', err);
    }
  },

  // ─── DESCRIPTION EDIT ────────────────────────────────────────────

  /**
   * Enter description edit mode.
   */
  enterDescriptionEdit() {
    const descContainer = this.container?.querySelector('#process-desc-container');
    if (!descContainer) return;

    this.editingDescription = true;
    this._editOriginalDesc = this.currentProcess.description || '';

    descContainer.innerHTML = `
      <div class="process-desc-edit-form">
        <textarea class="process-desc-textarea">${DomUtils.escapeHtml(this._editOriginalDesc)}</textarea>
        <div class="process-edit-actions">
          <button class="process-edit-cancel">Cancel</button>
          <button class="process-edit-save" disabled>Save</button>
        </div>
      </div>
    `;

    const textarea = descContainer.querySelector('.process-desc-textarea');
    const saveBtn = descContainer.querySelector('.process-edit-save');
    const cancelBtn = descContainer.querySelector('.process-edit-cancel');

    textarea.addEventListener('input', () => {
      saveBtn.disabled = textarea.value === this._editOriginalDesc;
    });

    cancelBtn.addEventListener('click', () => {
      this.editingDescription = false;
      this._rerenderDescription();
    });

    saveBtn.addEventListener('click', () => {
      this._saveDescription(textarea.value);
    });

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!saveBtn.disabled) this._saveDescription(textarea.value);
      }
    });

    textarea.focus();
  },

  /**
   * Save description via structured PUT.
   */
  async _saveDescription(newDesc) {
    const process = this.currentProcess;
    const saveBtn = this.container?.querySelector('#process-desc-container .process-edit-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    const payload = {
      description: newDesc,
      steps: process.steps.map(s => ({ title: s.title, body: s.body }))
    };

    try {
      const res = await fetch(`/api/processes/${encodeURIComponent(process.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();

      if (result.error) {
        alert('Save failed: ' + result.error);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        return;
      }

      process.description = newDesc;
      this.editingDescription = false;
      this._rerenderDescription();
    } catch (err) {
      alert('Save failed: ' + err.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  },

  /**
   * Re-render the description display after edit.
   */
  _rerenderDescription() {
    const descContainer = this.container?.querySelector('#process-desc-container');
    if (!descContainer) return;

    const isAdmin = this._isAdmin();
    const descEditBtn = isAdmin
      ? `<button class="process-edit-btn process-desc-edit-btn" title="Edit description"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>`
      : '';

    const process = this.currentProcess;
    descContainer.innerHTML = process.description
      ? `<div class="process-description" id="process-desc-display">${DomUtils.escapeHtml(process.description)}${descEditBtn}</div>`
      : (isAdmin ? `<div class="process-description process-description-empty" id="process-desc-display"><em>No description</em>${descEditBtn}</div>` : '');

    descContainer.querySelector('.process-desc-edit-btn')?.addEventListener('click', () => {
      this.enterDescriptionEdit();
    });
  },

  // ─── ACTION BUTTONS (shared) ─────────────────────────────────────

  /**
   * Build HTML for action buttons (view, entity, call).
   */
  _buildActionButtons(step) {
    let actionsHtml = '';
    if (step.view) {
      const viewContext = step.viewContext || null;
      const viewLabel = viewContext && this.context[viewContext]
        ? `${step.view} (${this.context[viewContext]})`
        : step.view;
      actionsHtml += `<button class="process-action-btn process-action-view" data-view="${DomUtils.escapeHtml(step.view)}"
                              ${viewContext ? `data-view-context="${DomUtils.escapeHtml(viewContext)}"` : ''}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="8" width="3" height="6"/><rect x="4" y="4" width="3" height="10"/><rect x="8" y="6" width="3" height="8"/><rect x="12" y="2" width="2" height="12"/></svg>
        Open View: ${DomUtils.escapeHtml(viewLabel)}
      </button>`;
    }
    for (const entityDef of (step.entities || [])) {
      const entityMatch = entityDef.match(/^(.+?)\((\w+)\)(?:\s+"(.+)")?$/);
      const entityName = entityMatch ? entityMatch[1].trim() : entityDef;
      const contextKey = entityMatch ? entityMatch[2] : null;
      const labelTemplate = entityMatch ? entityMatch[3] : null;
      let entityLabel;
      if (labelTemplate) {
        entityLabel = labelTemplate.replace(/\{(\w+)\}/g, (_, key) => this.context[key] || key);
      } else if (contextKey && contextKey === entityName) {
        entityLabel = `${entityName}: ${this.context[contextKey] || ''}`;
      } else if (contextKey) {
        const fkCol = this.context._fkColumns?.[contextKey];
        const value = this.context[contextKey] || contextKey;
        const plural = this._pluralize(entityName);
        entityLabel = fkCol ? `${plural} (${fkCol}: ${value})` : `${plural} (${value})`;
      } else {
        entityLabel = `Open Entity: ${entityName}`;
      }
      const areaColor = typeof EntityExplorer !== 'undefined'
        ? EntityExplorer.selectorMenu?.querySelector(`[data-value="${entityName}"]`)?.dataset.color || ''
        : '';
      actionsHtml += `<button class="process-action-btn process-action-entity"
                              data-entity="${DomUtils.escapeHtml(entityName)}"
                              ${contextKey ? `data-entity-context="${DomUtils.escapeHtml(contextKey)}"` : ''}
                              style="${areaColor ? `border-left: 6px solid ${areaColor}; background: linear-gradient(to right, ${areaColor}4D, transparent)` : ''}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="0" width="6" height="3"/><rect x="8" y="0" width="6" height="3"/><rect x="0" y="5" width="6" height="3"/><rect x="8" y="5" width="6" height="3"/><rect x="0" y="10" width="6" height="3"/><rect x="8" y="10" width="6" height="3"/></svg>
        ${DomUtils.escapeHtml(entityLabel)}
      </button>`;
    }
    if (step.call) {
      const callMatch = step.call.match(/^(.+?)\((\w+)\)$/);
      const callLabel = callMatch ? callMatch[1].trim() : step.call;
      const callContextKey = callMatch ? callMatch[2] : null;
      const hasCallContext = !callContextKey || this.context[callContextKey];
      actionsHtml += `<button class="process-action-btn process-action-call"
                              data-call-label="${DomUtils.escapeHtml(callLabel)}"
                              data-call-context="${DomUtils.escapeHtml(callContextKey || '')}"
                              ${!hasCallContext ? 'disabled title="Select entity first"' : ''}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="3" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="8" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
        ${DomUtils.escapeHtml(callLabel)}
      </button>`;
    }
    // Select status indicator
    if (step.select) {
      const selectedLabel = this.context[step.select];
      if (selectedLabel) {
        actionsHtml += `<div class="process-select-status">
          <span class="process-select-check">&#10003;</span>
          Selected: <strong>${DomUtils.escapeHtml(selectedLabel)}</strong>
        </div>`;
      } else {
        actionsHtml += `<div class="process-select-status process-select-pending">
          Right-click a ${DomUtils.escapeHtml(step.select)} record and choose "Use for Process"
        </div>`;
      }
    }
    return actionsHtml;
  },

  /**
   * Attach click handlers to action buttons.
   */
  _attachActionHandlers(contentEl) {
    contentEl.querySelectorAll('.process-action-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;
        const viewContext = btn.dataset.viewContext || null;
        if (typeof EntityExplorer !== 'undefined') {
          EntityExplorer.toggleProcess(false);
          EntityExplorer.selectViewByName(viewName, this.context, viewContext);
        }
      });
    });

    contentEl.querySelectorAll('.process-action-entity').forEach(btn => {
      btn.addEventListener('click', () => {
        const entityName = btn.dataset.entity;
        const contextKey = btn.dataset.entityContext;
        if (typeof EntityExplorer !== 'undefined') {
          EntityExplorer.toggleProcess(false);
          if (contextKey && this.context._ids) {
            const recordId = this.context._ids[contextKey];
            if (contextKey === entityName) {
              EntityExplorer.navigateToEntityRecord(entityName, recordId);
            } else {
              EntityExplorer.navigateToEntityFiltered(entityName, contextKey, recordId);
            }
          } else {
            EntityExplorer.selectEntityByName(entityName);
          }
        }
      });
    });

    contentEl.querySelectorAll('.process-action-call').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.dataset.callLabel;
        const contextKey = btn.dataset.callContext;
        const eqConfig = contextKey ? EntityExplorer.getExternalQueriesForEntity(contextKey) : [];
        // Match by label (supports multiple providers per entity)
        const matched = eqConfig.find(eq => eq.label === label) || eqConfig[0];
        if (!matched) return;

        // Use stored record field if available, otherwise fall back to entity label
        let searchTerm;
        if (this.context._records?.[contextKey] && matched.searchField) {
          searchTerm = this.context._records[contextKey][matched.searchField] || '';
        } else {
          searchTerm = contextKey ? (this.context[contextKey] || '') : '';
        }

        if (typeof ExternalQueryDialog !== 'undefined') {
          ExternalQueryDialog.open(matched.provider, searchTerm, label);
        }
      });
    });
  },

  // ─── CONTEXT ─────────────────────────────────────────────────────

  /**
   * Update the context with a new entry.
   * @param {string} entityType - Entity type name
   * @param {string} label - Label value
   */
  /**
   * Get the entity name expected by the current step's Select directive.
   * Returns null if no process is active or no select is pending.
   */
  getPendingSelect() {
    if (!this.currentProcess) return null;
    const step = this.currentProcess.steps[this.activeStepIndex];
    return step?.select || null;
  },

  /**
   * Add a selected record to the process context (called from "Use for Process").
   * Stores label, ID, full record, and resolves FK relationships.
   */
  selectForProcess(entityName, record, schema) {
    const lbl = ColumnUtils.getRecordLabel(record, schema);
    this.context[entityName] = lbl.title;

    this.context._ids = this.context._ids || {};
    this.context._ids[entityName] = record.id;

    this.context._records = this.context._records || {};
    this.context._records[entityName] = record;

    // Resolve FK relationships (additive)
    this.context._fkColumns = this.context._fkColumns || {};
    for (const col of schema.columns) {
      if (col.foreignKey) {
        const labelCol = col.name.replace(/_id$/, '') + '_label';
        if (record[labelCol]) {
          this.context[col.foreignKey.entity] = record[labelCol];
          this.context._ids[col.foreignKey.entity] = record[col.name];
          this.context._fkColumns[col.foreignKey.entity] = col.name.replace(/_id$/, '');
        }
      }
    }

    // Re-render current step (updates select status + enables Call buttons)
    this.renderStep(this.activeStepIndex);

    // Update context display in header
    this.addContext(entityName, lbl.title);
  },

  addContext(entityType, label) {
    if (entityType && label) {
      this.context[entityType] = label;
      // Re-render context display if visible (filter internal keys like _ids)
      const entries = Object.entries(this.context).filter(([k]) => !k.startsWith('_'));
      const contextEl = this.container?.querySelector('.process-context');
      if (contextEl) {
        contextEl.innerHTML = entries.map(([k, v]) =>
          `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(String(v))}</strong></span>`
        ).join(' ');
      } else if (entries.length > 0) {
        // Add context display if it didn't exist before
        const headerEl = this.container?.querySelector('.process-header');
        if (headerEl) {
          const div = document.createElement('div');
          div.className = 'process-context';
          div.innerHTML = entries.map(([k, v]) =>
            `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(String(v))}</strong></span>`
          ).join(' ');
          headerEl.appendChild(div);
        }
      }
    }
  }
};
