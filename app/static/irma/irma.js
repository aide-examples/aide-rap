/**
 * AIDE IRMA - Client-side initialization
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize i18n first (required for widgets)
    await i18n.init();

    // Initialize widgets
    HeaderWidget.init('#app-header', { appName: 'AIDE IRMA' });
    StatusWidget.init('#status-widget');

    // Initialize PWA
    PWA.init();
});
