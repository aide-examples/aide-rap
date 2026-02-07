/**
 * ProcessPanel - Renders a business process as tabbed markdown content.
 *
 * Not a modal dialog — renders into the main content area (#process-panel-container).
 * Each step is a tab; step body is rendered as markdown via marked.js.
 * Action buttons ("Open View" / "Open Entity") navigate to views/entities.
 */
const ProcessPanel = {

  container: null,
  currentProcess: null,
  activeStepIndex: 0,
  context: {},           // { EntityType: "label" } — accumulated context

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
    this.render();
  },

  /**
   * Clear the process panel.
   */
  clear() {
    this.currentProcess = null;
    this.activeStepIndex = 0;
    this.context = {};
    if (this.container) this.container.innerHTML = '';
  },

  /**
   * Render the full process panel (tabs + content).
   */
  render() {
    if (!this.container || !this.currentProcess) return;

    const process = this.currentProcess;
    const steps = process.steps || [];

    // Build tab bar
    const tabsHtml = steps.map((step, i) => {
      const activeClass = i === this.activeStepIndex ? ' active' : '';
      const title = DomUtils.escapeHtml(step.title);
      return `<button class="process-tab${activeClass}" data-step="${i}" title="${title}">${title}</button>`;
    }).join('');

    // Build description line
    const descHtml = process.description
      ? `<div class="process-description">${DomUtils.escapeHtml(process.description)}</div>`
      : '';

    // Build context display
    const contextHtml = Object.keys(this.context).length > 0
      ? `<div class="process-context">${Object.entries(this.context).map(([k, v]) =>
          `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(v)}</strong></span>`
        ).join(' ')}</div>`
      : '';

    this.container.innerHTML = `
      <div class="process-header">
        <div class="process-title-row">
          <span class="process-title">${DomUtils.escapeHtml(process.name)}</span>
          <button class="process-close-btn" title="Close process">&times;</button>
        </div>
        ${descHtml}
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
        this.activeStepIndex = parseInt(tab.dataset.step, 10);
        this.renderStep();
        // Update active tab
        this.container.querySelectorAll('.process-tab').forEach(t =>
          t.classList.toggle('active', parseInt(t.dataset.step, 10) === this.activeStepIndex)
        );
      });
    });

    // Close button
    this.container.querySelector('.process-close-btn')?.addEventListener('click', () => {
      if (typeof EntityExplorer !== 'undefined') EntityExplorer.closeProcess();
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

  /**
   * Render the active step content.
   */
  renderStep() {
    const contentEl = this.container?.querySelector('.process-step-content');
    if (!contentEl || !this.currentProcess) return;

    const step = this.currentProcess.steps[this.activeStepIndex];
    if (!step) {
      contentEl.innerHTML = '<p>No step content.</p>';
      return;
    }

    // Render markdown body
    let bodyHtml = '';
    if (step.body && typeof marked !== 'undefined') {
      bodyHtml = marked.parse(step.body);
    } else if (step.body) {
      bodyHtml = `<pre>${DomUtils.escapeHtml(step.body)}</pre>`;
    }

    // Build action buttons
    let actionsHtml = '';
    if (step.view) {
      actionsHtml += `<button class="process-action-btn process-action-view" data-view="${DomUtils.escapeHtml(step.view)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="8" width="3" height="6"/><rect x="4" y="4" width="3" height="10"/><rect x="8" y="6" width="3" height="8"/><rect x="12" y="2" width="2" height="12"/></svg>
        Open View: ${DomUtils.escapeHtml(step.view)}
      </button>`;
    }
    if (step.entity) {
      actionsHtml += `<button class="process-action-btn process-action-entity" data-entity="${DomUtils.escapeHtml(step.entity)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="0" width="6" height="3"/><rect x="8" y="0" width="6" height="3"/><rect x="0" y="5" width="6" height="3"/><rect x="8" y="5" width="6" height="3"/><rect x="0" y="10" width="6" height="3"/><rect x="8" y="10" width="6" height="3"/></svg>
        Open Entity: ${DomUtils.escapeHtml(step.entity)}
      </button>`;
    }

    contentEl.innerHTML = `
      <div class="process-step-body">${bodyHtml}</div>
      ${actionsHtml ? `<div class="process-actions">${actionsHtml}</div>` : ''}
    `;

    // Attach action button handlers
    contentEl.querySelectorAll('.process-action-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;
        if (typeof EntityExplorer !== 'undefined') {
          EntityExplorer.toggleProcess(false); // hide process panel
          EntityExplorer.selectViewByName(viewName, this.context);
        }
      });
    });

    contentEl.querySelectorAll('.process-action-entity').forEach(btn => {
      btn.addEventListener('click', () => {
        const entityName = btn.dataset.entity;
        if (typeof EntityExplorer !== 'undefined') {
          EntityExplorer.toggleProcess(false); // hide process panel
          EntityExplorer.selectEntityByName(entityName);
        }
      });
    });
  },

  /**
   * Update the context with a new entry.
   * @param {string} entityType - Entity type name
   * @param {string} label - Label value
   */
  addContext(entityType, label) {
    if (entityType && label) {
      this.context[entityType] = label;
      // Re-render context display if visible
      const contextEl = this.container?.querySelector('.process-context');
      if (contextEl) {
        contextEl.innerHTML = Object.entries(this.context).map(([k, v]) =>
          `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(v)}</strong></span>`
        ).join(' ');
      } else if (Object.keys(this.context).length > 0) {
        // Add context display if it didn't exist before
        const headerEl = this.container?.querySelector('.process-header');
        if (headerEl) {
          const div = document.createElement('div');
          div.className = 'process-context';
          div.innerHTML = Object.entries(this.context).map(([k, v]) =>
            `<span class="process-context-tag">${DomUtils.escapeHtml(k)}: <strong>${DomUtils.escapeHtml(v)}</strong></span>`
          ).join(' ');
          headerEl.appendChild(div);
        }
      }
    }
  }
};
