/**
 * Constants for diagram rendering.
 * Used by the layout editor (browser).
 */

(function() {
    const DiagramConstants = {
        // Box dimensions
        BOX_WIDTH: 140,
        BOX_HEIGHT_COMPACT: 30,
        ATTR_LINE_HEIGHT: 16,
        BOX_PADDING: 8,
        HEADER_HEIGHT: 24,

        // Line drawing
        STUB_LENGTH: 25,
        MIN_LOOP_RADIUS: 25,

        // Styling
        STROKE_COLOR: '#333',
        STROKE_WIDTH: 1.5,
        FONT_FAMILY: 'Arial, sans-serif',
        FONT_SIZE_CLASS: 12,
        FONT_SIZE_ATTR: 10,
        FONT_SIZE_LABEL: 9,

        // Optional relationship styling
        OPTIONAL_DASH: '6,3'
    };

    // Export as browser global
    window.DiagramConstants = DiagramConstants;
})();
