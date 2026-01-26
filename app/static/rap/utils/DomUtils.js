/**
 * DomUtils - Shared DOM utility functions
 *
 * Loaded before all components to avoid duplication.
 */
const DomUtils = {
  /**
   * Escape HTML special characters to prevent XSS
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  /**
   * Split CamelCase into separate words: "TotalCycles" → "Total Cycles"
   */
  splitCamelCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1 $2');
  },

  /**
   * Format a column header with line breaks at word boundaries
   * Splits at CamelCase, underscores, and spaces
   */
  formatHeader(str) {
    return DomUtils.splitCamelCase(str).replace(/[_ ]/g, '<br>');
  },

  /**
   * Download a Blob as a file
   */
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
