/**
 * Entity Form Component
 * Dynamic form for creating/editing entity records
 */
const EntityForm = {
  currentEntity: null,
  currentRecord: null,
  originalData: null,
  isDirty: false,

  async render(container, entityName, record = null) {
    this.currentEntity = entityName;
    this.currentRecord = record;
    this.isDirty = false;

    // Use extended schema to get enumValues
    const schema = await SchemaCache.getExtended(entityName);
    this.currentSchema = schema; // Store for getFormData
    const isEdit = record !== null;

    // Store original data for dirty checking
    this.originalData = record ? { ...record } : {};

    let html = '<form class="entity-form" id="entity-form">';

    for (const col of schema.columns) {
      // Skip id field for create, show as readonly for edit
      if (col.name === 'id' && !isEdit) continue;

      // For NEW: use defaultValue from schema (if available), otherwise empty
      // For EDIT: use record value
      let value;
      if (record) {
        value = record[col.name];
      } else {
        // NEW mode: use default value (skip CURRENT_DATE as it's SQL-specific)
        value = (col.defaultValue !== undefined && col.defaultValue !== 'CURRENT_DATE')
          ? col.defaultValue
          : '';
      }

      const isRequired = col.required;
      const isReadonly = col.name === 'id' || col.ui?.readonly;
      const inputType = this.getInputType(col);

      html += `
        <div class="form-field">
          <label class="form-label" for="field-${col.name}">
            ${col.name}${isRequired ? ' <span class="required">*</span>' : ''}
          </label>
          ${this.renderInput(col, value, isReadonly, inputType)}
          <div class="field-error" id="error-${col.name}"></div>
        </div>
      `;
    }

    html += `
      <div class="form-actions">
        <button type="submit" class="btn-save" id="btn-save">
          ${i18n.t(isEdit ? 'save_changes' : 'create')}
        </button>
        <button type="button" class="btn-cancel" id="btn-cancel">${i18n.t('cancel')}</button>
      </div>
    </form>`;

    container.innerHTML = html;

    // Event listeners
    const form = document.getElementById('entity-form');
    form.addEventListener('submit', (e) => this.onSubmit(e));
    form.addEventListener('input', () => this.onInput());

    document.getElementById('btn-cancel').addEventListener('click', () => this.onCancel());

    // Track dirty state
    form.querySelectorAll('.form-input').forEach(input => {
      input.addEventListener('change', () => this.checkDirty());
    });

    // Load FK dropdown options asynchronously
    await this.loadFKDropdowns();

    // Initialize media field handlers
    this.initMediaFields();
  },

  /**
   * Initialize media field drag-drop and upload handlers
   */
  initMediaFields() {
    const mediaFields = document.querySelectorAll('.media-field');

    mediaFields.forEach(field => {
      const fieldName = field.dataset.field;
      const hiddenInput = field.querySelector('.media-value');
      const preview = field.querySelector('.media-preview');
      const dropzone = field.querySelector('.media-dropzone');
      const fileInput = field.querySelector('.media-file-input');
      const removeBtn = field.querySelector('.media-remove');
      const thumbnail = field.querySelector('.media-thumbnail');
      const filenameSpan = field.querySelector('.media-filename');

      // Load filename if value exists
      if (hiddenInput.value) {
        this.loadMediaMetadata(hiddenInput.value, filenameSpan);
      }

      // Drag & drop handlers
      if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
          dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            this.uploadMediaFile(e.dataTransfer.files[0], field);
          }
        });

        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
          if (fileInput.files.length > 0) {
            this.uploadMediaFile(fileInput.files[0], field);
            fileInput.value = '';
          }
        });
      }

      // Remove button
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          hiddenInput.value = '';
          preview.classList.add('hidden');
          dropzone.classList.remove('hidden');
          thumbnail.src = '';
          filenameSpan.textContent = '';
          this.checkDirty();
        });
      }
    });
  },

  /**
   * Load media metadata and update filename display
   */
  async loadMediaMetadata(mediaId, filenameSpan) {
    try {
      const response = await fetch(`/api/media/${mediaId}`);
      if (response.ok) {
        const data = await response.json();
        filenameSpan.textContent = data.originalName || mediaId;
      }
    } catch (err) {
      console.warn('Could not load media metadata:', err);
    }
  },

  /**
   * Upload a media file and update the field
   */
  async uploadMediaFile(file, fieldElement) {
    const hiddenInput = fieldElement.querySelector('.media-value');
    const preview = fieldElement.querySelector('.media-preview');
    const dropzone = fieldElement.querySelector('.media-dropzone');
    const thumbnail = fieldElement.querySelector('.media-thumbnail');
    const filenameSpan = fieldElement.querySelector('.media-filename');

    // Show uploading state
    dropzone.innerHTML = '<span class="uploading">Uploading...</span>';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/media', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || 'Upload failed');
      }

      // Success - update field
      hiddenInput.value = result.id;
      filenameSpan.textContent = result.originalName;

      if (result.thumbnailUrl) {
        thumbnail.src = result.thumbnailUrl;
        thumbnail.classList.remove('media-thumb-fallback');
      } else {
        thumbnail.src = '/icons/file.svg';
        thumbnail.classList.add('media-thumb-fallback');
      }

      preview.classList.remove('hidden');
      dropzone.classList.add('hidden');
      this.checkDirty();

    } catch (err) {
      console.error('Media upload error:', err);
      dropzone.innerHTML = `<span class="error">Error: ${err.message}</span>`;
      setTimeout(() => {
        dropzone.innerHTML = '<span>Datei hierher ziehen oder klicken</span><input type="file" class="media-file-input">';
        // Reattach file input handler
        const newFileInput = dropzone.querySelector('.media-file-input');
        newFileInput.addEventListener('change', () => {
          if (newFileInput.files.length > 0) {
            this.uploadMediaFile(newFileInput.files[0], fieldElement);
            newFileInput.value = '';
          }
        });
      }, 3000);
    }
  },

  // Threshold for switching from dropdown to searchable combobox
  FK_DROPDOWN_THRESHOLD: 20,

  /**
   * Load FK dropdown options from API
   * Uses _label fields from the View for display
   * Automatically switches to searchable combobox for large datasets (>20 records)
   */
  async loadFKDropdowns() {
    const fkSelects = document.querySelectorAll('.fk-select');

    for (const select of fkSelects) {
      const entityName = select.dataset.fkEntity;
      const currentValue = select.dataset.fkValue;
      const fieldName = select.name;

      try {
        // Fetch all records from the referenced entity
        const result = await ApiClient.getAll(entityName);
        const records = result.data || [];

        // Get schema to find label field
        const refSchema = await SchemaCache.getExtended(entityName);
        const labelFields = refSchema.ui?.labelFields || [];

        // Build options data
        const options = records.map(rec => {
          let label = `#${rec.id}`;
          if (labelFields.length > 0 && rec[labelFields[0]]) {
            label = rec[labelFields[0]];
            if (labelFields.length > 1 && rec[labelFields[1]]) {
              label += ` (${rec[labelFields[1]]})`;
            }
          }
          return { id: rec.id, label };
        });

        // Choose rendering based on record count
        if (records.length <= this.FK_DROPDOWN_THRESHOLD) {
          // Small dataset: use dropdown
          this.renderFKDropdown(select, options, currentValue);
        } else {
          // Large dataset: use searchable combobox
          this.renderFKCombobox(select, options, currentValue, fieldName);
        }
      } catch (err) {
        // On error, show a simple input fallback
        select.innerHTML = `<option value="${currentValue}">${currentValue || i18n.t('error_loading_options')}</option>`;
        console.error(`Failed to load FK options for ${entityName}:`, err);
      }
    }
  },

  /**
   * Render FK field as a simple dropdown (for small datasets)
   */
  renderFKDropdown(select, options, currentValue) {
    let optionsHtml = `<option value="">${i18n.t('select_option')}</option>`;

    for (const opt of options) {
      const selected = String(opt.id) === String(currentValue) ? 'selected' : '';
      optionsHtml += `<option value="${opt.id}" ${selected}>${DomUtils.escapeHtml(opt.label)}</option>`;
    }

    select.innerHTML = optionsHtml;
  },

  /**
   * Render FK field as a searchable combobox (for large datasets)
   * Uses input + datalist for native browser autocomplete
   */
  renderFKCombobox(select, options, currentValue, fieldName) {
    const container = select.parentElement;
    const datalistId = `datalist-${fieldName}`;

    // Find current label for display
    const currentOption = options.find(opt => String(opt.id) === String(currentValue));
    const displayValue = currentOption ? currentOption.label : '';

    // Create datalist with options
    let datalistHtml = '';
    for (const opt of options) {
      datalistHtml += `<option value="${DomUtils.escapeHtml(opt.label)}" data-id="${opt.id}">`;
    }

    // Create hidden input for actual ID value
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = fieldName;
    hiddenInput.value = currentValue || '';
    hiddenInput.className = 'fk-hidden-value';

    // Create visible input with datalist
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'form-input fk-combobox';
    searchInput.setAttribute('list', datalistId);
    searchInput.placeholder = i18n.t('search_options', { count: options.length });
    searchInput.value = displayValue;
    searchInput.autocomplete = 'off';

    // Create datalist
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    datalist.innerHTML = datalistHtml;

    // Store options for lookup
    searchInput._fkOptions = options;
    searchInput._hiddenInput = hiddenInput;

    // Event: Update hidden value when selection changes
    searchInput.addEventListener('input', () => {
      const typed = searchInput.value;
      const match = options.find(opt => opt.label === typed);

      if (match) {
        hiddenInput.value = match.id;
      } else if (typed === '') {
        hiddenInput.value = '';
      }
      // If no match and not empty, keep previous value (user still typing)
    });

    // Event: Validate on blur
    searchInput.addEventListener('blur', () => {
      const typed = searchInput.value;
      const match = options.find(opt => opt.label === typed);

      if (!match && typed !== '') {
        // Invalid value - clear or show warning
        searchInput.classList.add('error');
      } else {
        searchInput.classList.remove('error');
        if (match) {
          hiddenInput.value = match.id;
        } else {
          hiddenInput.value = '';
        }
      }
    });

    // Replace select with combobox
    select.replaceWith(hiddenInput);
    hiddenInput.after(searchInput);
    searchInput.after(datalist);
  },

  getInputType(col) {
    // Built-in types first
    if (col.customType === 'mail') return 'email';
    if (col.customType === 'url') return 'url';
    if (col.customType === 'json') return 'textarea';
    if (col.customType === 'media') return 'media';
    // Legacy checks
    if (col.type === 'number') return 'number';
    if (col.name.includes('date')) return 'date';
    if (col.name.includes('email')) return 'email';
    return 'text';
  },

  renderInput(col, value, isReadonly, inputType) {
    const disabled = isReadonly ? 'disabled' : '';
    const displayValue = value !== null && value !== undefined ? value : '';

    // Enum fields: render as dropdown
    if (col.enumValues && col.enumValues.length > 0) {
      let options = `<option value="">${i18n.t('select_option')}</option>`;
      for (const opt of col.enumValues) {
        // Support both formats: { value, label } and { internal, external }
        const value = opt.value !== undefined ? opt.value : opt.internal;
        const label = opt.label !== undefined ? opt.label : opt.external;
        const selected = String(value) === String(displayValue) ? 'selected' : '';
        options += `<option value="${value}" ${selected}>${label}</option>`;
      }
      return `
        <select class="form-input"
                id="field-${col.name}"
                name="${col.name}"
                ${disabled}>
          ${options}
        </select>
      `;
    }

    if (col.foreignKey) {
      // FK fields: render as dropdown with labels (loaded async)
      // Initially show a loading state, then populate with options
      return `
        <select class="form-input fk-select"
                id="field-${col.name}"
                name="${col.name}"
                data-fk-entity="${col.foreignKey.entity}"
                data-fk-value="${displayValue}"
                ${disabled}>
          <option value="">${i18n.t('loading')}</option>
        </select>
      `;
    }

    // Boolean fields: render as checkbox
    if (col.type === 'boolean') {
      const checked = displayValue === true || displayValue === 'true' || displayValue === 1;
      return `
        <input type="checkbox"
               class="form-input form-checkbox"
               id="field-${col.name}"
               name="${col.name}"
               value="1"
               ${checked ? 'checked' : ''}
               ${disabled}>
      `;
    }

    // JSON fields: render as textarea
    if (col.customType === 'json' || inputType === 'textarea') {
      // Pretty-print JSON for editing
      let jsonValue = displayValue;
      if (displayValue && typeof displayValue === 'object') {
        jsonValue = JSON.stringify(displayValue, null, 2);
      } else if (displayValue && typeof displayValue === 'string') {
        try {
          jsonValue = JSON.stringify(JSON.parse(displayValue), null, 2);
        } catch {
          jsonValue = displayValue;
        }
      }
      return `
        <textarea class="form-input form-textarea json-input"
                  id="field-${col.name}"
                  name="${col.name}"
                  rows="6"
                  ${disabled}>${DomUtils.escapeHtml(jsonValue)}</textarea>
      `;
    }

    // Media fields: file upload with preview
    if (col.customType === 'media') {
      const mediaId = displayValue || '';
      const hasValue = mediaId && mediaId.length > 0;
      return `
        <div class="media-field" data-field="${col.name}">
          <input type="hidden"
                 class="form-input media-value"
                 id="field-${col.name}"
                 name="${col.name}"
                 value="${DomUtils.escapeHtml(mediaId)}">
          <div class="media-preview ${hasValue ? '' : 'hidden'}">
            <img class="media-thumbnail"
                 src="${hasValue ? `/api/media/${mediaId}/thumbnail` : ''}"
                 onerror="this.src='/icons/file.svg'; this.classList.add('media-thumb-fallback')">
            <span class="media-filename"></span>
            <button type="button" class="media-remove btn-icon" ${disabled} title="Entfernen">&times;</button>
          </div>
          <div class="media-dropzone ${hasValue ? 'hidden' : ''}" ${isReadonly ? 'style="display:none"' : ''}>
            <span>Datei hierher ziehen oder klicken</span>
            <input type="file" class="media-file-input">
          </div>
        </div>
      `;
    }

    return `
      <input type="${inputType}"
             class="form-input"
             id="field-${col.name}"
             name="${col.name}"
             value="${displayValue}"
             ${disabled}>
    `;
  },

  onInput() {
    // Clear field errors on input
    const form = document.getElementById('entity-form');
    form.querySelectorAll('.form-input.error').forEach(input => {
      input.classList.remove('error');
    });
    form.querySelectorAll('.field-error').forEach(err => {
      err.textContent = '';
    });
  },

  checkDirty() {
    if (!this.currentRecord) {
      // For create, dirty if any field has value
      const form = document.getElementById('entity-form');
      const formData = new FormData(form);
      this.isDirty = [...formData.values()].some(v => v !== '');
    } else {
      // For edit, compare with original
      const currentData = this.getFormData();
      this.isDirty = Object.keys(currentData).some(key => {
        return String(currentData[key]) !== String(this.originalData[key] || '');
      });
    }
  },

  getFormData() {
    const form = document.getElementById('entity-form');
    const formData = new FormData(form);
    const data = {};

    // Build a map of column info for type conversion
    const colMap = {};
    if (this.currentSchema) {
      for (const col of this.currentSchema.columns) {
        colMap[col.name] = col;
      }
    }

    formData.forEach((value, key) => {
      if (key === 'id') return; // Skip id

      const col = colMap[key];

      // Skip boolean fields — handled separately below (unchecked checkboxes are absent from FormData)
      if (col && col.type === 'boolean') return;

      const input = form.querySelector(`[name="${key}"]`);

      if (value === '') {
        data[key] = null;
      } else if (input && input.type === 'number') {
        data[key] = parseInt(value, 10);
      } else if (col && col.foreignKey) {
        // FK field: always parse as integer (ID)
        data[key] = parseInt(value, 10);
      } else if (col && col.enumValues && col.enumValues.length > 0) {
        // Enum field: check if values are numeric
        // Support both formats: { value } and { internal }
        const firstOpt = col.enumValues[0];
        const firstValue = firstOpt.value !== undefined ? firstOpt.value : firstOpt.internal;
        if (typeof firstValue === 'number') {
          data[key] = parseInt(value, 10);
        } else {
          data[key] = value;
        }
      } else if (col && col.type === 'number') {
        data[key] = parseInt(value, 10);
      } else {
        data[key] = value;
      }
    });

    // Boolean fields: read checkbox state directly (unchecked checkboxes are excluded from FormData)
    if (this.currentSchema) {
      for (const col of this.currentSchema.columns) {
        if (col.type === 'boolean' && col.name !== 'id') {
          const checkbox = form.querySelector(`#field-${col.name}`);
          if (checkbox) {
            data[col.name] = checkbox.checked;
          }
        }
      }
    }

    return data;
  },

  async onSubmit(e) {
    e.preventDefault();

    const data = this.getFormData();
    const isEdit = this.currentRecord !== null;

    // Clear previous errors
    this.clearErrors();

    try {
      let result;
      if (isEdit) {
        // OCC: Pass version from current record
        const version = this.currentRecord.version;
        result = await ApiClient.update(this.currentEntity, this.currentRecord.id, data, version);
      } else {
        result = await ApiClient.create(this.currentEntity, data);
      }

      this.isDirty = false;

      // Refresh the list and show the saved record
      await EntityExplorer.refresh();

      // Show success and display the record
      DetailPanel.showRecord(this.currentEntity, result);

    } catch (err) {
      await this.handleError(err, data);
    }
  },

  async handleError(err, submittedData = null) {
    // OCC: Version conflict
    if (err.code === 'VERSION_CONFLICT' && err.details?.currentRecord) {
      const result = await ConflictDialog.show(
        this.currentEntity,
        submittedData,
        err.details.currentRecord,
        this.currentSchema
      );

      if (result.action === 'reload') {
        // Reload form with server version
        this.currentRecord = err.details.currentRecord;
        this.originalData = { ...err.details.currentRecord };
        const container = document.getElementById('panel-content');
        await this.render(container, this.currentEntity, err.details.currentRecord);
      } else if (result.action === 'overwrite') {
        // Retry with new version (force update)
        try {
          const newVersion = err.details.currentRecord.version;
          const updated = await ApiClient.update(
            this.currentEntity,
            this.currentRecord.id,
            submittedData,
            newVersion
          );
          this.isDirty = false;
          await EntityExplorer.refresh();
          DetailPanel.showRecord(this.currentEntity, updated);
        } catch (retryErr) {
          alert(i18n.t('error_generic', { message: retryErr.message }));
        }
      }
      // 'cancel' action: do nothing, user stays in form
      return;
    }

    if (err.details && Array.isArray(err.details)) {
      // Validation errors
      err.details.forEach(detail => {
        const input = document.getElementById(`field-${detail.field}`);
        const errorEl = document.getElementById(`error-${detail.field}`);
        if (input) input.classList.add('error');
        if (errorEl) errorEl.textContent = detail.message;
      });
    } else {
      // General error
      alert(i18n.t('error_generic', { message: err.message }));
    }
  },

  clearErrors() {
    document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  },

  async onCancel() {
    if (this.isDirty) {
      const confirmed = confirm(i18n.t('unsaved_changes_warning'));
      if (!confirmed) return;
    }

    this.isDirty = false;

    if (this.currentRecord) {
      // Go back to view mode
      DetailPanel.showRecord(this.currentEntity, this.currentRecord);
    } else {
      // Clear panel
      DetailPanel.clear();
    }
  },

  hasUnsavedChanges() {
    return this.isDirty;
  },
};

// Confirm Dialog Component
const ConfirmDialog = {
  dialog: null,
  messageEl: null,
  rememberCheckbox: null,
  skipConfirm: false,

  init() {
    this.dialog = document.getElementById('confirm-dialog');
    this.messageEl = document.getElementById('confirm-message');
    this.rememberCheckbox = document.getElementById('confirm-remember');

    document.getElementById('confirm-cancel').addEventListener('click', () => {
      this.resolve(false);
    });

    document.getElementById('confirm-ok').addEventListener('click', () => {
      if (this.rememberCheckbox.checked) {
        this.skipConfirm = true;
      }
      this.resolve(true);
    });

    // Close on backdrop click
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) {
        this.resolve(false);
      }
    });
  },

  show(message) {
    // Skip if user chose "don't ask again"
    if (this.skipConfirm) {
      return Promise.resolve(true);
    }

    this.messageEl.textContent = message;
    this.rememberCheckbox.checked = false;

    return new Promise((resolve) => {
      this.resolve = (result) => {
        this.dialog.close();
        resolve(result);
      };
      this.dialog.showModal();
    });
  },

  reset() {
    this.skipConfirm = false;
  },
};
