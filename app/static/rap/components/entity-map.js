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
   * Check if schema has geo columns
   * @param {Object} schema - View schema (columns) or entity schema (columns)
   * @returns {boolean}
   */
  hasGeoColumns(schema) {
    if (!schema || !schema.columns) return false;
    return schema.columns.some(c => c.aggregateType === 'geo');
  },

  /**
   * Load data onto the map (works with both views and entities)
   * @param {Object} schema - View schema or entity schema (both have columns)
   * @param {Array} records - Data records
   */
  load(schema, records) {
    if (!this.container) {
      this.container = document.getElementById('entity-map-container');
    }

    // Normalize columns to unified format (entity uses 'name', view uses 'key')
    const columns = this.normalizeColumns(schema.columns);

    // Find geo columns (aggregateType === 'geo')
    const geoColumns = columns.filter(c => c.aggregateType === 'geo');

    if (geoColumns.length === 0) {
      this.container.innerHTML = '<p class="empty-message">No geo column found</p>';
      return;
    }

    // Find latitude and longitude columns
    const latCol = geoColumns.find(c => c.aggregateField === 'latitude');
    const lngCol = geoColumns.find(c => c.aggregateField === 'longitude');

    if (!latCol || !lngCol) {
      this.container.innerHTML = '<p class="empty-message">Geo columns incomplete (need latitude + longitude)</p>';
      return;
    }

    // Get label column: first non-geo column, or use schema.labelField if available
    const labelColumn = columns.find(c => c.aggregateType !== 'geo') || columns[0];

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

      // Store label for later tooltip updates
      marker._labelText = String(label);

      // Create popup content with all columns
      const popupContent = this.createPopup(record, columns, labelColumn.key, latCol.key, lngCol.key);
      marker.bindPopup(popupContent, { maxWidth: 300 });

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
        <td class="map-popup-label">Position</td>
        <td class="map-popup-value">${lat.toFixed(4)}, ${lng.toFixed(4)}</td>
      </tr>`;
    }

    html += '</table>';

    // Add link to entity details if we have base entity and id
    if (record.id) {
      html += `<div class="map-popup-actions">
        <a href="#" class="map-popup-link" data-id="${record.id}">View Details</a>
      </div>`;
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
