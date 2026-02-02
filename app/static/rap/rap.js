/**
 * AIDE RAP - Client-side initialization
 */

/**
 * Try login via URL parameters
 * Supports: ?user=admin&password=xxx or ?user=admin&pwh=<sha256-hash>
 * Password is hashed client-side before transmission
 * URL is cleaned after login attempt to remove credentials from history
 * @returns {Promise<boolean>} true if login succeeded
 */
async function tryUrlLogin() {
  const params = new URLSearchParams(location.search);
  const user = params.get('user');
  const password = params.get('password');
  const pwh = params.get('pwh');

  // Need user role and either password or pre-hashed password
  if (!user || (!password && !pwh)) {
    return false;
  }

  // IMMEDIATELY clean URL to remove credentials from browser history
  // This must happen before any async operations (hash, fetch) that could fail
  const otherParams = new URLSearchParams(location.search);
  otherParams.delete('user');
  otherParams.delete('password');
  otherParams.delete('pwh');
  const cleanUrl = location.pathname + (otherParams.size ? '?' + otherParams.toString() : '');
  history.replaceState({}, '', cleanUrl);

  try {
    // Use pre-hashed password or hash the plaintext password
    const hash = pwh || (password ? await sha256(password) : '');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: user, hash })
    });

    return res.ok;
  } catch (e) {
    console.error('URL login failed:', e);
    return false;
  }
}

(async () => {
  try {
    // Initialize Framework i18n
    if (typeof i18n !== 'undefined') {
      await i18n.init();
      i18n.applyToDOM();  // Apply translations to data-i18n and data-i18n-title attributes
    }

    // Load app config to get system-specific name
    let appName = 'AIDE RAP';
    let titleHtml = null;
    try {
      const configRes = await fetch('/api/app/config');
      if (configRes.ok) {
        const config = await configRes.json();
        appName = config.app_name || appName;
        titleHtml = config.title_html || null;
        document.title = appName;
      }
    } catch (e) {
      console.warn('Could not load app config:', e);
    }

    // Initialize Framework Header Widget
    if (typeof HeaderWidget !== 'undefined') {
      HeaderWidget.init('#app-header', {
        appName: appName,
        titleHtml: titleHtml,
        showAbout: true,
        showHelp: true,
        showLanguage: true,
        showGoogleTranslate: true,
        aboutLink: '/about',
        helpLink: '/help'
      });

      // Add Settings dropdown to header (before About link)
      const headerRight = document.querySelector('#app-header .header > div:last-child');
      const aboutLink = headerRight?.querySelector('a[href="/about"]');
      if (headerRight && aboutLink) {
        const settingsDropdown = document.createElement('div');
        settingsDropdown.className = 'header-settings-dropdown';
        settingsDropdown.innerHTML = `
          <button type="button" class="header-settings-btn" data-i18n-title="settings_title">⚙ <span data-i18n="settings_btn">Settings</span> <span class="dropdown-arrow">▾</span></button>
          <div class="header-settings-menu">
            <div class="settings-section">
              <label class="settings-label" data-i18n="settings_sort_attributes">Sort Attributes:</label>
              <select id="sort-attributes" class="settings-select">
                <option value="schema" data-i18n="sort_attr_schema">Schema</option>
                <option value="alpha" data-i18n="sort_attr_alpha">ABC</option>
              </select>
            </div>
            <div class="settings-section">
              <label class="settings-label" data-i18n="settings_references">References:</label>
              <select id="sort-references" class="settings-select">
                <option value="end" data-i18n="settings_ref_end">At end</option>
                <option value="start" data-i18n="settings_ref_start">First</option>
                <option value="inline" data-i18n="settings_ref_inline">Inline</option>
              </select>
            </div>
            <div class="settings-divider"></div>
            <label class="settings-checkbox" data-i18n-title="tooltip_show_ids">
              <input type="checkbox" id="show-ids-toggle">
              <span data-i18n="settings_show_ids">Show IDs</span>
            </label>
            <label class="settings-checkbox" data-i18n-title="tooltip_show_cycles">
              <input type="checkbox" id="show-cycles-toggle">
              <span><span data-i18n="settings_show_cycles">Show Cycles</span> ↻<br><small data-i18n="settings_show_cycles_hint">(in tree views)</small></span>
            </label>
            <label class="settings-checkbox" data-i18n-title="tooltip_show_system">
              <input type="checkbox" id="show-system-toggle">
              <span><span data-i18n="settings_show_system">Show System Attributes</span><br><small data-i18n="settings_show_system_hint">(modification times, version)</small></span>
            </label>
          </div>
        `;
        headerRight.insertBefore(settingsDropdown, aboutLink);

        // Apply i18n translations if available
        if (typeof i18n !== 'undefined') {
          i18n.applyToDOM(settingsDropdown);
        }

        // Toggle dropdown on button click
        const btn = settingsDropdown.querySelector('.header-settings-btn');
        const menu = settingsDropdown.querySelector('.header-settings-menu');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.classList.toggle('open');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!settingsDropdown.contains(e.target)) {
            menu.classList.remove('open');
          }
        });

        // Load and persist settings to localStorage
        const settingsKeys = ['show-ids-toggle', 'show-cycles-toggle', 'show-system-toggle'];
        settingsKeys.forEach(key => {
          const checkbox = document.getElementById(key);
          if (checkbox) {
            // Load saved value (default: false/unchecked)
            const saved = localStorage.getItem(`rap-settings-${key}`);
            checkbox.checked = saved === 'true';

            // Save on change
            checkbox.addEventListener('change', () => {
              localStorage.setItem(`rap-settings-${key}`, checkbox.checked);
            });
          }
        });

        // Also persist sort selects
        const sortKeys = ['sort-attributes', 'sort-references'];
        sortKeys.forEach(key => {
          const select = document.getElementById(key);
          if (select) {
            const saved = localStorage.getItem(`rap-settings-${key}`);
            if (saved) select.value = saved;

            select.addEventListener('change', () => {
              localStorage.setItem(`rap-settings-${key}`, select.value);
            });
          }
        });
      }
    }

    // Initialize Framework Status Widget (Footer)
    if (typeof StatusWidget !== 'undefined') {
      StatusWidget.init('#status-widget', {
        showUpdate: true,
        showInstall: true,
        showLayoutToggle: false,
        layoutDefault: 'page-fill',
        extraInfo: '<span id="sw-records-sep" class="status-footer-sep" style="display:none">·</span><span id="sw-records"></span>',
        extraActions: '<a href="https://github.com/aide-examples/aide-rap" target="_blank" class="status-powered-by">powered by AIDE RAP</a>'
      });
    }

    // Check authentication status
    if (typeof LoginDialog !== 'undefined') {
      // First check if auth is enabled at all
      const authConfigRes = await fetch('/api/auth/config');
      const authConfig = await authConfigRes.json();

      if (!authConfig.enabled && !authConfig.notConfigured) {
        // Auth disabled (e.g., --noauth flag) - full access as "master"
        window.currentUser = { role: 'master' };
      } else {
        // Auth enabled - check session
        const authRes = await fetch('/api/auth/me');
        if (authRes.status === 401) {
          // Not authenticated - try URL-parameter login first
          const urlLoginSuccess = await tryUrlLogin();
          if (!urlLoginSuccess) {
            // No URL params or login failed - show login dialog
            await LoginDialog.show();
            return; // Stop initialization until login completes
          }
          // URL login succeeded - continue initialization
          const meRes = await fetch('/api/auth/me');
          window.currentUser = await meRes.json();
        } else {
          // Already authenticated
          window.currentUser = await authRes.json();
        }
      }

      // Add user indicator to status footer
      const footerInfo = document.querySelector('.status-footer-info');
      if (footerInfo && window.currentUser) {
        const sep = document.createElement('span');
        sep.className = 'status-footer-sep';
        sep.textContent = '·';

        const userEl = document.createElement('span');
        userEl.className = 'status-user-indicator';
        const isMaster = window.currentUser.role === 'master';
        const ipDisplay = window.currentUser.ip ? ` @ ${window.currentUser.ip}` : '';
        userEl.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px; margin-right: 3px;">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
          <span class="status-user-role">${window.currentUser.role}${ipDisplay}</span>
        `;
        if (isMaster) {
          userEl.title = 'Development mode (--noauth)';
        } else {
          userEl.title = 'Click to logout';
          userEl.style.cursor = 'pointer';
          userEl.addEventListener('click', () => {
            if (confirm('Logout?')) {
              LoginDialog.logout();
            }
          });
        }

        footerInfo.appendChild(sep);
        footerInfo.appendChild(userEl);

        // Add Admin link for admin users only
        if (window.currentUser.role === 'admin') {
          const adminSep = document.createElement('span');
          adminSep.className = 'status-footer-sep';
          adminSep.textContent = '·';

          const adminEl = document.createElement('a');
          adminEl.href = '#';
          adminEl.className = 'status-admin-link';
          adminEl.innerHTML = `⚙ ${i18n.t('admin_functions')}`;
          adminEl.title = i18n.t('admin_panel');
          adminEl.addEventListener('click', (e) => {
            e.preventDefault();
            SeedManager.open();
          });

          footerInfo.appendChild(adminSep);
          footerInfo.appendChild(adminEl);
        }
      }
    }

    // Initialize RAP components
    await EntityExplorer.init();
    DetailPanel.init();
    ConfirmDialog.init();
    ConflictDialog.init();
    ContextMenu.init();
    SeedManager.init('modal-container');
    SeedImportDialog.init('modal-container');
    SeedPreviewDialog.init('modal-container');

    console.log('AIDE RAP initialized');

    // Handle page unload warning for unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (EntityForm.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

  } catch (err) {
    console.error('Failed to initialize AIDE RAP:', err);
  }
})();
