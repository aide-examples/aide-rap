/**
 * MediaUpload - Drag & drop file upload component
 *
 * Usage:
 * const uploader = MediaUpload.create(container, {
 *   multiple: true,
 *   accept: 'image/*',
 *   onUpload: (results) => console.log(results),
 *   onError: (err) => console.error(err)
 * });
 */

const MediaUpload = {
  /**
   * Create an upload zone in a container
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Configuration options
   * @param {boolean} [options.multiple=false] - Allow multiple files
   * @param {string} [options.accept] - Accepted file types
   * @param {string} [options.hint] - Hint text
   * @param {Function} [options.onUpload] - Callback after successful upload
   * @param {Function} [options.onError] - Callback on error
   * @param {Function} [options.onProgress] - Callback for progress updates
   * @returns {Object} Controller object with methods
   */
  create(container, options = {}) {
    const state = {
      uploading: false,
      files: []
    };

    // Render the upload zone
    container.innerHTML = `
      <div class="media-upload-zone" data-accept="${options.accept || '*'}">
        <div class="media-upload-content">
          <div class="media-upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="media-upload-text">
            Dateien hierher ziehen oder <span class="media-upload-link">auswaehlen</span>
          </div>
          <div class="media-upload-hint">
            ${options.hint || (options.multiple ? 'Mehrere Dateien moeglich' : 'Max. 50 MB')}
          </div>
        </div>
        <input type="file" class="media-upload-input"
               ${options.multiple ? 'multiple' : ''}
               ${options.accept ? `accept="${options.accept}"` : ''}>
        <div class="media-upload-progress hidden">
          <div class="media-upload-progress-bar"></div>
          <div class="media-upload-progress-text">Uploading...</div>
        </div>
      </div>
    `;

    const zone = container.querySelector('.media-upload-zone');
    const input = container.querySelector('.media-upload-input');
    const progressEl = container.querySelector('.media-upload-progress');
    const progressBar = container.querySelector('.media-upload-progress-bar');
    const progressText = container.querySelector('.media-upload-progress-text');

    // Drag & drop handlers
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.uploading) {
        zone.classList.add('dragover');
      }
    });

    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');

      if (!state.uploading && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });

    // Click to browse
    zone.addEventListener('click', (e) => {
      if (!state.uploading && !e.target.closest('.media-upload-link')) {
        input.click();
      }
    });

    container.querySelector('.media-upload-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.uploading) {
        input.click();
      }
    });

    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        handleFiles(input.files);
        input.value = '';
      }
    });

    /**
     * Handle selected/dropped files
     * @param {FileList} files - Files to upload
     */
    async function handleFiles(files) {
      if (state.uploading) return;

      state.uploading = true;
      state.files = Array.from(files);

      const formData = new FormData();
      const endpoint = files.length > 1 ? 'api/media/bulk' : 'api/media';
      const fieldName = files.length > 1 ? 'files' : 'file';

      for (const file of state.files) {
        formData.append(fieldName, file);
      }

      // Show progress
      progressEl.classList.remove('hidden');
      progressBar.style.width = '0%';
      progressText.textContent = `Uploading ${state.files.length} file(s)...`;
      zone.classList.add('uploading');

      try {
        const response = await uploadWithProgress(endpoint, formData, (percent) => {
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `${Math.round(percent)}%`;
          if (options.onProgress) {
            options.onProgress(percent);
          }
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error?.message || 'Upload failed');
        }

        // Success
        progressBar.style.width = '100%';
        progressText.textContent = 'Done!';

        if (options.onUpload) {
          options.onUpload(result);
        }

        // Reset after short delay
        setTimeout(() => {
          resetUI();
        }, 1000);

      } catch (err) {
        progressText.textContent = `Error: ${err.message}`;
        zone.classList.add('error');

        if (options.onError) {
          options.onError(err);
        }

        setTimeout(() => {
          resetUI();
        }, 3000);
      }
    }

    /**
     * Upload with progress tracking
     */
    function uploadWithProgress(url, formData, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            onProgress(percent);
          }
        });

        xhr.addEventListener('load', () => {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            json: () => Promise.resolve(JSON.parse(xhr.responseText))
          });
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error'));
        });

        xhr.open('POST', url);
        xhr.send(formData);
      });
    }

    /**
     * Reset UI to initial state
     */
    function resetUI() {
      state.uploading = false;
      state.files = [];
      zone.classList.remove('uploading', 'error', 'dragover');
      progressEl.classList.add('hidden');
      progressBar.style.width = '0%';
    }

    // Return controller
    return {
      reset: resetUI,
      isUploading: () => state.uploading,
      destroy: () => {
        container.innerHTML = '';
      }
    };
  },

  /**
   * Create a simple inline upload button (for entity forms)
   * @param {Object} options - Options
   * @param {string} [options.accept] - Accepted types
   * @param {Function} options.onUpload - Callback with result
   * @returns {HTMLElement} Button element
   */
  createButton(options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'media-upload-button-wrapper';
    wrapper.innerHTML = `
      <button type="button" class="btn btn-secondary media-upload-btn">
        <span class="media-upload-btn-text">Datei auswaehlen</span>
        <span class="media-upload-btn-loading hidden">Uploading...</span>
      </button>
      <input type="file" class="media-upload-input" ${options.accept ? `accept="${options.accept}"` : ''}>
    `;

    const btn = wrapper.querySelector('.media-upload-btn');
    const input = wrapper.querySelector('.media-upload-input');
    const textEl = wrapper.querySelector('.media-upload-btn-text');
    const loadingEl = wrapper.querySelector('.media-upload-btn-loading');

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      if (!input.files.length) return;

      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      textEl.classList.add('hidden');
      loadingEl.classList.remove('hidden');
      btn.disabled = true;

      try {
        const response = await fetch('api/media', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error?.message || 'Upload failed');
        }

        if (options.onUpload) {
          options.onUpload(result);
        }
      } catch (err) {
        console.error('Upload error:', err);
        if (options.onError) {
          options.onError(err);
        }
      } finally {
        textEl.classList.remove('hidden');
        loadingEl.classList.add('hidden');
        btn.disabled = false;
        input.value = '';
      }
    });

    return wrapper;
  }
};

// Export for browser
if (typeof window !== 'undefined') {
  window.MediaUpload = MediaUpload;
}
