/**
 * AIDE IRMA - Client-side initialization
 */

(async () => {
  try {
    // Initialize Framework i18n
    if (typeof i18n !== 'undefined') {
      await i18n.init();
    }

    // Initialize Framework Header Widget
    if (typeof HeaderWidget !== 'undefined') {
      HeaderWidget.init('#app-header', {
        appName: 'AIDE IRMA',
        showAbout: true,
        showHelp: true,
        showLanguage: true,
        aboutLink: '/about',
        helpLink: '/help'
      });
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

    // Initialize IRMA components
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

    console.log('AIDE IRMA initialized');

    // Handle page unload warning for unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (EntityForm.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

  } catch (err) {
    console.error('Failed to initialize AIDE IRMA:', err);
  }
})();
