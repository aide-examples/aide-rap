/**
 * BreadcrumbNav - Navigation history management for RAP
 *
 * Manages a breadcrumb trail showing navigation history:
 * - Base crumb: Current entity or view (from dropdown selection)
 * - Navigation stack: FK links, back-references, record double-clicks
 *
 * Features:
 * - Browser back/forward button integration via history.pushState
 * - Configurable display mode (full, label-only, entity-only)
 * - Auto-scroll to show newest crumb (right side)
 * - Stack depth limit (configurable, default 10)
 */
const BreadcrumbNav = {
  stack: [],
  maxDepth: 10,
  container: null,
  initialized: false,

  /**
   * Get current display mode from localStorage
   * @returns {'full' | 'label-only' | 'entity-only'}
   */
  getDisplayMode() {
    return localStorage.getItem('rap-settings-breadcrumb-display') || 'full';
  },

  /**
   * Initialize the breadcrumb navigation system
   */
  init() {
    if (this.initialized) return;

    this.container = document.getElementById('rap-menu-bar');
    if (!this.container) {
      console.warn('BreadcrumbNav: Container #rap-menu-bar not found');
      return;
    }

    // Listen for browser back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state?.rapCrumbId) {
        this.navigateToCrumb(e.state.rapCrumbId, { fromPopState: true });
      } else if (e.state?.rapBreadcrumb === false) {
        // User went back beyond our history - clear stack
        this.clear();
      }
    });

    // Replace initial state with a marker
    history.replaceState({ rapBreadcrumb: false }, '');

    this.initialized = true;
  },

  /**
   * Generate unique crumb ID
   */
  generateId() {
    return `crumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Create a crumb object
   * @param {Object} options - Crumb configuration
   * @returns {Object} Crumb object
   */
  createCrumb(options) {
    const {
      type,           // 'entity' | 'view' | 'record' | 'filtered'
      entity = null,
      view = null,    // { name, base, color }
      recordId = null,
      recordLabel = null,
      filter = null,
      filterLabel = null,  // Human-readable filter label
      viewMode = null,
      selectedId = null,   // Selected row ID (for table views)
      color = '#f5f5f5'
    } = options;

    // Compute display text based on type
    let displayText = '';
    let tooltipText = '';

    switch (type) {
      case 'entity':
        displayText = entity;
        break;
      case 'view':
        displayText = view?.name || '';
        break;
      case 'record':
        displayText = recordLabel ? `${entity} ${recordLabel}` : entity;
        tooltipText = recordLabel || '';
        break;
      case 'filtered':
        displayText = entity;
        tooltipText = filterLabel || filter || '';
        break;
    }

    return {
      id: this.generateId(),
      type,
      entity,
      view,
      recordId,
      recordLabel,
      filter,
      filterLabel,
      viewMode: viewMode || EntityExplorer?.viewMode || 'tree-v',
      selectedId: selectedId || EntityExplorer?.selectedId || null,
      color,
      displayText,
      tooltipText
    };
  },

  /**
   * Set or replace the base crumb (clears navigation stack)
   * Called when user selects from entity/view dropdown
   * @param {Object} options - Crumb configuration
   */
  setBase(options) {
    const crumb = this.createCrumb(options);
    this.stack = [crumb];

    // Update browser history
    history.pushState({ rapBreadcrumb: true, rapCrumbId: crumb.id }, '');

    this.render();
  },

  /**
   * Push a new crumb onto the stack
   * Called for FK navigation, back-ref navigation, double-click
   * @param {Object} options - Crumb configuration
   */
  push(options) {
    const crumb = this.createCrumb(options);

    // Enforce max depth - remove oldest (but keep base)
    while (this.stack.length >= this.maxDepth) {
      this.stack.splice(1, 1); // Remove second element, keep base
    }

    this.stack.push(crumb);

    // Update browser history
    history.pushState({ rapBreadcrumb: true, rapCrumbId: crumb.id }, '');

    this.render();
  },

  /**
   * Navigate to a specific crumb (truncates stack)
   * @param {string} crumbId - ID of crumb to navigate to
   * @param {Object} options - Navigation options
   */
  async navigateToCrumb(crumbId, options = {}) {
    const index = this.stack.findIndex(c => c.id === crumbId);
    if (index === -1) return;

    const crumb = this.stack[index];

    // Truncate stack to this point
    this.stack = this.stack.slice(0, index + 1);

    // Update browser history (unless called from popstate)
    if (!options.fromPopState) {
      history.pushState({ rapBreadcrumb: true, rapCrumbId: crumbId }, '');
    }

    // Restore application state
    await this.restoreState(crumb);

    this.render();
  },

  /**
   * Restore application state from crumb
   * Uses selectEntityWithoutBreadcrumb to avoid triggering new breadcrumb updates
   * @param {Object} crumb - Crumb to restore
   */
  async restoreState(crumb) {
    switch (crumb.type) {
      case 'entity':
        // Select entity and load records (without breadcrumb update)
        await EntityExplorer.selectEntityWithoutBreadcrumb(crumb.entity);
        // Restore view mode
        if (crumb.viewMode) {
          EntityExplorer.setViewMode(crumb.viewMode);
        }
        // Restore selected row if any
        if (crumb.selectedId) {
          EntityExplorer.selectedId = crumb.selectedId;
          EntityExplorer.updateSelection();
          const record = EntityExplorer.records.find(r => r.id === crumb.selectedId);
          if (record) {
            DetailPanel.showRecord(crumb.entity, record);
          }
        }
        break;

      case 'view':
        // Manually restore view state without calling selectViewFromDropdown
        if (crumb.view) {
          EntityExplorer.viewSelectorValue = crumb.view.name;
          const viewText = EntityExplorer.viewSelectorTrigger?.querySelector('.view-selector-text');
          if (viewText) viewText.textContent = crumb.view.name;
          EntityExplorer.viewSelectorTrigger.style.backgroundColor = crumb.view.color || '';

          // Deselect entity
          EntityExplorer.selectorValue = '';
          const entityText = EntityExplorer.selectorTrigger?.querySelector('.entity-selector-text');
          if (entityText) entityText.textContent = i18n.t('select_entity');
          EntityExplorer.selectorTrigger.style.backgroundColor = '';

          await EntityExplorer.onViewChange(crumb.view.name, crumb.view.base, crumb.view.color);
        }
        // Restore view mode
        if (crumb.viewMode) {
          EntityExplorer.setViewMode(crumb.viewMode);
        }
        // Restore selected row if any
        if (crumb.selectedId) {
          EntityExplorer.selectedId = crumb.selectedId;
          EntityExplorer.updateSelection();
        }
        break;

      case 'record':
        // Navigate to specific record in tree view
        await EntityExplorer.selectEntityWithoutBreadcrumb(crumb.entity);
        if (crumb.recordId) {
          EntityExplorer.selectedId = crumb.recordId;
          const record = EntityExplorer.records.find(r => r.id === crumb.recordId);
          if (record) {
            DetailPanel.showRecord(crumb.entity, record);
          }
        }
        // Restore view mode
        if (crumb.viewMode) {
          EntityExplorer.setViewMode(crumb.viewMode);
        }
        break;

      case 'filtered':
        // Navigate to entity with filter
        await EntityExplorer.selectEntityWithoutBreadcrumb(crumb.entity);
        if (crumb.filter) {
          EntityExplorer.filterInput.value = crumb.filter;
          await EntityExplorer.loadRecords(crumb.filter);
        }
        // Restore view mode
        if (crumb.viewMode) {
          EntityExplorer.setViewMode(crumb.viewMode);
        }
        // Restore selected row if any
        if (crumb.selectedId) {
          EntityExplorer.selectedId = crumb.selectedId;
          EntityExplorer.updateSelection();
        }
        break;
    }
  },

  /**
   * Clear the entire stack
   */
  clear() {
    this.stack = [];
    this.render();
  },

  /**
   * Get the current (top) crumb
   * @returns {Object|null}
   */
  getCurrent() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  },

  /**
   * Update the current crumb's selectedId and viewMode
   * Called before pushing a new crumb to remember which row we navigated from
   * @param {number} selectedId - Selected record ID
   * @param {string} viewMode - Current view mode
   */
  updateCurrentSelection(selectedId, viewMode) {
    const current = this.getCurrent();
    if (current) {
      current.selectedId = selectedId;
      if (viewMode) {
        current.viewMode = viewMode;
      }
    }
  },

  /**
   * Get crumb display text based on display mode
   * @param {Object} crumb - Crumb object
   * @returns {Object} { text, tooltip }
   */
  getDisplayText(crumb) {
    const mode = this.getDisplayMode();
    let text = '';
    let tooltip = '';

    switch (crumb.type) {
      case 'entity':
        text = crumb.entity;
        break;

      case 'view':
        text = crumb.view?.name || '';
        break;

      case 'record':
        switch (mode) {
          case 'full':
            text = crumb.recordLabel ? `${crumb.entity} ${crumb.recordLabel}` : crumb.entity;
            break;
          case 'label-only':
            text = crumb.recordLabel || crumb.entity;
            tooltip = crumb.entity;
            break;
          case 'entity-only':
            text = crumb.entity;
            tooltip = crumb.recordLabel || '';
            break;
        }
        break;

      case 'filtered':
        text = crumb.entity;
        tooltip = crumb.filterLabel || crumb.filter || '';
        break;
    }

    return { text, tooltip };
  },

  /**
   * Render the breadcrumb trail
   */
  render() {
    if (!this.container) return;

    if (this.stack.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    let html = '<div class="breadcrumb-trail">';

    this.stack.forEach((crumb, index) => {
      const isLast = index === this.stack.length - 1;
      const activeClass = isLast ? 'active' : '';
      const { text, tooltip } = this.getDisplayText(crumb);

      // Add filter icon for filtered crumbs
      const filterIcon = crumb.type === 'filtered' ? ' <span class="crumb-filter-icon">&#9881;</span>' : '';

      // Build tooltip attribute
      const tooltipAttr = tooltip ? ` title="${DomUtils.escapeHtml(tooltip)}"` : '';

      html += `
        <button class="breadcrumb-item ${activeClass}"
                data-crumb-id="${crumb.id}"
                style="background-color: ${crumb.color}"${tooltipAttr}>
          <span class="crumb-text">${DomUtils.escapeHtml(text)}${filterIcon}</span>
        </button>
      `;

      if (!isLast) {
        html += '<span class="breadcrumb-separator">&#8250;</span>';
      }
    });

    html += '</div>';
    this.container.innerHTML = html;

    // Attach click handlers to non-active crumbs
    this.container.querySelectorAll('.breadcrumb-item:not(.active)').forEach(btn => {
      btn.addEventListener('click', () => {
        this.navigateToCrumb(btn.dataset.crumbId);
      });
    });

    // Auto-scroll to show the newest crumb (right side)
    const trail = this.container.querySelector('.breadcrumb-trail');
    if (trail) {
      trail.scrollLeft = trail.scrollWidth;
    }
  }
};
