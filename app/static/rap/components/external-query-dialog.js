/**
 * ExternalQueryDialog - Modal for querying external REST APIs.
 * Uses the existing .modal-overlay / .modal-dialog CSS pattern.
 * Supports configurable keyword highlighting per provider.
 */
const ExternalQueryDialog = {

  overlay: null,
  currentProvider: null,
  currentTerm: null,
  currentPage: 1,
  totalCount: 0,
  hasMore: false,
  abortController: null,

  // Keyword highlighting
  _keywordsCache: {},    // { providerId: string[] }
  _keywordsRegex: null,  // Compiled regex for current provider

  // Dynamic columns
  _columnsCache: {},     // { providerId: columns[] | null }
  _currentColumns: null, // Active column config for current provider

  /**
   * Open the dialog and run the initial search.
   * @param {string} provider - Provider ID from api_providers.json
   * @param {string} searchTerm - Pre-filled search term
   * @param {string} label - Display label for the dialog title
   */
  async open(provider, searchTerm, label) {
    this.currentProvider = provider;
    this.currentTerm = searchTerm;
    this.currentPage = 1;
    this.totalCount = 0;
    this.hasMore = false;

    // Load keywords and column config for this provider (cached)
    await this._loadKeywords(provider);
    await this._loadColumns(provider);

    // Build table header (dynamic or legacy)
    let theadHtml;
    if (this._currentColumns) {
      theadHtml = '<tr>' + this._currentColumns.map(col =>
        `<th${col.width ? ` style="width:${col.width}"` : ''}>${DomUtils.escapeHtml(col.header)}</th>`
      ).join('') + '</tr>';
    } else {
      theadHtml = `<tr>
        <th style="width:90px">Date</th>
        <th style="width:120px">Document</th>
        <th>Title</th>
      </tr>`;
    }

    const hasLoadMore = !this._currentColumns; // Only paginated providers

    // Create overlay
    if (this.overlay) this.overlay.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ext-query-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog ext-query-dialog">
        <div class="modal-header">
          <h2>${DomUtils.escapeHtml(label)}</h2>
          <button class="modal-close" title="Close">&times;</button>
        </div>
        <div class="ext-query-search">
          <input type="text" class="ext-query-input" value="${DomUtils.escapeHtml(searchTerm)}" placeholder="Search term...">
          <button class="ext-query-search-btn">Search</button>
        </div>
        <div class="modal-body ext-query-body">
          <div class="ext-query-status"></div>
          <table class="ext-query-table">
            <thead>${theadHtml}</thead>
            <tbody></tbody>
          </table>
          ${hasLoadMore ? `<div class="ext-query-load-more" style="display:none">
            <button class="ext-query-more-btn">Load more...</button>
          </div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Event listeners
    overlay.querySelector('.modal-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    document.addEventListener('keydown', this._escHandler = (e) => {
      if (e.key === 'Escape') this.close();
    });

    const input = overlay.querySelector('.ext-query-input');
    const searchBtn = overlay.querySelector('.ext-query-search-btn');

    searchBtn.addEventListener('click', () => {
      this.currentTerm = input.value.trim();
      if (this.currentTerm) {
        this.currentPage = 1;
        overlay.querySelector('.ext-query-table tbody').innerHTML = '';
        this.search();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchBtn.click();
      }
    });

    const moreBtnEl = overlay.querySelector('.ext-query-more-btn');
    if (moreBtnEl) {
      moreBtnEl.addEventListener('click', () => {
        this.currentPage++;
        this.search();
      });
    }

    // Run initial search
    if (searchTerm) {
      this.search();
    } else {
      input.focus();
    }
  },

  /**
   * Close and clean up.
   */
  close() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },

  /**
   * Execute the search against the backend proxy.
   */
  async search() {
    if (!this.overlay) return;

    const statusEl = this.overlay.querySelector('.ext-query-status');
    const tbody = this.overlay.querySelector('.ext-query-table tbody');
    const loadMoreEl = this.overlay.querySelector('.ext-query-load-more');
    const moreBtn = loadMoreEl ? loadMoreEl.querySelector('.ext-query-more-btn') : null;

    // Show loading state
    if (this.currentPage === 1) {
      statusEl.innerHTML = '<span class="ext-query-spinner"></span> Searching...';
      statusEl.className = 'ext-query-status ext-query-loading';
    } else if (moreBtn) {
      moreBtn.disabled = true;
      moreBtn.textContent = 'Loading...';
    }

    // Abort previous request
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    const params = new URLSearchParams({
      provider: this.currentProvider,
      term: this.currentTerm,
      page: String(this.currentPage)
    });

    try {
      const resp = await fetch(`api/admin/external-query?${params}`, {
        signal: this.abortController.signal
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      this.totalCount = data.totalCount || 0;
      this.hasMore = data.hasMore || false;

      // Render results
      if (this.currentPage === 1 && data.results.length === 0) {
        statusEl.textContent = 'No results found.';
        statusEl.className = 'ext-query-status';
        if (loadMoreEl) loadMoreEl.style.display = 'none';
        return;
      }

      // Update status
      if (this._currentColumns) {
        statusEl.textContent = `${data.results.length} result${data.results.length !== 1 ? 's' : ''}`;
      } else {
        const currentCount = tbody.querySelectorAll('tr.ext-query-row').length + data.results.length;
        statusEl.textContent = `${currentCount} of ${this.totalCount} results`;
      }
      statusEl.className = 'ext-query-status';

      // Append rows
      for (const r of data.results) {
        const row = document.createElement('tr');
        row.className = 'ext-query-row';

        if (this._currentColumns) {
          row.innerHTML = this._currentColumns.map(col => this._renderCell(r, col)).join('');
        } else {
          row.innerHTML = `
            <td class="ext-query-date">${DomUtils.escapeHtml(r.date || '')}</td>
            <td><a href="${DomUtils.escapeHtml(r.url)}" target="_blank" rel="noopener" class="ext-query-link">${DomUtils.escapeHtml(r.number || '')}</a></td>
            <td class="ext-query-title-cell">
              <div class="ext-query-title">${this.highlight(r.title || '', this.currentTerm)}</div>
              ${r.abstract ? `<div class="ext-query-abstract">${this.highlight(r.abstract, this.currentTerm)}</div>` : ''}
            </td>
          `;
        }
        tbody.appendChild(row);
      }

      // Show/hide load more (only for paginated providers)
      if (loadMoreEl && moreBtn) {
        loadMoreEl.style.display = this.hasMore ? '' : 'none';
        moreBtn.disabled = false;
        moreBtn.textContent = 'Load more...';
      }

    } catch (err) {
      if (err.name === 'AbortError') return; // Cancelled — ignore
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'ext-query-status ext-query-error';
      if (loadMoreEl && moreBtn) {
        loadMoreEl.style.display = 'none';
        moreBtn.disabled = false;
        moreBtn.textContent = 'Load more...';
      }
    }
  },

  // ─── DYNAMIC COLUMNS ─────────────────────────────────────────

  /**
   * Load column definitions for a provider (cached per session).
   */
  async _loadColumns(providerId) {
    if (this._columnsCache.hasOwnProperty(providerId)) {
      this._currentColumns = this._columnsCache[providerId];
      return;
    }
    try {
      const resp = await fetch(`api/admin/external-query/columns/${encodeURIComponent(providerId)}`);
      if (resp.ok) {
        const data = await resp.json();
        this._columnsCache[providerId] = data.columns;
        this._currentColumns = data.columns;
      } else {
        this._columnsCache[providerId] = null;
        this._currentColumns = null;
      }
    } catch (err) {
      console.warn('Failed to load columns config:', err.message);
      this._columnsCache[providerId] = null;
      this._currentColumns = null;
    }
  },

  /**
   * Render a single table cell based on column type.
   */
  _renderCell(record, col) {
    const value = record[col.key];

    switch (col.type) {
      case 'map-link': {
        const lat = record[col.latKey];
        const lon = record[col.lonKey];
        if (lat != null && lon != null) {
          const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=9/${lat}/${lon}`;
          return `<td><a href="${DomUtils.escapeHtml(osmUrl)}" target="_blank" rel="noopener" class="ext-query-link">${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)}</a></td>`;
        }
        return '<td class="ext-query-muted">—</td>';
      }

      case 'number': {
        const num = (value !== '' && value != null) ? Number(value) : null;
        if (num === null || isNaN(num)) return '<td class="ext-query-muted">—</td>';
        const display = Number.isInteger(num) ? num.toLocaleString() : num.toFixed(1);
        return `<td>${display}${col.suffix || ''}</td>`;
      }

      case 'seconds-ago': {
        const secs = Number(value);
        if (isNaN(secs)) return '<td class="ext-query-muted">—</td>';
        if (secs < 60) return `<td>${Math.round(secs)}s ago</td>`;
        return `<td>${Math.floor(secs / 60)}m ago</td>`;
      }

      default:
        return `<td>${DomUtils.escapeHtml(String(value || ''))}</td>`;
    }
  },

  // ─── KEYWORD HIGHLIGHTING ──────────────────────────────────────

  /**
   * Load keywords for a provider (cached per session).
   */
  async _loadKeywords(providerId) {
    if (this._keywordsCache[providerId]) {
      this._buildKeywordRegex(this._keywordsCache[providerId]);
      return;
    }

    try {
      const resp = await fetch(`api/admin/external-query/keywords/${encodeURIComponent(providerId)}`);
      if (resp.ok) {
        const data = await resp.json();
        const keywords = data.keywords || [];
        this._keywordsCache[providerId] = keywords;
        this._buildKeywordRegex(keywords);
      } else {
        this._keywordsRegex = null;
      }
    } catch (err) {
      console.warn('Failed to load keywords:', err.message);
      this._keywordsRegex = null;
    }
  },

  /**
   * Build a single regex from keyword list, sorted longest-first for greedy matching.
   */
  _buildKeywordRegex(keywords) {
    if (!keywords || keywords.length === 0) {
      this._keywordsRegex = null;
      return;
    }
    // Sort longest first so "landing gear" matches before "landing"
    const sorted = [...keywords].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Word-boundary match, case-insensitive
    this._keywordsRegex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  },

  /**
   * Escape HTML, highlight search term with <mark>, then highlight keywords.
   */
  highlight(text, term) {
    let html = DomUtils.escapeHtml(text);

    // 1. Keyword highlighting (subtle, dark blue)
    if (this._keywordsRegex) {
      this._keywordsRegex.lastIndex = 0;
      html = html.replace(this._keywordsRegex, '<span class="ext-query-keyword">$&</span>');
    }

    // 2. Search term highlighting (yellow mark, takes precedence visually)
    if (term) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(re, '<mark>$&</mark>');
    }

    return html;
  }
};
