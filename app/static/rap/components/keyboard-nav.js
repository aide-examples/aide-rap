/**
 * Keyboard navigation for the Entity Explorer.
 * Handles UP/DOWN, PAGE UP/DOWN, ENTER, ESC, DEL shortcuts.
 * Delegates to EntityTable (table view) or EntityExplorer (tree view).
 */
const KeyboardNav = {

  init() {
    document.addEventListener('keydown', (e) => {
      // Guard: ignore when typing in input fields
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Guard: ignore when contentEditable is active
      if (document.activeElement?.isContentEditable) return;
      // Guard: ignore when dialog/modal is open
      if (document.querySelector('dialog[open], .editor-modal[style*="flex"]')) return;
      // Guard: only active in table and tree views
      const vm = EntityExplorer.viewMode;
      if (vm !== 'table' && vm !== 'tree-h' && vm !== 'tree-v') return;

      switch (e.key) {
        case 'ArrowUp':   this._navigate(-1);  e.preventDefault(); break;
        case 'ArrowDown': this._navigate(+1);   e.preventDefault(); break;
        case 'PageUp':    this._navigate(-10);  e.preventDefault(); break;
        case 'PageDown':  this._navigate(+10);  e.preventDefault(); break;
        case 'Enter':     this._enter();         e.preventDefault(); break;
        case 'Escape':    this._escape();        e.preventDefault(); break;
        case 'Delete':    this._delete();        break;
      }
    });
  },

  _isTable() {
    return EntityExplorer.viewMode === 'table';
  },

  /**
   * Navigate selection by delta records (negative = up, positive = down).
   */
  _navigate(delta) {
    const ids = this._getVisibleIds();
    if (ids.length === 0) return;

    const currentId = EntityExplorer.selectedId;
    let newIdx;

    if (currentId == null) {
      // Nothing selected: DOWN → first, UP → last
      newIdx = delta > 0 ? 0 : ids.length - 1;
    } else {
      const currentIdx = ids.indexOf(currentId);
      if (currentIdx === -1) {
        newIdx = 0;
      } else {
        newIdx = Math.max(0, Math.min(ids.length - 1, currentIdx + delta));
      }
    }

    const newId = ids[newIdx];
    if (newId === currentId) return; // already at boundary

    // Select via the appropriate component
    if (this._isTable()) {
      EntityTable.onRowClick(newId);
    } else {
      EntityExplorer.onRowClick(newId);
    }
    this._scrollIntoView();
  },

  /**
   * ENTER: open edit form for selected record.
   */
  _enter() {
    const id = EntityExplorer.selectedId;
    if (id == null || !EntityExplorer.currentEntity) return;
    if (EntityExplorer.isCurrentEntityReadonly()) return;

    if (this._isTable()) {
      EntityTable.onEdit(id);
    } else {
      if (DetailPanel.mode === 'view') {
        EntityExplorer.onEditClick(id);
      } else {
        EntityExplorer.onRowClick(id);
      }
    }
  },

  /**
   * ESC: close edit/create panel, or clear selection.
   */
  _escape() {
    if (DetailPanel.mode === 'edit' || DetailPanel.mode === 'create') {
      DetailPanel.clear();
    } else {
      EntityExplorer.clearSelection();
      if (this._isTable()) {
        EntityTable.selectedId = null;
        EntityTable.container?.querySelectorAll('tbody tr').forEach(row => {
          row.classList.remove('selected');
        });
      }
      DetailPanel.clear();
    }
  },

  /**
   * DEL: delete selected record (with confirmation).
   */
  _delete() {
    if (!EntityExplorer.selectedId || !EntityExplorer.currentEntity) return;
    if (EntityExplorer.isCurrentEntityReadonly()) return;

    if (this._isTable()) {
      EntityTable.onDelete(EntityExplorer.selectedId);
    } else {
      EntityExplorer.onDeleteClick(EntityExplorer.selectedId);
    }
  },

  /**
   * Get visible record IDs from the DOM, in display order.
   */
  _getVisibleIds() {
    if (this._isTable()) {
      // EntityTable renders <tr data-id="..."> inside <tbody>
      const container = EntityExplorer.tableContainer;
      if (!container) return [];
      return Array.from(container.querySelectorAll('tbody tr[data-id]'))
        .map(row => parseInt(row.dataset.id));
    }

    // Tree view (tree-h, tree-v)
    const container = EntityExplorer.treeContainer;
    if (!container) return [];
    return Array.from(container.querySelectorAll('.tree-node.root-node'))
      .map(node => parseInt(node.dataset.recordId));
  },

  /**
   * Scroll the currently selected record into view.
   * Uses 'center' when near the edge, no scroll when comfortably in view.
   */
  _scrollIntoView() {
    const container = this._isTable()
      ? EntityExplorer.tableContainer
      : EntityExplorer.treeContainer;
    if (!container) return;

    const selector = this._isTable()
      ? 'tbody tr.selected'
      : '.tree-node.root-node.selected';
    const el = container.querySelector(selector);
    if (!el) return;

    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    // Comfortable margin: 1/4 of container height from each edge
    const margin = cRect.height / 4;

    if (eRect.top < cRect.top + margin || eRect.bottom > cRect.bottom - margin) {
      // Near edge or out of view → scroll to center
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Otherwise: already well within view, no scroll needed
  }
};
