/**
 * DomUtils - Shared DOM utility functions
 *
 * Loaded before all components to avoid duplication.
 */
const DomUtils = {
  /**
   * Show a toast notification (non-intrusive, auto-dismissing)
   * @param {string} message - The message to show
   * @param {string} type - 'info', 'success', 'warning', 'error'
   * @param {number} duration - Time in ms before auto-dismiss (0 = sticky)
   */
  toast(message, type = 'info', duration = 4000) {
    // Create container if needed
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = `
        position: fixed; top: 10px; right: 10px; z-index: 10000;
        display: flex; flex-direction: column; gap: 8px; max-width: 400px;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
      info: '#2196F3',
      success: '#4CAF50',
      warning: '#FF9800',
      error: '#f44336'
    };
    toast.style.cssText = `
      background: ${colors[type] || colors.info}; color: white;
      padding: 12px 16px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      font-size: 14px; line-height: 1.4; cursor: pointer;
      animation: toast-slide-in 0.3s ease-out;
    `;
    toast.textContent = message;
    toast.onclick = () => toast.remove();

    // Add animation style if not present
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes toast-slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `;
      document.head.appendChild(style);
    }

    container.appendChild(toast);
    if (duration > 0) {
      setTimeout(() => toast.remove(), duration);
    }
  },

  /**
   * Shorthand for error toast
   */
  toastError(message, duration = 6000) {
    DomUtils.toast(message, 'error', duration);
  },

  /**
   * Escape HTML special characters to prevent XSS
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  /**
   * Truncate text and return HTML with tooltip showing full text
   * @param {string} text - The text to potentially truncate
   * @param {number} maxLength - Maximum characters before truncation
   * @returns {string} - HTML string with escaped text (truncated with tooltip if needed)
   */
  truncateWithTooltip(text, maxLength) {
    if (text === null || text === undefined) return '';
    const str = String(text);
    if (str.length <= maxLength) {
      return DomUtils.escapeHtml(str);
    }
    const truncated = str.substring(0, maxLength) + '…';
    return `<span title="${DomUtils.escapeHtml(str)}">${DomUtils.escapeHtml(truncated)}</span>`;
  },

  /**
   * Split CamelCase into separate words: "TotalCycles" → "Total Cycles"
   */
  splitCamelCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1 $2');
  },

  /**
   * Format a column header with line breaks at word boundaries
   * Splits at CamelCase, underscores, and spaces
   */
  formatHeader(str) {
    return DomUtils.splitCamelCase(str).replace(/[_ ]/g, '<br>');
  },

  /**
   * Download a Blob as a file
   */
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ---------------------------------------------------------------------------
  // Modal dialog helpers (shared by seed-generator-dialog, model-builder-dialog)
  // ---------------------------------------------------------------------------

  /**
   * Show a temporary status message in a modal footer
   */
  showMessage(container, message, isError = false, timeout = 3000) {
    const footer = container.querySelector('.modal-footer');
    if (!footer) return;

    const existing = footer.querySelector('.status-message');
    if (existing) existing.remove();

    const msg = document.createElement('div');
    msg.className = `status-message ${isError ? 'error' : 'success'}`;
    msg.textContent = message;
    footer.insertBefore(msg, footer.firstChild);

    setTimeout(() => msg.remove(), timeout);
  },

  /**
   * Copy text to clipboard with textarea fallback
   */
  async copyToClipboard(container, text, textareaSelector, showMessage) {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      showMessage('Prompt copied to clipboard');
    } catch (e) {
      const textarea = container.querySelector(textareaSelector);
      if (textarea) {
        textarea.select();
        document.execCommand('copy');
        showMessage('Prompt copied to clipboard');
      } else {
        showMessage('Failed to copy', true);
      }
    }
  },

  /**
   * Render AI service links (Copy + GPT/Claude/Gemini/Copilot) for a prompt header
   */
  renderAILinks(hasPrompt) {
    if (!hasPrompt) return '';
    return `
      <span class="prompt-actions">
        <button class="btn-seed btn-small" data-action="copy-prompt">Copy</button>
        <a href="https://chatgpt.com/" target="chatgpt" class="ai-link ai-link-chatgpt" data-action="open-ai">GPT</a>
        <a href="https://claude.ai/new" target="claude" class="ai-link ai-link-claude" data-action="open-ai">Claude</a>
        <a href="https://gemini.google.com/app" target="gemini" class="ai-link ai-link-gemini" data-action="open-ai">Gemini</a>
        <a href="https://copilot.microsoft.com/" target="copilot" class="ai-link ai-link-copilot" data-action="open-ai">Copilot</a>
      </span>
    `;
  },

  /**
   * Attach click handlers for AI service links (copy-prompt + open-ai)
   */
  attachAILinkHandlers(container, getPromptText, textareaSelector, showMessage) {
    container.querySelector('[data-action="copy-prompt"]')?.addEventListener('click', () => {
      DomUtils.copyToClipboard(container, getPromptText(), textareaSelector, showMessage);
    });

    container.querySelectorAll('[data-action="open-ai"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const text = getPromptText();
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {
            const textarea = container.querySelector(textareaSelector);
            if (textarea) { textarea.select(); document.execCommand('copy'); }
          });
        }
        window.open(link.href, link.target);
      });
    });
  },

  // ---------------------------------------------------------------------------
  // Event binding helpers (reduce repetitive querySelector + addEventListener)
  // ---------------------------------------------------------------------------

  /**
   * Attach click handlers for elements with data-action attributes
   * @param {Element} container - Container to search within
   * @param {Object} handlers - Map of action names to callbacks: { 'save': () => {...}, 'cancel': () => {...} }
   */
  attachDataActionHandlers(container, handlers) {
    Object.entries(handlers).forEach(([action, callback]) => {
      container.querySelector(`[data-action="${action}"]`)?.addEventListener('click', callback);
    });
  },

  /**
   * Attach change handlers to a radio button group
   * @param {Element} container - Container to search within
   * @param {string} radioName - The name attribute of the radio group
   * @param {Function} callback - Called with the selected value on change
   */
  attachRadioGroupHandler(container, radioName, callback) {
    container.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
      radio.addEventListener('change', (e) => callback(e.target.value));
    });
  },

  /**
   * Convert camelCase to dash-case (for CSS property names)
   * @param {string} str - e.g. "backgroundColor"
   * @returns {string} - e.g. "background-color"
   */
  camelToDashCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  },

  // ---------------------------------------------------------------------------
  // Drag-and-drop helpers
  // ---------------------------------------------------------------------------

  /**
   * Set up drag-and-drop on a drop zone
   * @param {object} [options] - { allowFiles, fileExtensions, showMessage }
   */
  setupDropZone(container, dropZoneSelector, textareaSelector, options = {}) {
    const dropZone = container.querySelector(dropZoneSelector);
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');

      if (options.allowFiles && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const exts = options.fileExtensions || ['.md', '.txt'];
        if (file.type.startsWith('text/') || exts.some(ext => file.name.endsWith(ext))) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const textarea = container.querySelector(textareaSelector);
            if (textarea) {
              textarea.value = event.target.result;
              if (options.showMessage) options.showMessage(`Loaded: ${file.name}`);
            }
          };
          reader.onerror = () => {
            if (options.showMessage) options.showMessage('Failed to read file', true);
          };
          reader.readAsText(file);
        } else {
          if (options.showMessage) {
            options.showMessage(`Please drop a ${exts.join(' or ')} file`, true);
          }
        }
        return;
      }

      const text = e.dataTransfer.getData('text');
      if (text) {
        const textarea = container.querySelector(textareaSelector);
        if (textarea) textarea.value = text;
      }
    });
  }
};
