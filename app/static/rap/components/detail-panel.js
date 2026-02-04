/**
 * Detail Panel Component
 * Right side panel for viewing/editing records
 * Uses ColumnUtils.SYSTEM_COLUMNS for system column filtering
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
  showSystem: false, // Show system columns (version, created_at, updated_at)
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

    // Restore show system columns state from session
    const showSystemToggle = document.getElementById('show-system-toggle');
    this.showSystem = sessionStorage.getItem('showSystem') === 'true';
    if (showSystemToggle) {
      showSystemToggle.addEventListener('change', () => {
        this.showSystem = showSystemToggle.checked;
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
    this.setTitle(i18n.t('details'));
    this.content.innerHTML = `<p class="empty-message">${i18n.t('select_record_message')}</p>`;
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

    this.setTitle(i18n.t('entity_title', { entity: entityName, id: record.id }));

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
      // Skip system columns unless toggle is enabled
      if (!this.showSystem && ColumnUtils.SYSTEM_COLUMNS.includes(col.name)) continue;

      const value = record[col.name];
      let displayValue;
      let customLabel = null; // Override label for special cases
      if (value === null || value === undefined) {
        displayValue = '';
      } else if (col.customType === 'url') {
        // URL: Clickable link
        displayValue = `<a href="${DomUtils.escapeHtml(value)}" target="_blank" rel="noopener">${DomUtils.escapeHtml(value)}</a>`;
      } else if (col.customType === 'mail') {
        // Mail: Mailto link
        displayValue = `<a href="mailto:${DomUtils.escapeHtml(value)}">${DomUtils.escapeHtml(value)}</a>`;
      } else if (col.customType === 'json') {
        // JSON: Pretty-printed code block with diff support for AuditTrail
        try {
          const jsonObj = typeof value === 'object' ? value : JSON.parse(value);

          // Special case: AuditTrail diff view
          if (entityName === 'AuditTrail' && (col.name === 'before_data' || col.name === 'after_data')) {
            const beforeData = col.name === 'before_data' ? jsonObj : (record.before_data || null);
            const afterData = col.name === 'after_data' ? jsonObj : (record.after_data || null);

            // Only show diff view for after_data (skip before_data as separate field)
            if (col.name === 'after_data' && beforeData && afterData) {
              displayValue = this.renderJsonDiff(beforeData, afterData);
              customLabel = i18n.t('audit_changes');
            } else if (col.name === 'before_data' && record.after_data) {
              // Skip before_data when we have after_data (diff shown in after_data)
              continue;
            } else {
              const pretty = JSON.stringify(jsonObj, null, 2);
              displayValue = `<pre class="json-value">${DomUtils.escapeHtml(pretty)}</pre>`;
            }
          } else {
            const pretty = JSON.stringify(jsonObj, null, 2);
            displayValue = `<pre class="json-value">${DomUtils.escapeHtml(pretty)}</pre>`;
          }
        } catch {
          displayValue = `<pre class="json-value">${DomUtils.escapeHtml(String(value))}</pre>`;
        }
      } else if (col.customType === 'media' && value) {
        // Media: Thumbnail and download link
        displayValue = `
          <div class="media-display">
            <a href="/api/media/${DomUtils.escapeHtml(value)}/file" target="_blank" rel="noopener" class="media-link">
              <img src="/api/media/${DomUtils.escapeHtml(value)}/thumbnail" class="media-thumb-small"
                   onerror="this.onerror=null; this.src='/icons/file.svg'; this.classList.add('media-thumb-fallback')">
              <span class="media-view-text">Datei oeffnen</span>
            </a>
          </div>
        `;
      } else {
        // Use ValueFormatter to convert enum internal->external
        displayValue = DomUtils.escapeHtml(ValueFormatter.format(value, col.name, schema));
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
          displayValue = DomUtils.escapeHtml(record[labelField]) + idSuffix;
        } else {
          displayValue = displayValue + idSuffix;
        }
      }

      html += `
        <div class="detail-row">
          <span class="detail-label">${customLabel || col.name}</span>
          <span class="detail-value">${displayValue}</span>
        </div>
      `;
    }

    html += `
      <div class="form-actions">
        <button class="btn-save" id="btn-panel-edit">${i18n.t('edit')}</button>
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

    this.setTitle(i18n.t('new_entity', { entity: entityName }));
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
    this.setTitle(i18n.t('edit_entity', { entity: entityName, id: record.id }));
    await EntityForm.render(this.content, entityName, record);
  },

  /**
   * Render a JSON diff view comparing before and after data
   * @param {Object} before - Before state
   * @param {Object} after - After state
   * @returns {string} HTML with diff highlighting
   */
  renderJsonDiff(before, after) {
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    let html = '<div class="json-diff">';

    for (const key of allKeys) {
      const beforeVal = before?.[key];
      const afterVal = after?.[key];
      const beforeStr = beforeVal !== undefined ? JSON.stringify(beforeVal) : undefined;
      const afterStr = afterVal !== undefined ? JSON.stringify(afterVal) : undefined;

      if (beforeStr === afterStr) {
        // Unchanged
        html += `<div class="diff-row diff-unchanged">
          <span class="diff-key">${DomUtils.escapeHtml(key)}:</span>
          <span class="diff-value">${DomUtils.escapeHtml(afterStr)}</span>
        </div>`;
      } else if (beforeStr === undefined) {
        // Added
        html += `<div class="diff-row diff-added">
          <span class="diff-key">+ ${DomUtils.escapeHtml(key)}:</span>
          <span class="diff-value">${DomUtils.escapeHtml(afterStr)}</span>
        </div>`;
      } else if (afterStr === undefined) {
        // Removed
        html += `<div class="diff-row diff-removed">
          <span class="diff-key">- ${DomUtils.escapeHtml(key)}:</span>
          <span class="diff-value">${DomUtils.escapeHtml(beforeStr)}</span>
        </div>`;
      } else {
        // Changed
        html += `<div class="diff-row diff-changed">
          <span class="diff-key">${DomUtils.escapeHtml(key)}:</span>
          <span class="diff-value diff-before">${DomUtils.escapeHtml(beforeStr)}</span>
          <span class="diff-arrow">→</span>
          <span class="diff-value diff-after">${DomUtils.escapeHtml(afterStr)}</span>
        </div>`;
      }
    }

    html += '</div>';
    return html;
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

  /* JSON Diff styling for AuditTrail */
  .json-diff {
    font-family: monospace;
    font-size: 0.85rem;
    background: #f8f9fa;
    border-radius: 4px;
    padding: 8px;
    overflow-x: auto;
  }
  .diff-row {
    padding: 2px 4px;
    border-radius: 2px;
    margin: 1px 0;
  }
  .diff-key {
    color: #555;
    margin-right: 4px;
  }
  .diff-value {
    color: #333;
  }
  .diff-unchanged {
    color: #666;
  }
  .diff-added {
    background-color: #d4edda;
    color: #155724;
  }
  .diff-added .diff-key {
    color: #155724;
    font-weight: bold;
  }
  .diff-removed {
    background-color: #f8d7da;
    color: #721c24;
    text-decoration: line-through;
  }
  .diff-removed .diff-key {
    color: #721c24;
    font-weight: bold;
  }
  .diff-changed {
    background-color: #fff3cd;
  }
  .diff-changed .diff-key {
    color: #856404;
  }
  .diff-before {
    color: #721c24;
    text-decoration: line-through;
  }
  .diff-after {
    color: #155724;
    font-weight: 500;
  }
  .diff-arrow {
    color: #856404;
    margin: 0 6px;
  }
`;
document.head.appendChild(detailStyle);
