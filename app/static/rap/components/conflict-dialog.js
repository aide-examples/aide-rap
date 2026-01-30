/**
 * Conflict Dialog Component
 * Shows when OCC version conflict occurs, allowing user to see diff and choose action
 */
const ConflictDialog = {
  dialog: null,
  resolve: null,
  currentRecord: null,
  yourData: null,
  entityName: null,
  schema: null,

  init() {
    this.dialog = document.getElementById('conflict-dialog');
    if (!this.dialog) return;

    document.getElementById('conflict-reload').addEventListener('click', () => {
      this.resolve({ action: 'reload' });
    });

    document.getElementById('conflict-overwrite').addEventListener('click', () => {
      this.resolve({ action: 'overwrite', data: this.yourData });
    });

    document.getElementById('conflict-cancel').addEventListener('click', () => {
      this.resolve({ action: 'cancel' });
    });

    // Close on backdrop click
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) {
        this.resolve({ action: 'cancel' });
      }
    });
  },

  /**
   * Show conflict dialog with diff
   * @param {string} entityName - Entity type
   * @param {Object} yourData - Data the user tried to save
   * @param {Object} currentRecord - Current state from server
   * @param {Object} schema - Entity schema for column labels
   * @returns {Promise<{action: string, data?: Object}>}
   */
  async show(entityName, yourData, currentRecord, schema) {
    this.entityName = entityName;
    this.yourData = yourData;
    this.currentRecord = currentRecord;
    this.schema = schema;

    // Update dialog title
    const titleEl = document.getElementById('conflict-title');
    titleEl.textContent = i18n.t('conflict_title', { entity: entityName, id: currentRecord.id });

    // Build diff table
    const diffContainer = document.getElementById('conflict-diff');
    diffContainer.innerHTML = this.buildDiffTable(yourData, currentRecord, schema);

    return new Promise((resolve) => {
      this.resolve = (result) => {
        this.dialog.close();
        resolve(result);
      };
      this.dialog.showModal();
    });
  },

  /**
   * Build HTML table showing differences
   */
  buildDiffTable(yourData, currentRecord, schema) {
    const columns = schema.columns.filter(c => c.name !== 'id');
    let html = `
      <table class="conflict-diff-table">
        <thead>
          <tr>
            <th>${i18n.t('field')}</th>
            <th>${i18n.t('your_value')}</th>
            <th>${i18n.t('server_value')}</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const col of columns) {
      const yourVal = yourData[col.name];
      const serverVal = currentRecord[col.name];
      const isDifferent = String(yourVal ?? '') !== String(serverVal ?? '');

      // Skip unchanged fields unless they're system fields
      if (!isDifferent && !col.system) continue;

      const rowClass = isDifferent ? 'conflict-row-diff' : 'conflict-row-same';
      const yourDisplay = this.formatValue(yourVal, col, schema);
      const serverDisplay = this.formatValue(serverVal, col, schema);

      html += `
        <tr class="${rowClass}">
          <td class="conflict-field-name">${col.name}</td>
          <td class="conflict-your-value">${yourDisplay}</td>
          <td class="conflict-server-value">${serverDisplay}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    return html;
  },

  /**
   * Format a value for display (reuses ValueFormatter for enum handling)
   */
  formatValue(value, col, schema) {
    if (value === null || value === undefined) {
      return '<span class="null-value">null</span>';
    }
    if (col.type === 'boolean') {
      return value ? '✓' : '✗';
    }
    // Use ValueFormatter for proper enum display
    return DomUtils.escapeHtml(ValueFormatter.format(value, col.name, schema));
  }
};
