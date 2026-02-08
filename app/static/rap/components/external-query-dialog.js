/**
 * ExternalQueryDialog - Modal for querying external REST APIs.
 * Uses the existing .modal-overlay / .modal-dialog CSS pattern.
 */
const ExternalQueryDialog = {

  overlay: null,
  currentProvider: null,
  currentTerm: null,
  currentPage: 1,
  totalCount: 0,
  hasMore: false,
  abortController: null,

  /**
   * Open the dialog and run the initial search.
   * @param {string} provider - Provider ID from api_providers.json
   * @param {string} searchTerm - Pre-filled search term
   * @param {string} label - Display label for the dialog title
   */
  open(provider, searchTerm, label) {
    this.currentProvider = provider;
    this.currentTerm = searchTerm;
    this.currentPage = 1;
    this.totalCount = 0;
    this.hasMore = false;

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
            <thead>
              <tr>
                <th style="width:90px">Date</th>
                <th style="width:120px">Document</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
          <div class="ext-query-load-more" style="display:none">
            <button class="ext-query-more-btn">Load more...</button>
          </div>
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

    overlay.querySelector('.ext-query-more-btn').addEventListener('click', () => {
      this.currentPage++;
      this.search();
    });

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
    const moreBtn = this.overlay.querySelector('.ext-query-more-btn');

    // Show loading state
    if (this.currentPage === 1) {
      statusEl.innerHTML = '<span class="ext-query-spinner"></span> Searching...';
      statusEl.className = 'ext-query-status ext-query-loading';
    } else {
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
      const resp = await fetch(`/api/admin/external-query?${params}`, {
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
        loadMoreEl.style.display = 'none';
        return;
      }

      // Update status
      const currentCount = tbody.querySelectorAll('tr.ext-query-row').length + data.results.length;
      statusEl.textContent = `${currentCount} of ${this.totalCount} results`;
      statusEl.className = 'ext-query-status';

      // Append rows
      for (const r of data.results) {
        const row = document.createElement('tr');
        row.className = 'ext-query-row';
        row.innerHTML = `
          <td class="ext-query-date">${DomUtils.escapeHtml(r.date || '')}</td>
          <td><a href="${DomUtils.escapeHtml(r.url)}" target="_blank" rel="noopener" class="ext-query-link">${DomUtils.escapeHtml(r.number || '')}</a></td>
          <td class="ext-query-title-cell">
            <div class="ext-query-title">${this.highlight(r.title || '', this.currentTerm)}</div>
            ${r.abstract ? `<div class="ext-query-abstract">${this.highlight(r.abstract, this.currentTerm)}</div>` : ''}
          </td>
        `;
        tbody.appendChild(row);
      }

      // Show/hide load more
      loadMoreEl.style.display = this.hasMore ? '' : 'none';
      moreBtn.disabled = false;
      moreBtn.textContent = 'Load more...';

    } catch (err) {
      if (err.name === 'AbortError') return; // Cancelled — ignore
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'ext-query-status ext-query-error';
      loadMoreEl.style.display = 'none';
      moreBtn.disabled = false;
      moreBtn.textContent = 'Load more...';
    }
  },

  /**
   * Escape HTML and highlight search term occurrences with <mark>.
   */
  highlight(text, term) {
    const escaped = DomUtils.escapeHtml(text);
    if (!term) return escaped;
    // Escape regex special chars in search term, match case-insensitive
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return escaped.replace(re, '<mark>$&</mark>');
  }
};
