/**
 * Entity Chart Component
 * Displays data as charts using Vega-Lite
 * Works with Views that have a 'chart' configuration
 */
const EntityChart = {
  view: null, // Vega view instance
  container: null,

  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  /**
   * Check if schema has a chart configuration
   * @param {Object} schema - View schema
   * @returns {boolean}
   */
  hasChart(schema) {
    return !!(schema && schema.chart);
  },

  /**
   * Load and render chart from view schema and data
   * @param {Object} schema - View schema with chart config
   * @param {Array} records - Data records
   */
  async load(schema, records) {
    if (!this.container) {
      this.container = document.getElementById('entity-chart-container');
    }

    if (!schema.chart) {
      this.container.innerHTML = `<p class="empty-message">${i18n.t('chart_no_config')}</p>`;
      return;
    }

    if (!records || records.length === 0) {
      this.container.innerHTML = `<p class="empty-message">${i18n.t('chart_no_data')}</p>`;
      return;
    }

    // Clear container
    this.container.innerHTML = '<div id="entity-chart" class="entity-chart-canvas"></div>';
    const chartDiv = document.getElementById('entity-chart');

    // Detect dark mode
    const isDark = document.documentElement.dataset.theme === 'dark';

    // Build complete Vega-Lite spec with muted default color scheme
    const themeConfig = isDark ? {
      background: 'transparent',
      axis: { labelColor: '#e5e7eb', titleColor: '#f3f4f6', gridColor: '#3f3f46', domainColor: '#52525b' },
      legend: { labelColor: '#e5e7eb', titleColor: '#f3f4f6' },
      title: { color: '#f3f4f6' },
      view: { stroke: '#3f3f46' }
    } : {
      axis: { labelColor: '#333', titleColor: '#111' },
      legend: { labelColor: '#333', titleColor: '#111' }
    };

    // Use view description as default chart title (overridden by explicit chart.title)
    const autoTitle = (!schema.chart?.title && schema.description) ? { title: schema.description } : {};

    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: 400,
      padding: { left: 40, right: 20, top: 20, bottom: 40 },
      data: { values: this.prepareData(schema, records) },
      ...autoTitle,
      ...schema.chart,
      config: {
        range: { category: { scheme: 'set2' } },
        ...themeConfig,
        ...(schema.chart?.config || {})
      }
    };

    try {
      // Destroy previous view if exists
      if (this.view) {
        this.view.finalize();
        this.view = null;
      }

      // Render with Vega-Embed
      const result = await vegaEmbed(chartDiv, spec, {
        actions: false, // Hide export buttons
        renderer: 'svg',
        theme: isDark ? 'dark' : 'quartz'
      });

      this.view = result.view;
    } catch (err) {
      console.error('Chart rendering failed:', err);
      this.container.innerHTML = `<p class="empty-message">${i18n.t('chart_error', { message: err.message })}</p>`;
    }
  },

  /**
   * Prepare data for Vega-Lite (strip internal columns)
   * @param {Object} schema - View schema
   * @param {Array} records - Raw records
   * @returns {Array} Cleaned records for charting
   */
  prepareData(schema, records) {
    // Get column keys from schema
    const columnKeys = new Set(schema.columns.map(c => c.key || c.label));

    return records.map(record => {
      const cleaned = {};
      for (const [key, value] of Object.entries(record)) {
        // Skip internal columns (id, _fk_*, etc.)
        if (key === 'id' || key.startsWith('_')) continue;
        // Only include columns that are in the schema
        if (columnKeys.has(key)) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });
  },

  /**
   * Clean up chart resources
   */
  destroy() {
    if (this.view) {
      this.view.finalize();
      this.view = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
};
