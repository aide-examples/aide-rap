/**
 * AIDE RAP - Client-side initialization
 */

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
        showAbout: true,
        showHelp: true,
        showLanguage: true,
        showGoogleTranslate: true,
        aboutLink: '/about',
        helpLink: '/help'
      });

      // Apply custom title HTML if configured
      if (titleHtml) {
        const h1 = document.querySelector('#app-header h1');
        if (h1) h1.innerHTML = titleHtml;
      }
    }

    // Initialize Framework Status Widget (Footer)
    if (typeof StatusWidget !== 'undefined') {
      StatusWidget.init('#status-widget', {
        showRestart: true,
        showUpdate: true,
        showInstall: true,
        showLayoutToggle: false,
        layoutDefault: 'page-fill'
      });

      // Add record count to status footer (without modifying aide-frame)
      const footerInfo = document.querySelector('.status-footer-info');
      if (footerInfo) {
        const sep = document.createElement('span');
        sep.className = 'status-footer-sep';
        sep.textContent = '·';
        sep.id = 'sw-records-sep';
        sep.style.display = 'none';

        const recordsEl = document.createElement('span');
        recordsEl.id = 'sw-records';

        footerInfo.appendChild(sep);
        footerInfo.appendChild(recordsEl);
      }
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
          // Not authenticated - show login dialog
          await LoginDialog.show();
          return; // Stop initialization until login completes
        }
        // Store current user for permission checks
        window.currentUser = await authRes.json();
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
