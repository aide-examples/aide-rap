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
        helpLink: '/about?doc=help/index.md'
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
    }

    // Initialize IRMA components
    await EntityExplorer.init();
    DetailPanel.init();
    ConfirmDialog.init();

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
