/**
 * BreadcrumbShareDialog - Share navigation state via URL/QR code
 *
 * Shows a dialog with:
 * - Shareable URL containing breadcrumb state
 * - QR code for mobile scanning
 * - Option to include guest auth
 */
const BreadcrumbShareDialog = {
  container: null,
  initialized: false,

  /**
   * Initialize the share dialog
   */
  init() {
    if (this.initialized) return;

    // Create modal container
    this.container = document.createElement('div');
    this.container.className = 'breadcrumb-share-overlay';
    this.container.innerHTML = `
      <div class="breadcrumb-share-dialog">
        <div class="share-dialog-header">
          <span class="share-dialog-title" data-i18n="share_title">Share Navigation State</span>
          <button class="share-dialog-close" aria-label="Close">&times;</button>
        </div>
        <div class="share-dialog-body">
          <div class="share-url-container">
            <input type="text" class="share-url-input" readonly>
            <button class="share-copy-btn" data-i18n="share_copy_url">Copy URL</button>
          </div>
          <div class="share-qr-container">
            <div class="share-qr-code"></div>
          </div>
          <div class="share-options">
            <label class="share-auth-option">
              <input type="checkbox" class="share-auth-checkbox" checked>
              <span data-i18n="share_include_auth">Include auth (guest access)</span>
            </label>
          </div>
        </div>
        <div class="share-dialog-footer">
          <button class="share-close-btn" data-i18n="close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);

    // Event listeners
    this.container.querySelector('.share-dialog-close').addEventListener('click', () => this.hide());
    this.container.querySelector('.share-close-btn').addEventListener('click', () => this.hide());
    this.container.querySelector('.share-copy-btn').addEventListener('click', () => this.copyUrl());
    this.container.querySelector('.share-auth-checkbox').addEventListener('change', () => this.updateUrl());

    // Close on overlay click
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) this.hide();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.container.classList.contains('visible')) {
        this.hide();
      }
    });

    // Apply i18n if available
    if (typeof i18n !== 'undefined') {
      i18n.applyToDOM(this.container);
    }

    this.initialized = true;
  },

  /**
   * Show the share dialog for a specific crumb index
   * @param {number} crumbIndex - Index of the crumb to share (stack up to this point)
   */
  show(crumbIndex) {
    if (!this.initialized) this.init();

    // Store the crumb index for URL generation
    this.currentCrumbIndex = crumbIndex;

    // Generate and display URL
    this.updateUrl();

    // Show dialog
    this.container.classList.add('visible');

    // Focus the URL input for easy copying
    const urlInput = this.container.querySelector('.share-url-input');
    urlInput.select();
  },

  /**
   * Hide the share dialog
   */
  hide() {
    this.container.classList.remove('visible');
  },

  /**
   * Update the URL and QR code based on current options
   */
  updateUrl() {
    const includeAuth = this.container.querySelector('.share-auth-checkbox').checked;
    const url = this.generateUrl(this.currentCrumbIndex, includeAuth);

    // Update URL input
    const urlInput = this.container.querySelector('.share-url-input');
    urlInput.value = url;

    // Update QR code
    this.generateQrCode(url);
  },

  /**
   * Generate shareable URL for the breadcrumb stack
   * @param {number} crumbIndex - Stack up to this index
   * @param {boolean} includeAuth - Include ?user=guest
   * @returns {string} Complete URL
   */
  generateUrl(crumbIndex, includeAuth) {
    // Get stack up to the specified index
    const stack = BreadcrumbNav.stack.slice(0, crumbIndex + 1);

    // Serialize to compact format
    const compactStack = this.serializeStack(stack);

    // Base64 encode
    const json = JSON.stringify(compactStack);
    const encoded = btoa(json);

    // Build URL
    const baseUrl = `${location.origin}${location.pathname}`;
    const params = new URLSearchParams();

    if (includeAuth) {
      params.set('user', 'guest');
    }
    params.set('crumbs', encoded);

    // Include active process state (if any)
    if (typeof EntityExplorer !== 'undefined' && EntityExplorer.activeProcess) {
      const proc = { n: EntityExplorer.activeProcess.name, s: ProcessPanel.activeStepIndex };
      const ctx = ProcessPanel.context;
      if (ctx._ids) {
        const reqEntity = EntityExplorer.activeProcess.required?.split(':')[0]?.trim();
        if (reqEntity && ctx._ids[reqEntity]) {
          proc.e = reqEntity;
          proc.i = ctx._ids[reqEntity];
        }
      }
      params.set('proc', btoa(JSON.stringify(proc)));
    }

    return `${baseUrl}?${params.toString()}`;
  },

  /**
   * Serialize breadcrumb stack to compact format
   * @param {Array} stack - Full breadcrumb stack
   * @returns {Array} Compact representation
   */
  serializeStack(stack) {
    return stack.map((c, index) => {
      const compact = {
        t: c.type[0]  // 'e', 'v', 'r', 'f'
      };

      // Only include non-null values
      if (c.entity) compact.e = c.entity;
      if (c.view?.name) compact.v = c.view.name;
      if (c.recordId) compact.r = c.recordId;
      if (c.filter) compact.f = c.filter;

      // For the last crumb, use current viewMode and selectedId from EntityExplorer
      // (user may have switched viewMode or selection after breadcrumb was created)
      const isLast = index === stack.length - 1;
      const viewMode = isLast && typeof EntityExplorer !== 'undefined'
        ? EntityExplorer.viewMode
        : c.viewMode;
      if (viewMode) compact.m = viewMode;

      // Include selected record ID (for map marker popup restore)
      const selectedId = isLast && typeof EntityExplorer !== 'undefined'
        ? EntityExplorer.selectedId
        : c.selectedId;
      if (selectedId) compact.s = selectedId;

      return compact;
    });
  },

  /**
   * Generate QR code for the URL
   * @param {string} url - URL to encode
   */
  generateQrCode(url) {
    const qrContainer = this.container.querySelector('.share-qr-code');

    // Check if qrcode library is available
    if (typeof qrcode === 'undefined') {
      qrContainer.innerHTML = '<p style="color: #999;">QR code library not loaded</p>';
      return;
    }

    try {
      // Create QR code - type 0 = auto, 'M' = medium error correction
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();

      // Generate image tag with cell size for 300x300px
      // Cell size depends on QR code version, aim for ~300px
      const moduleCount = qr.getModuleCount();
      const cellSize = Math.max(1, Math.floor(300 / moduleCount));

      qrContainer.innerHTML = qr.createImgTag(cellSize, 0);

      // Ensure exact 300x300 size
      const img = qrContainer.querySelector('img');
      if (img) {
        img.style.width = '300px';
        img.style.height = '300px';
        img.style.imageRendering = 'pixelated';
      }
    } catch (e) {
      console.error('QR code generation failed:', e);
      qrContainer.innerHTML = '<p style="color: #c00;">QR code generation failed</p>';
    }
  },

  /**
   * Copy URL to clipboard
   */
  async copyUrl() {
    const urlInput = this.container.querySelector('.share-url-input');
    const copyBtn = this.container.querySelector('.share-copy-btn');
    const originalText = copyBtn.textContent;

    try {
      await navigator.clipboard.writeText(urlInput.value);

      // Show feedback
      copyBtn.textContent = i18n?.t('share_copied') || 'Copied!';
      copyBtn.classList.add('copied');

      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.classList.remove('copied');
      }, 2000);
    } catch (e) {
      // Fallback for older browsers
      urlInput.select();
      document.execCommand('copy');

      copyBtn.textContent = i18n?.t('share_copied') || 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    }
  }
};
