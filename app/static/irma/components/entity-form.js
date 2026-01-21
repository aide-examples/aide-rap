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
      const isReadonly = col.name === 'id';
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
          ${isEdit ? 'Save Changes' : 'Create'}
        </button>
        <button type="button" class="btn-cancel" id="btn-cancel">Cancel</button>
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
  },

  getInputType(col) {
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
      let options = '<option value="">-- Select --</option>';
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
      // For now, just use a number input for FK fields
      // In Phase 4, we'll add dropdowns with related entities
      return `
        <input type="number"
               class="form-input"
               id="field-${col.name}"
               name="${col.name}"
               value="${displayValue}"
               ${disabled}
               placeholder="ID of ${col.foreignKey.entity}">
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
      const input = form.querySelector(`[name="${key}"]`);

      if (value === '') {
        data[key] = null;
      } else if (input.type === 'number') {
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
        result = await ApiClient.update(this.currentEntity, this.currentRecord.id, data);
      } else {
        result = await ApiClient.create(this.currentEntity, data);
      }

      this.isDirty = false;

      // Refresh the list and show the saved record
      await EntityExplorer.refresh();

      // Show success and display the record
      DetailPanel.showRecord(this.currentEntity, result);

    } catch (err) {
      this.handleError(err);
    }
  },

  handleError(err) {
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
      alert(`Error: ${err.message}`);
    }
  },

  clearErrors() {
    document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  },

  async onCancel() {
    if (this.isDirty) {
      const confirmed = confirm('You have unsaved changes. Are you sure you want to discard them?');
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
