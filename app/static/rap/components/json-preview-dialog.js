/**
 * JSON Preview Dialog
 * Shows raw API response as formatted JSON with optional "Apply" action.
 * Used from map popups and other contexts where API preview is needed.
 */
const JsonPreviewDialog = {
  overlay: null,

  init() {
    const overlay = document.createElement('div');
    overlay.className = 'json-preview-overlay';
    overlay.innerHTML = `
      <div class="json-preview-dialog">
        <div class="json-preview-header">
          <span class="json-preview-title"></span>
          <button class="json-preview-close">&times;</button>
        </div>
        <div class="json-preview-url"></div>
        <pre class="json-preview-body"></pre>
        <div class="json-preview-footer">
          <button class="json-preview-apply btn-primary" style="display:none">Apply Refresh</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('.json-preview-close').addEventListener('click', () => this.hide());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('visible')) this.hide();
    });
  },

  /**
   * Show the JSON preview dialog
   * @param {string} title - Dialog title (e.g., refresh label)
   * @param {string} url - The API URL that was called
   * @param {Object} json - The raw JSON response
   * @param {Object} [applyContext] - { entityName, refreshName, recordId } for "Apply" button
   */
  show(title, url, json, applyContext = null) {
    if (!this.overlay) this.init();

    this.overlay.querySelector('.json-preview-title').textContent = title;
    this.overlay.querySelector('.json-preview-url').textContent = url || '';
    this.overlay.querySelector('.json-preview-body').textContent = JSON.stringify(json, null, 2);

    // Apply button
    const applyBtn = this.overlay.querySelector('.json-preview-apply');
    if (applyContext) {
      applyBtn.style.display = '';
      applyBtn.onclick = async () => {
        try {
          applyBtn.disabled = true;
          applyBtn.textContent = 'Applying...';
          const result = await ApiClient.refreshRecord(
            applyContext.entityName, applyContext.refreshName, applyContext.recordId
          );
          const msg = result.updated > 0
            ? `Updated ${result.updated} field(s)`
            : 'No changes';
          DomUtils.toast(msg, result.updated > 0 ? 'success' : 'info');
          if (result.fkErrors && result.fkErrors.length > 0) {
            const errorLines = result.fkErrors.map(e =>
              `${e.field}: "${e.value}" not found in ${e.targetEntity}`
            );
            DomUtils.toast(`FK warnings:\n${errorLines.join('\n')}`, 'warning', 8000);
          }
          if (typeof EntityExplorer !== 'undefined') {
            EntityExplorer.loadRecords();
          }
          this.hide();
        } catch (err) {
          DomUtils.toast(`Apply failed: ${err.message}`, 'error');
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply Refresh';
        }
      };
    } else {
      applyBtn.style.display = 'none';
    }

    this.overlay.classList.add('visible');
  },

  hide() {
    if (this.overlay) {
      this.overlay.classList.remove('visible');
    }
  }
};
