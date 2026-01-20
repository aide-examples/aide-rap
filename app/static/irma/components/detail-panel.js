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
  isCollapsed: false,

  init() {
    this.panel = document.getElementById('detail-panel');
    this.title = document.getElementById('panel-title');
    this.content = document.getElementById('panel-content');
    this.toggleBtn = document.getElementById('panel-toggle');
    this.expandBtn = document.getElementById('panel-expand');

    // Restore collapsed state from session
    this.isCollapsed = sessionStorage.getItem('panelCollapsed') === 'true';
    if (this.isCollapsed) {
      this.collapse();
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
    sessionStorage.setItem('panelCollapsed', 'true');
  },

  expand() {
    this.isCollapsed = false;
    this.panel.classList.remove('collapsed');
    this.expandBtn.classList.add('hidden');
    sessionStorage.setItem('panelCollapsed', 'false');
  },

  setTitle(text) {
    this.title.textContent = text;
  },

  clear() {
    this.setTitle('Details');
    this.content.innerHTML = '<p class="empty-message">Select a record to view details.</p>';
  },

  showMessage(message, type = 'info') {
    const className = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
    this.content.innerHTML = `<div class="panel-message ${className}">${message}</div>`;
  },

  async showRecord(entityName, record) {
    this.setTitle(`${entityName} #${record.id}`);

    const schema = await SchemaCache.get(entityName);

    let html = '<div class="record-details">';

    for (const col of schema.columns) {
      const value = record[col.name];
      const displayValue = value !== null && value !== undefined ? value : '<em>null</em>';

      html += `
        <div class="detail-row">
          <span class="detail-label">${col.name}</span>
          <span class="detail-value">${this.escapeHtml(String(displayValue))}</span>
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
    this.setTitle(`New ${entityName}`);
    await EntityForm.render(this.content, entityName, null);

    if (this.isCollapsed) {
      this.expand();
    }
  },

  async showEditForm(entityName, record) {
    this.setTitle(`Edit ${entityName} #${record.id}`);
    await EntityForm.render(this.content, entityName, record);

    if (this.isCollapsed) {
      this.expand();
    }
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
    gap: 8px;
  }
  .detail-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 0;
    border-bottom: 1px solid #e5e7eb;
  }
  .detail-row:last-of-type {
    border-bottom: none;
  }
  .detail-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: #888;
    text-transform: uppercase;
  }
  .detail-value {
    font-size: 0.9rem;
    color: #333;
    word-break: break-word;
  }
  .detail-value em {
    color: #aaa;
    font-style: italic;
  }
`;
document.head.appendChild(detailStyle);
