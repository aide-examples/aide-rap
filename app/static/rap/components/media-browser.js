/**
 * Media Browser Component
 * Modal for browsing and selecting media files for a specific entity field
 * - Shows all media referenced by a given entity/field combination
 * - Grid view with thumbnails, filenames, and metadata
 * - Select button to choose media for a form field
 */
const MediaBrowser = {
  modalElement: null,
  entityName: null,
  fieldName: null,
  mediaList: [],
  onSelect: null,
  pagination: { total: 0, limit: 50, offset: 0 },

  /**
   * Show modal to browse media for a specific entity field
   * @param {string} entityName - Entity class name (e.g., 'Currency')
   * @param {string} fieldName - Field name (e.g., 'bills')
   * @param {Function} onSelect - Callback when media is selected: onSelect(mediaId, mediaRecord)
   */
  async show(entityName, fieldName, onSelect = null) {
    this.entityName = entityName;
    this.fieldName = fieldName;
    this.onSelect = onSelect;
    this.pagination.offset = 0;

    await this.loadMedia();
    this.render();
  },

  /**
   * Load media from API
   */
  async loadMedia() {
    try {
      const params = new URLSearchParams({
        entity: this.entityName,
        field: this.fieldName,
        limit: this.pagination.limit,
        offset: this.pagination.offset
      });

      const response = await fetch(`api/media?${params}`);
      const data = await response.json();

      this.mediaList = data.data || [];
      this.pagination.total = data.pagination?.total || 0;
    } catch (err) {
      console.error('Failed to load media:', err);
      this.mediaList = [];
      this.pagination.total = 0;
    }
  },

  /**
   * Format file size for display
   */
  formatSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  },

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  },

  /**
   * Render the modal
   */
  render() {
    // Remove existing modal if any
    if (this.modalElement) {
      this.modalElement.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay media-browser-modal';
    modal.innerHTML = this.getModalHTML();

    document.body.appendChild(modal);
    this.modalElement = modal;

    this.attachEventListeners();
  },

  /**
   * Generate modal HTML
   */
  getModalHTML() {
    const hasMedia = this.mediaList.length > 0;
    const title = `Media: ${this.entityName}.${this.fieldName}`;

    return `
      <div class="modal-content media-browser-content">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" data-action="close">&times;</button>
        </div>

        <div class="modal-body">
          ${hasMedia ? this.renderMediaGrid() : this.renderEmptyState()}
        </div>

        <div class="modal-footer">
          <div class="pagination-info">
            ${this.pagination.total} media file${this.pagination.total !== 1 ? 's' : ''}
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="close">Close</button>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render the media grid
   */
  renderMediaGrid() {
    const items = this.mediaList.map(media => {
      const isImage = media.mimeType?.startsWith('image/');
      const thumbnailSrc = media.hasThumbnail
        ? `api/media/${media.id}/thumbnail`
        : 'icons/file.svg';

      return `
        <div class="media-browser-item" data-media-id="${media.id}">
          <div class="media-browser-thumb">
            <a href="api/media/${media.id}/file" target="_blank" rel="noopener">
              <img src="${thumbnailSrc}" alt="${this.escapeHtml(media.originalName)}"
                   onerror="this.onerror=null; this.src='icons/file.svg'">
            </a>
          </div>
          <div class="media-browser-info">
            <div class="media-browser-name" title="${this.escapeHtml(media.originalName)}">
              ${this.escapeHtml(media.originalName)}
            </div>
            <div class="media-browser-meta">
              ${this.formatSize(media.size)} &bull; ${this.formatDate(media.createdAt)}
            </div>
            ${media.width && media.height ? `<div class="media-browser-meta">${media.width} x ${media.height} px</div>` : ''}
          </div>
          ${this.onSelect ? `
            <div class="media-browser-actions">
              <button class="btn btn-sm btn-primary" data-action="select" data-media-id="${media.id}">
                Select
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `<div class="media-browser-grid">${items}</div>`;
  },

  /**
   * Render empty state
   */
  renderEmptyState() {
    return `
      <div class="media-browser-empty">
        <div class="empty-icon">📁</div>
        <div class="empty-text">No media files found for this field</div>
        <div class="empty-hint">Upload media through the entity form</div>
      </div>
    `;
  },

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button and overlay click
    this.modalElement.addEventListener('click', (e) => {
      const action = e.target.dataset.action;

      if (action === 'close' || e.target === this.modalElement) {
        this.close();
        return;
      }

      if (action === 'select') {
        const mediaId = e.target.dataset.mediaId;
        const media = this.mediaList.find(m => m.id === mediaId);
        if (media && this.onSelect) {
          this.onSelect(mediaId, media);
          this.close();
        }
      }
    });

    // Escape key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  /**
   * Close the modal
   */
  close() {
    if (this.modalElement) {
      this.modalElement.remove();
      this.modalElement = null;
    }
  },

  /**
   * HTML escape helper
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaBrowser;
}
