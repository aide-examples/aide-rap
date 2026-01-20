/**
 * AIDE IRMA - Client-side initialization
 */

(async () => {
    // Initialize i18n first (required for widgets)
    await i18n.init();

    // Load app config for name and description
    let appName = 'AIDE IRMA';
    let appDescription = '';
    try {
        const res = await fetch('/api/app/config');
        if (res.ok) {
            const config = await res.json();
            appName = config.app_name || appName;
            appDescription = config.app_description || '';
        }
    } catch (e) {
        console.warn('Could not load app config:', e);
    }

    // Show app description (subtitle) on main page
    const subtitle = document.getElementById('app-subtitle');
    if (subtitle && appDescription) {
        subtitle.textContent = appDescription;
        subtitle.classList.add('notranslate');
    }

    // Initialize widgets
    HeaderWidget.init('#app-header', { appName });
    StatusWidget.init('#status-widget');
})();
