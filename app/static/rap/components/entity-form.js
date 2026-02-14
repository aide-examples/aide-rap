/**
 * Entity Form Component
 * Dynamic form for creating/editing entity records
 */

// System columns that are always hidden in forms (managed by the system)
const SYSTEM_COLUMNS_FORM = ['_version', '_created_at', '_updated_at'];

const EntityForm = {
  currentEntity: null,
  currentRecord: null,
  originalData: null,
  isDirty: false,

  async render(container, entityName, record = null) {
    // Cleanup existing map instances
    this.cleanupGeoMaps();

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

    // Identify aggregate groups: { sourceName: [columns] }
    const aggregateGroups = {};
    const renderedAggregates = new Set();
    for (const col of schema.columns) {
      if (col.aggregateSource) {
        if (!aggregateGroups[col.aggregateSource]) {
          aggregateGroups[col.aggregateSource] = [];
        }
        aggregateGroups[col.aggregateSource].push(col);
      }
    }

    for (const col of schema.columns) {
      // Always skip system columns in forms (managed by the system)
      if (SYSTEM_COLUMNS_FORM.includes(col.name)) continue;
      // Skip id field for create, show as readonly for edit
      if (col.name === 'id' && !isEdit) continue;

      // Handle aggregate fields: render as a group
      if (col.aggregateSource) {
        const groupName = col.aggregateSource;
        if (renderedAggregates.has(groupName)) continue; // Already rendered
        renderedAggregates.add(groupName);

        const groupCols = aggregateGroups[groupName];
        const typeName = col.aggregateType || 'geo';
        const isGeo = typeName === 'geo';
        const isAddress = typeName === 'address';

        html += `
          <fieldset class="form-fieldset aggregate-group" data-aggregate="${groupName}" data-aggregate-type="${typeName}">
            <legend>
              ${groupName} <span class="aggregate-type">(${typeName})</span>
              ${isGeo ? `
                <button type="button" class="geo-search-btn btn-icon" title="${i18n.t('tooltip_search_address')}">🔍</button>
                <button type="button" class="geo-reverse-btn btn-icon" title="${i18n.t('tooltip_show_address')}">📍</button>
                <button type="button" class="geo-map-toggle btn-icon" title="${i18n.t('tooltip_toggle_map')}">🗺️</button>
              ` : ''}
              ${isAddress ? `
                <button type="button" class="address-search-btn btn-icon" title="${i18n.t('tooltip_search_address')}">🔍</button>
                <button type="button" class="address-map-btn btn-icon" title="${i18n.t('tooltip_show_on_map')}">🗺️</button>
              ` : ''}
            </legend>
            ${isGeo ? `
              <div class="geo-address-display hidden" data-aggregate="${groupName}"></div>
              <div class="geo-map-container hidden" data-aggregate="${groupName}"><div class="geo-map" id="geo-map-${groupName}"></div></div>
            ` : ''}
            ${isAddress ? `
              <div class="address-map-container hidden" data-aggregate="${groupName}"><div class="geo-map" id="address-map-${groupName}"></div></div>
            ` : ''}
            <div class="aggregate-fields">`;

        for (const subCol of groupCols) {
          let value;
          if (record) {
            value = record[subCol.name];
          } else {
            value = subCol.defaultValue !== undefined ? subCol.defaultValue : '';
          }

          const subLabel = subCol.aggregateField || subCol.name.replace(`${groupName}_`, '');
          // Determine input type based on column type (number vs string)
          const inputType = subCol.type === 'number' ? 'number' : 'text';
          const stepAttr = subCol.type === 'number' ? 'step="any"' : '';

          // For address type: make lat/lng readonly with special styling
          const isGeoField = isAddress && (subCol.aggregateField === 'latitude' || subCol.aggregateField === 'longitude');
          const readonlyAttr = isGeoField ? 'readonly' : '';
          const geoClass = isGeoField ? 'geocoded-field' : '';
          const geoHint = isGeoField ? '<span class="geocoded-hint">📍 via Adresssuche</span>' : '';

          html += `
              <div class="form-field aggregate-subfield ${geoClass}">
                <label class="form-label" for="field-${subCol.name}">${subLabel} ${geoHint}</label>
                <input type="${inputType}" ${stepAttr} ${readonlyAttr} class="form-input"
                       id="field-${subCol.name}" name="${subCol.name}"
                       value="${value !== null && value !== undefined ? value : ''}">
                <div class="field-error" id="error-${subCol.name}"></div>
              </div>`;
        }

        html += `
            </div>
          </fieldset>`;
        continue;
      }

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
    form.addEventListener('input', (e) => this.onInput(e));

    document.getElementById('btn-cancel').addEventListener('click', () => this.onCancel());

    // Track dirty state + blur validation
    form.querySelectorAll('.form-input').forEach(input => {
      input.addEventListener('change', () => this.checkDirty());
      input.addEventListener('blur', () => this.validateFieldOnBlur(input));
    });

    // Load FK dropdown options asynchronously
    await this.loadFKDropdowns();

    // Initialize media field handlers
    this.initMediaFields();

    // Initialize geo map handlers
    this.initGeoMaps();

    // Initialize address search handlers
    this.initAddressSearch();
  },

  /**
   * Cleanup existing Leaflet map instances to prevent memory leaks
   */
  cleanupGeoMaps() {
    for (const name in this.geoMaps) {
      if (this.geoMaps[name]?.map) {
        this.geoMaps[name].map.remove();
      }
    }
    this.geoMaps = {};
  },

  /**
   * Initialize geo field map toggles and Leaflet maps
   */
  geoMaps: {},  // Store map instances by aggregate name

  // Rate limiting for Nominatim API (1 request per second)
  lastGeoRequest: 0,

  async throttledGeoRequest(url) {
    const now = Date.now();
    const elapsed = now - this.lastGeoRequest;
    if (elapsed < 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
    }
    this.lastGeoRequest = Date.now();

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    return response.json();
  },

  initGeoMaps() {
    const geoGroups = document.querySelectorAll('.aggregate-group[data-aggregate-type="geo"]');

    geoGroups.forEach(group => {
      const aggregateName = group.dataset.aggregate;
      const toggleBtn = group.querySelector('.geo-map-toggle');
      const searchBtn = group.querySelector('.geo-search-btn');
      const reverseBtn = group.querySelector('.geo-reverse-btn');
      const mapContainer = group.querySelector('.geo-map-container');
      const mapDiv = group.querySelector('.geo-map');
      const addressDisplay = group.querySelector('.geo-address-display');

      // Search button: open address search dialog
      if (searchBtn) {
        searchBtn.addEventListener('click', () => this.openGeoSearchDialog(aggregateName, group));
      }

      // Reverse button: show address from current coordinates
      if (reverseBtn) {
        reverseBtn.addEventListener('click', () => this.showReverseGeocode(aggregateName, group, addressDisplay));
      }

      if (!toggleBtn || !mapContainer || !mapDiv) return;

      toggleBtn.addEventListener('click', () => {
        const isHidden = mapContainer.classList.contains('hidden');

        if (isHidden) {
          mapContainer.classList.remove('hidden');

          // Initialize map if not already done
          if (!this.geoMaps[aggregateName]) {
            this.initLeafletMap(aggregateName, group, mapDiv);
          } else {
            // Invalidate size when showing (Leaflet needs this)
            setTimeout(() => this.geoMaps[aggregateName].map.invalidateSize(), 10);
          }

          // Update marker position from current field values
          this.updateGeoMarker(aggregateName, group);
          toggleBtn.textContent = '🗺️';
          toggleBtn.title = 'Hide map';
        } else {
          mapContainer.classList.add('hidden');
          toggleBtn.title = 'Show map';
        }
      });

      // Update marker when coordinate fields change
      const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
      const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

      if (latInput && lngInput) {
        const updateHandler = () => {
          if (this.geoMaps[aggregateName]) {
            this.updateGeoMarker(aggregateName, group);
          }
        };
        latInput.addEventListener('change', updateHandler);
        lngInput.addEventListener('change', updateHandler);
      }
    });
  },

  /**
   * Initialize address search handlers for address aggregate fields
   */
  initAddressSearch() {
    const addressGroups = document.querySelectorAll('.aggregate-group[data-aggregate-type="address"]');

    addressGroups.forEach(group => {
      const aggregateName = group.dataset.aggregate;
      const searchBtn = group.querySelector('.address-search-btn');
      const mapBtn = group.querySelector('.address-map-btn');
      const mapContainer = group.querySelector('.address-map-container');
      const mapDiv = group.querySelector('.geo-map');

      if (searchBtn) {
        searchBtn.addEventListener('click', () => this.openAddressSearchDialog(aggregateName, group));
      }

      // Map toggle button for address
      if (mapBtn && mapContainer && mapDiv) {
        mapBtn.addEventListener('click', () => {
          const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
          const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);
          const lat = parseFloat(latInput?.value);
          const lng = parseFloat(lngInput?.value);

          if (isNaN(lat) || isNaN(lng)) {
            alert(i18n.t('geo_no_coordinates'));
            return;
          }

          const isHidden = mapContainer.classList.contains('hidden');
          if (isHidden) {
            mapContainer.classList.remove('hidden');

            // Initialize map for address (reuse geo map infrastructure)
            if (!this.geoMaps[aggregateName]) {
              this.initLeafletMap(aggregateName, group, mapDiv);
            } else {
              setTimeout(() => this.geoMaps[aggregateName].map.invalidateSize(), 10);
            }
            this.updateGeoMarker(aggregateName, group);
          } else {
            mapContainer.classList.add('hidden');
          }
        });
      }
    });
  },

  /**
   * Open address search dialog for address aggregate fields
   */
  openAddressSearchDialog(aggregateName, group) {
    // Collect existing address values for pre-fill
    const streetInput = group.querySelector(`[name="${aggregateName}_street"]`);
    const cityInput = group.querySelector(`[name="${aggregateName}_city"]`);
    const zipInput = group.querySelector(`[name="${aggregateName}_zip"]`);
    const countryInput = group.querySelector(`[name="${aggregateName}_country"]`);

    const parts = [
      streetInput?.value?.trim(),
      zipInput?.value?.trim(),
      cityInput?.value?.trim(),
      countryInput?.value?.trim()
    ].filter(Boolean);
    const defaultQuery = parts.join(', ');

    // Create modal dialog
    const modal = document.createElement('div');
    modal.className = 'geo-search-modal';
    modal.innerHTML = `
      <div class="geo-search-dialog">
        <div class="geo-search-header">
          <h3>${i18n.t('geo_search_title')}</h3>
          <button type="button" class="geo-search-close btn-icon">×</button>
        </div>
        <div class="geo-search-input-row">
          <input type="text" class="geo-search-input" placeholder="${i18n.t('geo_search_placeholder')}" autofocus>
          <button type="button" class="geo-search-submit btn-icon">🔍</button>
        </div>
        <div class="geo-search-results"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const input = modal.querySelector('.geo-search-input');
    const submitBtn = modal.querySelector('.geo-search-submit');
    const closeBtn = modal.querySelector('.geo-search-close');
    const resultsDiv = modal.querySelector('.geo-search-results');

    // Pre-fill with existing address
    if (defaultQuery) {
      input.value = defaultQuery;
    }

    const doSearch = async () => {
      const query = input.value.trim();
      if (!query) return;

      resultsDiv.innerHTML = `<div class="loading">${i18n.t('geo_searching')}</div>`;

      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
        const results = await this.throttledGeoRequest(url);

        if (results.length === 0) {
          resultsDiv.innerHTML = `<div class="no-results">${i18n.t('geo_no_results')}</div>`;
          return;
        }

        resultsDiv.innerHTML = results.map((r, i) => `
          <div class="geo-search-result" data-index="${i}">
            <strong>${r.display_name.split(',')[0]}</strong>
            <small>${r.display_name}</small>
          </div>
        `).join('');

        // Click handler for results
        resultsDiv.querySelectorAll('.geo-search-result').forEach((el, i) => {
          el.addEventListener('click', () => {
            const result = results[i];
            this.fillAddressFields(aggregateName, group, result);
            modal.remove();
          });
        });
      } catch (err) {
        resultsDiv.innerHTML = `<div class="error">${i18n.t('error_generic', { message: err.message })}</div>`;
      }
    };

    submitBtn.addEventListener('click', doSearch);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    input.focus();
  },

  /**
   * Fill address fields from Nominatim result (including geocoded lat/lng)
   */
  fillAddressFields(aggregateName, group, result) {
    const addr = result.address || {};

    // Map Nominatim fields to our address fields
    const streetInput = group.querySelector(`[name="${aggregateName}_street"]`);
    const cityInput = group.querySelector(`[name="${aggregateName}_city"]`);
    const zipInput = group.querySelector(`[name="${aggregateName}_zip"]`);
    const countryInput = group.querySelector(`[name="${aggregateName}_country"]`);
    const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
    const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

    // Build street from road + house_number
    let street = '';
    if (addr.road) {
      street = addr.road;
      if (addr.house_number) {
        street += ' ' + addr.house_number;
      }
    }

    // City: try multiple fields (city, town, village, municipality)
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';

    // ZIP code
    const zip = addr.postcode || '';

    // Country
    const country = addr.country || '';

    if (streetInput) streetInput.value = street;
    if (cityInput) cityInput.value = city;
    if (zipInput) zipInput.value = zip;
    if (countryInput) countryInput.value = country;

    // Fill geocoded coordinates from Nominatim result
    if (latInput && result.lat) latInput.value = result.lat;
    if (lngInput && result.lon) lngInput.value = result.lon;
  },

  /**
   * Initialize a Leaflet map for a geo aggregate field
   */
  initLeafletMap(aggregateName, group, mapDiv) {
    // Get current coordinates or use default (central Europe)
    const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
    const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

    let lat = parseFloat(latInput?.value) || 48.1351;  // Munich as default
    let lng = parseFloat(lngInput?.value) || 11.5820;
    const hasCoords = latInput?.value && lngInput?.value;

    // Create map
    const map = L.map(mapDiv).setView([lat, lng], hasCoords ? 13 : 4);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);

    // Create marker (draggable)
    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);

    // Update fields when marker is dragged
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      if (latInput) {
        latInput.value = pos.lat.toFixed(6);
        latInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (lngInput) {
        lngInput.value = pos.lng.toFixed(6);
        lngInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.checkDirty();
    });

    // Click on map to set marker position
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      if (latInput) {
        latInput.value = e.latlng.lat.toFixed(6);
        latInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (lngInput) {
        lngInput.value = e.latlng.lng.toFixed(6);
        lngInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.checkDirty();
    });

    this.geoMaps[aggregateName] = { map, marker };
  },

  /**
   * Update marker position from field values
   */
  updateGeoMarker(aggregateName, group) {
    const mapData = this.geoMaps[aggregateName];
    if (!mapData) return;

    const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
    const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

    const lat = parseFloat(latInput?.value);
    const lng = parseFloat(lngInput?.value);

    if (!isNaN(lat) && !isNaN(lng)) {
      mapData.marker.setLatLng([lat, lng]);
      mapData.map.setView([lat, lng], mapData.map.getZoom() < 10 ? 13 : mapData.map.getZoom());
    }
  },

  /**
   * Open address search dialog for geocoding
   */
  async openGeoSearchDialog(aggregateName, group) {
    // Create modal dialog for address search
    const existingDialog = document.getElementById('geo-search-dialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'geo-search-dialog';
    dialog.className = 'geo-search-dialog';
    dialog.innerHTML = `
      <div class="dialog-content">
        <h3>🔍 ${i18n.t('geo_search_title')}</h3>
        <div class="geo-search-form">
          <input type="text" class="form-input geo-search-input" placeholder="${i18n.t('geo_search_placeholder')}" autofocus>
          <button type="button" class="btn-primary geo-search-submit">${i18n.t('geo_search_btn')}</button>
        </div>
        <div class="geo-search-results"></div>
        <div class="dialog-buttons">
          <button type="button" class="btn-secondary geo-search-cancel">${i18n.t('cancel')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const input = dialog.querySelector('.geo-search-input');
    const submitBtn = dialog.querySelector('.geo-search-submit');
    const cancelBtn = dialog.querySelector('.geo-search-cancel');
    const resultsDiv = dialog.querySelector('.geo-search-results');

    const doSearch = async () => {
      const query = input.value.trim();
      if (!query) return;

      resultsDiv.innerHTML = `<div class="loading">${i18n.t('geo_searching')}</div>`;

      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
        const results = await this.throttledGeoRequest(url);

        if (results.length === 0) {
          resultsDiv.innerHTML = `<div class="no-results">${i18n.t('geo_no_results')}</div>`;
          return;
        }

        resultsDiv.innerHTML = results.map((r, i) => `
          <div class="geo-search-result" data-index="${i}">
            <strong>${r.display_name.split(',')[0]}</strong>
            <small>${r.display_name}</small>
          </div>
        `).join('');

        // Click handler for results
        resultsDiv.querySelectorAll('.geo-search-result').forEach((el, i) => {
          el.addEventListener('click', () => {
            const result = results[i];
            this.applyGeoSearchResult(aggregateName, group, result);
            dialog.close();
            dialog.remove();
          });
        });

      } catch (err) {
        resultsDiv.innerHTML = `<div class="error">${i18n.t('error_generic', { message: err.message })}</div>`;
      }
    };

    submitBtn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    cancelBtn.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.close();
        dialog.remove();
      }
    });

    dialog.showModal();
    input.focus();
  },

  /**
   * Apply selected geocoding result to fields
   */
  applyGeoSearchResult(aggregateName, group, result) {
    const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
    const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

    if (latInput) {
      latInput.value = parseFloat(result.lat).toFixed(6);
      latInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (lngInput) {
      lngInput.value = parseFloat(result.lon).toFixed(6);
      lngInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Update map if visible
    if (this.geoMaps[aggregateName]) {
      this.updateGeoMarker(aggregateName, group);
    }

    this.checkDirty();
  },

  /**
   * Show reverse geocoding result (coordinates → address)
   */
  async showReverseGeocode(aggregateName, group, addressDisplay) {
    const latInput = group.querySelector(`[name="${aggregateName}_latitude"]`);
    const lngInput = group.querySelector(`[name="${aggregateName}_longitude"]`);

    const lat = parseFloat(latInput?.value);
    const lng = parseFloat(lngInput?.value);

    if (isNaN(lat) || isNaN(lng)) {
      addressDisplay.textContent = i18n.t('geo_no_results');
      addressDisplay.classList.remove('hidden');
      setTimeout(() => addressDisplay.classList.add('hidden'), 3000);
      return;
    }

    addressDisplay.textContent = i18n.t('geo_loading_address');
    addressDisplay.classList.remove('hidden');

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
      const result = await this.throttledGeoRequest(url);

      if (result.error) {
        addressDisplay.textContent = result.error;
      } else {
        addressDisplay.innerHTML = `
          <span class="geo-address-text">${result.display_name}</span>
          <button type="button" class="geo-address-close btn-icon" title="${i18n.t('cancel')}">×</button>
        `;
        addressDisplay.querySelector('.geo-address-close').addEventListener('click', () => {
          addressDisplay.classList.add('hidden');
        });
      }
    } catch (err) {
      addressDisplay.textContent = i18n.t('error_generic', { message: err.message });
      setTimeout(() => addressDisplay.classList.add('hidden'), 3000);
    }
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
      const inputArea = field.querySelector('.media-input-area');
      const dropzone = field.querySelector('.media-dropzone');
      const fileInput = field.querySelector('.media-file-input');
      const removeBtn = field.querySelector('.media-remove');
      const thumbnail = field.querySelector('.media-thumbnail');
      const filenameSpan = field.querySelector('.media-filename');
      const urlInput = field.querySelector('.media-url-input');
      const urlLoadBtn = field.querySelector('.media-url-load');
      const fileBtn = field.querySelector('.media-file-btn');

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

          // Check for files first
          if (e.dataTransfer.files.length > 0) {
            this.uploadMediaFile(e.dataTransfer.files[0], field);
            return;
          }

          // Check for URL (text/uri-list or text/plain)
          const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
          if (url && this.isValidUrl(url)) {
            this.uploadMediaFromUrl(url, field);
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

      // File button handler
      if (fileBtn && fileInput) {
        fileBtn.addEventListener('click', () => fileInput.click());
      }

      // URL input handlers
      if (urlInput && urlLoadBtn) {
        const loadUrlFromInput = () => {
          const url = urlInput.value.trim();
          if (url && this.isValidUrl(url)) {
            this.uploadMediaFromUrl(url, field);
            urlInput.value = '';
          } else if (url) {
            urlInput.classList.add('error');
            setTimeout(() => urlInput.classList.remove('error'), 2000);
          }
        };

        urlLoadBtn.addEventListener('click', loadUrlFromInput);

        urlInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            loadUrlFromInput();
          }
        });

        // Auto-load on paste if valid URL
        urlInput.addEventListener('paste', (e) => {
          setTimeout(() => {
            const url = urlInput.value.trim();
            if (url && this.isValidUrl(url)) {
              loadUrlFromInput();
            }
          }, 0);
        });
      }

      // Remove button
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          hiddenInput.value = '';
          preview.classList.add('hidden');
          if (inputArea) inputArea.classList.remove('hidden');
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
      const response = await fetch(`api/media/${mediaId}`);
      if (response.ok) {
        const data = await response.json();
        filenameSpan.textContent = data.originalName || mediaId;
      }
    } catch (err) {
      console.warn('Could not load media metadata:', err);
    }
  },

  /**
   * Check if a string is a valid URL
   */
  isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },

  /**
   * Upload media from a URL (server fetches the file)
   */
  async uploadMediaFromUrl(url, fieldElement) {
    const hiddenInput = fieldElement.querySelector('.media-value');
    const preview = fieldElement.querySelector('.media-preview');
    const inputArea = fieldElement.querySelector('.media-input-area');
    const dropzone = fieldElement.querySelector('.media-dropzone');
    const thumbnail = fieldElement.querySelector('.media-thumbnail');
    const filenameSpan = fieldElement.querySelector('.media-filename');
    const urlInput = fieldElement.querySelector('.media-url-input');

    // Show uploading state
    const originalDropzoneHtml = dropzone.innerHTML;
    dropzone.innerHTML = `<span class="uploading">${i18n.t('media_loading_url')}</span>`;

    try {
      const response = await fetch('api/media/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
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
        thumbnail.src = 'icons/file.svg';
        thumbnail.classList.add('media-thumb-fallback');
      }

      preview.classList.remove('hidden');
      inputArea.classList.add('hidden');
      if (urlInput) urlInput.value = '';
      this.checkDirty();

    } catch (err) {
      console.error('Media URL upload error:', err);
      this.resetDropzone(dropzone, fieldElement, `Error: ${err.message}`);
    }
  },

  /**
   * Reset dropzone to initial state after error
   */
  resetDropzone(dropzone, fieldElement, errorMessage = null) {
    if (errorMessage) {
      dropzone.innerHTML = `<span class="error">${errorMessage}</span>`;
    }
    setTimeout(() => {
      dropzone.innerHTML = `<span>${i18n.t('media_drag_file')}</span><input type="file" class="media-file-input">`;
      // Reattach file input handler
      const newFileInput = dropzone.querySelector('.media-file-input');
      newFileInput.addEventListener('change', () => {
        if (newFileInput.files.length > 0) {
          this.uploadMediaFile(newFileInput.files[0], fieldElement);
          newFileInput.value = '';
        }
      });
    }, errorMessage ? 3000 : 0);
  },

  /**
   * Upload a media file and update the field
   */
  async uploadMediaFile(file, fieldElement) {
    const hiddenInput = fieldElement.querySelector('.media-value');
    const preview = fieldElement.querySelector('.media-preview');
    const inputArea = fieldElement.querySelector('.media-input-area');
    const dropzone = fieldElement.querySelector('.media-dropzone');
    const thumbnail = fieldElement.querySelector('.media-thumbnail');
    const filenameSpan = fieldElement.querySelector('.media-filename');

    // Show uploading state
    dropzone.innerHTML = `<span class="uploading">${i18n.t('media_uploading')}</span>`;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('api/media', {
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
        thumbnail.src = 'icons/file.svg';
        thumbnail.classList.add('media-thumb-fallback');
      }

      preview.classList.remove('hidden');
      inputArea.classList.add('hidden');
      this.checkDirty();

    } catch (err) {
      console.error('Media upload error:', err);
      this.resetDropzone(dropzone, fieldElement, `Error: ${err.message}`);
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
        const hasComputedLabel = refSchema.ui?.hasComputedLabel;
        const labelFields = refSchema.ui?.labelFields || [];

        // Build options data
        const options = records.map(rec => {
          let label = `#${rec.id}`;
          // Use computed _label if available (from entity-level labelExpression)
          if (hasComputedLabel && rec._label) {
            label = rec._label;
          } else if (labelFields.length > 0 && rec[labelFields[0]]) {
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
                 src="${hasValue ? `api/media/${mediaId}/thumbnail` : ''}"
                 onerror="this.onerror=null; this.src='icons/file.svg'; this.classList.add('media-thumb-fallback')">
            <span class="media-filename"></span>
            <button type="button" class="media-remove btn-icon" ${disabled} title="${i18n.t('delete')}">&times;</button>
          </div>
          <div class="media-input-area ${hasValue ? 'hidden' : ''}" ${isReadonly ? 'style="display:none"' : ''}>
            <div class="media-dropzone" tabindex="0">
              <span>${i18n.t('media_drag_file')}</span>
              <input type="file" class="media-file-input">
            </div>
            <div class="media-buttons-row">
              <button type="button" class="media-file-btn btn-small">📁 ${i18n.t('media_select_files')}</button>
            </div>
            <div class="media-url-row">
              <input type="text" class="media-url-input form-input" placeholder="${i18n.t('placeholder_url')}">
              <button type="button" class="media-url-load btn-small">${i18n.t('media_load')}</button>
            </div>
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

  onInput(e) {
    // Clear error only for the field being edited
    const input = e?.target?.closest('.form-input');
    if (input) {
      input.classList.remove('error');
      const errorEl = document.getElementById(`error-${input.name}`);
      if (errorEl) errorEl.textContent = '';
    }
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

    // Client-side validation (dual-layer: same rules as server)
    const validator = SchemaCache.getValidator();
    if (validator && validator.hasRules(this.currentEntity)) {
      try {
        if (isEdit) {
          validator.validatePartial(this.currentEntity, data);
        } else {
          validator.validate(this.currentEntity, data);
        }
      } catch (err) {
        if (err.isValidationError) {
          this.showValidationErrors(err.errors);
          return; // Don't submit to server
        }
      }
    }

    try {
      let result;
      if (isEdit) {
        // OCC: Pass version from current record
        const version = this.currentRecord._version;
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
          const newVersion = err.details.currentRecord._version;
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
      this.showValidationErrors(err.details);
    } else {
      // General error
      alert(i18n.t('error_generic', { message: err.message }));
    }
  },

  /**
   * Display validation errors inline on form fields
   * @param {Array<{field, message}>} errors
   */
  showValidationErrors(errors) {
    for (const detail of errors) {
      // Primary field: red border + error message
      const input = document.getElementById(`field-${detail.field}`);
      const errorEl = document.getElementById(`error-${detail.field}`);
      if (input) input.classList.add('error');
      if (errorEl) errorEl.textContent = detail.message;

      // Related fields (cross-field errors): red border only, no duplicate message
      if (detail.relatedFields) {
        for (const relField of detail.relatedFields) {
          const relInput = document.getElementById(`field-${relField}`);
          if (relInput) relInput.classList.add('error');
        }
      }
    }
  },

  /**
   * Validate a single field on blur (dual-layer: same rules as server)
   */
  validateFieldOnBlur(input) {
    if (input.disabled) return; // Skip readonly/computed fields
    const fieldName = input.name;
    if (!fieldName || !this.currentEntity) return;

    const validator = SchemaCache.getValidator();
    if (!validator || !validator.hasRules(this.currentEntity)) return;

    // Skip fields without validation rules (e.g., unknown fields)
    if (!validator.getRule(this.currentEntity, fieldName, 'type') &&
        !validator.getRule(this.currentEntity, fieldName, 'required')) return;

    const value = this.getFieldValue(input);

    // Clear previous error for this field
    const errorEl = document.getElementById(`error-${fieldName}`);
    input.classList.remove('error');
    if (errorEl) errorEl.textContent = '';

    try {
      validator.validateField(this.currentEntity, fieldName, value);
    } catch (err) {
      if (err.isValidationError && err.errors.length > 0) {
        input.classList.add('error');
        if (errorEl) errorEl.textContent = err.errors[0].message;
      }
    }
  },

  /**
   * Extract typed value from an input element for validation
   */
  getFieldValue(input) {
    if (input.type === 'checkbox') return input.checked;
    const value = input.value;
    if (value === '' || value === null || value === undefined) return null;
    if (input.type === 'number') return parseFloat(value);
    // FK selects: parse as integer
    if (input.classList.contains('fk-select') || input.classList.contains('fk-hidden-value')) {
      return parseInt(value, 10);
    }
    return value;
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
