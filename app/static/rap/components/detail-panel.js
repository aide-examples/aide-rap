/**
 * Detail Panel Component
 * Right side panel for viewing/editing records
 */
const DetailPanel = {
  panel: null,
  title: null,
  content: null,
  toggleBtn: null,
  expandBtn: null,
  showIdsToggle: null,
  isCollapsed: false,
  showIds: false,
  mode: null, // 'view', 'edit', 'create', or null

  // Current record state (for re-rendering when toggle changes)
  currentEntity: null,
  currentRecord: null,

  init() {
    this.panel = document.getElementById('detail-panel');
    this.title = document.getElementById('panel-title');
    this.content = document.getElementById('panel-content');
    this.toggleBtn = document.getElementById('panel-toggle');
    this.expandBtn = document.getElementById('panel-expand');
    this.showIdsToggle = document.getElementById('show-ids-toggle');

    // Start with panel collapsed (no record selected initially)
    this.collapse();

    // Restore show IDs state from session
    this.showIds = sessionStorage.getItem('showIds') === 'true';
    if (this.showIdsToggle) {
      this.showIdsToggle.checked = this.showIds;
      this.showIdsToggle.addEventListener('change', () => {
        this.showIds = this.showIdsToggle.checked;
        sessionStorage.setItem('showIds', this.showIds);
        // Re-render current record if any
        if (this.currentEntity && this.currentRecord) {
          this.showRecord(this.currentEntity, this.currentRecord);
        }
      });
    }

    // Event listeners
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.expandBtn.addEventListener('click', () => this.expand());
  },

  toggle() {
    if (this.isCollapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  },

  collapse() {
    this.isCollapsed = true;
    this.panel.classList.add('collapsed');
    this.expandBtn.classList.remove('hidden');
  },

  expand() {
    this.isCollapsed = false;
    this.panel.classList.remove('collapsed');
    this.expandBtn.classList.add('hidden');
  },

  setTitle(text) {
    this.title.textContent = text;
  },

  clear() {
    this.currentEntity = null;
    this.currentRecord = null;
    this.mode = null;
    this.setTitle('Details');
    this.content.innerHTML = '<p class="empty-message">Select a record to view details.</p>';
  },

  /**
   * Hide the panel completely (used when deselecting a record)
   */
  hide() {
    this.currentEntity = null;
    this.currentRecord = null;
    this.mode = null;
    this.collapse();
  },

  /**
   * Show the panel (used when selecting a record)
   */
  show() {
    if (this.isCollapsed) {
      this.expand();
    }
  },

  showMessage(message, type = 'info') {
    const className = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
    this.content.innerHTML = `<div class="panel-message ${className}">${message}</div>`;
  },

  async showRecord(entityName, record) {
    // Store for re-rendering when toggle changes
    this.currentEntity = entityName;
    this.currentRecord = record;
    this.mode = 'view';

    // Ensure panel is visible when showing a record
    this.show();

    this.setTitle(`${entityName} #${record.id}`);

    // Use extended schema for enum value formatting
    const schema = await SchemaCache.getExtended(entityName);

    let html = '<div class="record-details">';

    // Show record's own ID if showIds is enabled
    if (this.showIds) {
      html += `
        <div class="detail-row detail-row-id">
          <span class="detail-label">id</span>
          <span class="detail-value detail-value-id">${record.id}</span>
        </div>
      `;
    }

    for (const col of schema.columns) {
      const value = record[col.name];
      let displayValue;
      if (value === null || value === undefined) {
        displayValue = '<em>null</em>';
      } else {
        // Use ValueFormatter to convert enum internal->external
        displayValue = this.escapeHtml(ValueFormatter.format(value, col.name, schema));
      }

      // For FK columns, show both label and ID when showIds is enabled
      const isFK = col.foreignKey && value != null;
      let idSuffix = '';
      if (this.showIds && isFK) {
        idSuffix = ` <span class="detail-fk-id">[id:${value}]</span>`;
        // Use _label field if available
        const displayName = col.name.endsWith('_id') ? col.name.slice(0, -3) : col.name;
        const labelField = displayName + '_label';
        if (record[labelField]) {
          displayValue = this.escapeHtml(record[labelField]) + idSuffix;
        } else {
          displayValue = displayValue + idSuffix;
        }
      }

      html += `
        <div class="detail-row">
          <span class="detail-label">${col.name}</span>
          <span class="detail-value">${displayValue}</span>
        </div>
      `;
    }

    html += `
      <div class="form-actions">
        <button class="btn-save" id="btn-panel-edit">Edit</button>
      </div>
    </div>`;

    this.content.innerHTML = html;

    // Add edit button handler
    document.getElementById('btn-panel-edit').addEventListener('click', () => {
      this.showEditForm(entityName, record);
    });

    // Auto-expand panel if collapsed
    if (this.isCollapsed) {
      this.expand();
    }
  },

  async showCreateForm(entityName) {
    this.mode = 'create';
    this.currentEntity = entityName;
    this.currentRecord = null;

    this.setTitle(`New ${entityName}`);
    await EntityForm.render(this.content, entityName, null);

    if (this.isCollapsed) {
      this.expand();
    }
  },

  async showEditForm(entityName, record) {
    this.mode = 'edit';
    this.currentEntity = entityName;
    this.currentRecord = record;

    this.show();
    this.setTitle(`Edit ${entityName} #${record.id}`);
    await EntityForm.render(this.content, entityName, record);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};

// Add CSS for detail rows
const detailStyle = document.createElement('style');
detailStyle.textContent = `
  .record-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .detail-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 0;
    border-bottom: 1px solid #e5e7eb;
  }
  .detail-row:last-of-type {
    border-bottom: none;
  }
  .detail-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: #888;
    text-transform: uppercase;
  }
  .detail-value {
    font-size: 0.85rem;
    color: #333;
    word-break: break-word;
  }
  .detail-value em {
    color: #aaa;
    font-style: italic;
  }
  .detail-row-id {
    background-color: #f8f9fa;
    margin: -4px -12px 4px -12px;
    padding: 4px 12px;
    border-radius: 4px;
  }
  .detail-value-id {
    font-family: monospace;
    color: #666;
  }
  .detail-fk-id {
    font-family: monospace;
    font-size: 0.8em;
    color: #888;
    margin-left: 4px;
  }
`;
document.head.appendChild(detailStyle);
