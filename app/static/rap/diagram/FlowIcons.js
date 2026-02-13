/**
 * Flow Icons for System Landscape diagrams.
 * Provides SVG path data for format and transport icons.
 * Used by the layout editor (browser).
 */

(function() {
    // All icons use a 16x16 viewBox for consistent sizing
    const ICON_SIZE = 16;

    // Icon definitions: keyword → { path, title }
    // Paths are designed for a 16×16 coordinate space
    const ICONS = {
        // --- Format icons ---
        'JSON': {
            path: 'M3 2 L1 2 L1 6 L0 8 L1 10 L1 14 L3 14 M7 7 L7 9 M9 7 L9 9 M13 2 L15 2 L15 6 L16 8 L15 10 L15 14 L13 14',
            title: 'JSON',
            fill: 'none',
            stroke: true
        },
        'XML': {
            path: 'M4 4 L0 8 L4 12 M6 6 L6 10 M8 6 L8 10 M10 6 L10 10 M12 4 L16 8 L12 12',
            title: 'XML',
            fill: 'none',
            stroke: true
        },
        'XLSX': {
            path: 'M2 1 L2 15 L14 15 L14 1 Z M2 5 L14 5 M2 8 L14 8 M2 11 L14 11 M8 1 L8 15',
            title: 'XLSX',
            fill: 'none',
            stroke: true
        },
        'CSV': {
            path: 'M1 3 L1 13 L15 13 L15 3 Z M1 7 L15 7 M1 10 L15 10 M6 3 L6 13 M11 3 L11 13',
            title: 'CSV',
            fill: 'none',
            stroke: true
        },
        'PDF': {
            path: 'M2 1 L2 15 L14 15 L14 4 L11 1 Z M11 1 L11 4 L14 4 M5 8 L5 12 M5 8 L8 8 C9.5 8 9.5 10 8 10 L5 10',
            title: 'PDF',
            fill: 'none',
            stroke: true
        },
        'DOCX': {
            path: 'M2 1 L2 15 L14 15 L14 4 L11 1 Z M11 1 L11 4 L14 4 M5 8 L6.5 12 L8 9 L9.5 12 L11 8',
            title: 'DOCX',
            fill: 'none',
            stroke: true
        },

        // --- Transport icons ---
        // Perspective: always the data owner (the system defining the flow).
        // Our initiative:  MAIL, API-SEND, UPLOAD — we push data to the receiver.
        // Their initiative: API-RESPONSE, DOWNLOAD — receiver requests, we deliver.
        'MAIL': {
            path: 'M1 3 L1 13 L15 13 L15 3 Z M1 3 L8 9 L15 3',
            title: 'Mail',
            fill: 'none',
            stroke: true
        },
        'API-RESPONSE': {
            path: 'M8 2 L8 14 M4 10 L8 14 L12 10 M2 2 L14 2',
            title: 'API Response',
            fill: 'none',
            stroke: true
        },
        'API-SEND': {
            path: 'M8 14 L8 2 M4 6 L8 2 L12 6 M2 14 L14 14',
            title: 'API Send',
            fill: 'none',
            stroke: true
        },
        'DOWNLOAD': {
            path: 'M8 6 L8 14 M4 10 L8 14 L12 10 M2 2 L14 2 L14 6 L2 6 Z',
            title: 'Download',
            fill: 'none',
            stroke: true
        },
        'UPLOAD': {
            path: 'M8 10 L8 2 M4 6 L8 2 L12 6 M2 14 L14 14 L14 10 L2 10 Z',
            title: 'Upload',
            fill: 'none',
            stroke: true
        }
    };

    const FlowIcons = {
        ICON_SIZE,

        /**
         * Look up an icon by keyword (case-insensitive).
         * @param {string} keyword
         * @returns {{ path: string, title: string, fill: string, stroke: boolean } | null}
         */
        get(keyword) {
            if (!keyword) return null;
            return ICONS[keyword.toUpperCase().trim()] || null;
        },

        /**
         * Create an inline SVG element for use in the DOM (interactive canvas).
         * @param {string} keyword
         * @param {number} [size=12] - Display size in pixels
         * @returns {SVGElement|null}
         */
        createSVGElement(keyword, size = 12) {
            const icon = this.get(keyword);
            if (!icon) return null;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', size);
            svg.setAttribute('height', size);
            svg.setAttribute('viewBox', `0 0 ${ICON_SIZE} ${ICON_SIZE}`);
            svg.style.verticalAlign = 'middle';
            svg.style.flexShrink = '0';

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = icon.title;
            svg.appendChild(title);

            const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('d', icon.path);
            pathEl.setAttribute('fill', icon.fill === 'none' ? 'none' : '#555');
            if (icon.stroke) {
                pathEl.setAttribute('stroke', '#555');
                pathEl.setAttribute('stroke-width', '1.5');
                pathEl.setAttribute('stroke-linecap', 'round');
                pathEl.setAttribute('stroke-linejoin', 'round');
            }
            svg.appendChild(pathEl);

            return svg;
        },

        /**
         * Generate SVG markup string for embedding in exported SVG.
         * @param {string} keyword
         * @param {number} x - X position
         * @param {number} y - Y position (top of icon)
         * @param {number} [size=12] - Display size
         * @returns {string} SVG group markup or empty string
         */
        toSVGMarkup(keyword, x, y, size = 12) {
            const icon = this.get(keyword);
            if (!icon) return '';

            const scale = size / ICON_SIZE;
            const strokeAttrs = icon.stroke
                ? ` stroke="#555" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`
                : '';
            const fillAttr = icon.fill === 'none' ? 'none' : '#555';

            return `<g transform="translate(${x},${y}) scale(${scale})">` +
                   `<title>${icon.title}</title>` +
                   `<path d="${icon.path}" fill="${fillAttr}"${strokeAttrs}/>` +
                   `</g>`;
        }
    };

    // Export as browser global
    window.FlowIcons = FlowIcons;
})();
