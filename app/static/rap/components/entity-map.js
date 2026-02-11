/**
 * Entity Map Component
 * Displays data on a Leaflet map with marker clustering
 * Works with both Views and Entities
 */
const EntityMap = {
  map: null,
  markerCluster: null,
  container: null,
  markers: [], // Store markers for tooltip toggle
  showPermanentLabels: true,

  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  /**
   * Normalize columns to unified format with 'key' property
   * Entity columns have 'name', view columns have 'key'
   * @param {Array} columns - Raw columns array
   * @returns {Array} Normalized columns with 'key' property
   */
  normalizeColumns(columns) {
    if (!columns) return [];
    return columns.map(c => ({
      key: c.key || c.name,  // Views use 'key', entities use 'name'
      label: c.label || c.key || c.name,
      jsType: c.jsType,
      aggregateType: c.aggregateType,
      aggregateField: c.aggregateField
    }));
  },

  /**
   * Check if schema has geo columns (latitude/longitude pairs)
   * Works with 'geo' type and 'address' type (which includes lat/lng)
   * @param {Object} schema - View schema (columns) or entity schema (columns)
   * @returns {boolean}
   */
  hasGeoColumns(schema) {
    if (!schema || !schema.columns) return false;
    // Look for latitude/longitude fields regardless of aggregate type (geo or address)
    const hasLat = schema.columns.some(c => c.aggregateField === 'latitude');
    const hasLng = schema.columns.some(c => c.aggregateField === 'longitude');
    return hasLat && hasLng;
  },

  /**
   * Load data onto the map (works with both views and entities)
   * @param {Object} schema - View schema or entity schema (both have columns)
   * @param {Array} records - Data records
   * @param {Object} [options] - { entityName } for entity-specific features
   */
  load(schema, records, options = {}) {
    this.entityName = options.entityName || null;
    if (!this.container) {
      this.container = document.getElementById('entity-map-container');
    }

    // Normalize columns to unified format (entity uses 'name', view uses 'key')
    const columns = this.normalizeColumns(schema.columns);

    // Find latitude and longitude columns (works for both 'geo' and 'address' types)
    const latCol = columns.find(c => c.aggregateField === 'latitude');
    const lngCol = columns.find(c => c.aggregateField === 'longitude');

    if (!latCol || !lngCol) {
      this.container.innerHTML = `<p class="empty-message">${i18n.t('map_no_geo_columns')}</p>`;
      return;
    }

    // Get label column: first column that's not lat/lng
    const labelColumn = columns.find(c => c.aggregateField !== 'latitude' && c.aggregateField !== 'longitude') || columns[0];

    // Clear container and create map div
    this.container.innerHTML = `<div id="entity-map" class="entity-map-canvas"></div>`;
    const mapDiv = document.getElementById('entity-map');

    // Initialize map if not already done, or reset it
    if (this.map) {
      this.map.remove();
    }

    this.map = L.map(mapDiv).setView([48.1371, 11.5754], 5); // Default to Europe center
    this.markers = [];

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(this.map);

    // Create marker cluster group
    this.markerCluster = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      maxClusterRadius: 50
    });

    // Collect bounds for auto-zoom
    const bounds = [];

    // Add markers for each record with valid geo data
    for (const record of records) {
      const lat = parseFloat(record[latCol.key]);
      const lng = parseFloat(record[lngCol.key]);

      if (isNaN(lat) || isNaN(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

      bounds.push([lat, lng]);

      // Create marker
      const label = record[labelColumn.key] || `Record #${record.id || '?'}`;
      const marker = L.marker([lat, lng]);

      // Store record ID and label for later access
      marker._recordId = record.id;
      marker._labelText = String(label);

      // Create popup content with all columns
      const popupContent = this.createPopup(record, columns, labelColumn.key, latCol.key, lngCol.key);
      marker.bindPopup(popupContent, { maxWidth: 300 });

      // Track selection when popup opens (for deep-link serialization)
      // Also attach click handlers for API action links
      marker.on('popupopen', (e) => {
        if (typeof EntityExplorer !== 'undefined') {
          EntityExplorer.selectedId = record.id;
        }
        // Attach API link click handlers
        const popupEl = e.popup.getElement();
        if (popupEl) {
          popupEl.querySelectorAll('.map-popup-api-link').forEach(link => {
            link.addEventListener('click', async (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const refreshName = link.dataset.refresh;
              const recordId = link.dataset.recordId;
              if (!this.entityName || !refreshName || !recordId) return;
              try {
                const result = await ApiClient.request(
                  `api/import/refresh/${this.entityName}/${refreshName}/${recordId}/preview`
                );
                if (typeof JsonPreviewDialog !== 'undefined') {
                  JsonPreviewDialog.show(refreshName, result.url, result.raw, {
                    entityName: this.entityName,
                    refreshName,
                    recordId
                  });
                }
              } catch (err) {
                DomUtils.toast(`Preview failed: ${err.message}`, 'error');
              }
            });
          });
        }
      });

      // Add tooltip (permanent based on current setting)
      marker.bindTooltip(marker._labelText, {
        permanent: this.showPermanentLabels,
        direction: 'top',
        offset: [0, -10],
        className: 'map-label-tooltip'
      });

      this.markers.push(marker);
      this.markerCluster.addLayer(marker);
    }

    this.map.addLayer(this.markerCluster);

    // Fit bounds if we have markers
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        this.map.setView(bounds[0], 12);
      } else {
        this.map.fitBounds(bounds, { padding: [50, 50] });
      }
    }

    // Force a resize after the container is visible
    setTimeout(() => {
      this.map.invalidateSize();
    }, 100);
  },

  /**
   * Toggle permanent labels on all markers
   */
  togglePermanentLabels(permanent) {
    this.showPermanentLabels = permanent;
    for (const marker of this.markers) {
      // Unbind and rebind tooltip with new permanent setting
      marker.unbindTooltip();
      marker.bindTooltip(marker._labelText, {
        permanent: permanent,
        direction: 'top',
        offset: [0, -10],
        className: 'map-label-tooltip'
      });
    }
  },

  /**
   * Open popup for a specific record by ID
   * Used when restoring map view from deep-link with selected marker
   * @param {number} recordId - Record ID to open popup for
   */
  openPopupForRecord(recordId) {
    if (!this.map || !this.markerCluster) return;

    const marker = this.markers.find(m => m._recordId === recordId);
    if (!marker) return;

    // Use zoomToShowLayer to uncluster and show the marker, then open popup
    this.markerCluster.zoomToShowLayer(marker, () => {
      marker.openPopup();
    });
  },

  /**
   * Create popup HTML content from record and view columns
   */
  createPopup(record, columns, labelKey, latKey, lngKey) {
    let html = '<div class="map-popup">';

    // Title from label column
    const label = record[labelKey] || 'Unknown';
    html += `<div class="map-popup-title">${DomUtils.escapeHtml(String(label))}</div>`;

    // Table with all other columns (skip label and lat/lng)
    html += '<table class="map-popup-table">';
    for (const col of columns) {
      if (col.key === labelKey) continue; // Skip label, already shown as title
      if (col.key === latKey || col.key === lngKey) continue; // Skip lat/lng shown below

      const value = record[col.key];
      if (value === null || value === undefined || value === '') continue;

      html += `<tr>
        <td class="map-popup-label">${DomUtils.escapeHtml(col.label || col.key)}</td>
        <td class="map-popup-value">${DomUtils.escapeHtml(String(value))}</td>
      </tr>`;
    }

    // Add formatted position
    const lat = parseFloat(record[latKey]);
    const lng = parseFloat(record[lngKey]);
    if (!isNaN(lat) && !isNaN(lng)) {
      html += `<tr>
        <td class="map-popup-label">${i18n.t('position')}</td>
        <td class="map-popup-value">${lat.toFixed(4)}, ${lng.toFixed(4)}</td>
      </tr>`;
    }

    html += '</table>';

    // API action links for single-mode refreshes (when in entity mode with apiRefresh)
    if (this.entityName && record.id) {
      const entitySchema = SchemaCache.getExtended(this.entityName);
      const singleRefreshes = (entitySchema?.apiRefresh || []).filter(r => r.mode === 'single');
      if (singleRefreshes.length > 0) {
        html += '<div class="map-popup-actions">';
        for (const refresh of singleRefreshes) {
          html += `<a href="#" class="map-popup-api-link"
                      data-refresh="${DomUtils.escapeHtml(refresh.name)}"
                      data-record-id="${record.id}">
            ${DomUtils.escapeHtml(refresh.label)} &#8599;</a>`;
        }
        html += '</div>';
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * Clean up map resources
   */
  destroy() {
    if (this.markerCluster) {
      this.markerCluster.clearLayers();
      this.markerCluster = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.markers = [];
  }
};
