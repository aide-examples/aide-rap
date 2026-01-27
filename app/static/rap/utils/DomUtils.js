/**
 * DomUtils - Shared DOM utility functions
 *
 * Loaded before all components to avoid duplication.
 */
const DomUtils = {
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
   * Render AI service links (Copy + GPT/Claude/Gemini) for a prompt header
   */
  renderAILinks(hasPrompt) {
    if (!hasPrompt) return '';
    return `
      <span class="prompt-actions">
        <button class="btn-seed btn-small" data-action="copy-prompt">Copy</button>
        <a href="https://chatgpt.com/" target="chatgpt" class="ai-link ai-link-chatgpt" data-action="open-ai">GPT</a>
        <a href="https://claude.ai/new" target="claude" class="ai-link ai-link-claude" data-action="open-ai">Claude</a>
        <a href="https://gemini.google.com/app" target="gemini" class="ai-link ai-link-gemini" data-action="open-ai">Gemini</a>
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
