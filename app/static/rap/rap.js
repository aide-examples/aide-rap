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

  try {
    // Use pre-hashed password or hash the plaintext password
    const hash = pwh || (password ? await sha256(password) : '');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: user, hash })
    });

    // Clean URL to remove credentials from browser history
    const cleanUrl = location.pathname + (params.size > 2 ? '?' + (() => {
      params.delete('user');
      params.delete('password');
      params.delete('pwh');
      return params.toString();
    })() : '');
    history.replaceState({}, '', cleanUrl || location.pathname);

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
        userEl.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px; margin-right: 3px;">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
          <span class="status-user-role">${window.currentUser.role}</span>
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

    // Admin menu opens Seed Manager
    document.getElementById('menu-tools')?.addEventListener('click', (e) => {
      e.preventDefault();
      SeedManager.open();
    });

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
