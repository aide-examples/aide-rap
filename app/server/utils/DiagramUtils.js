/**
 * DiagramUtils - Shared utilities for data model diagram generation
 * Used by layout-editor.router.js (SVG) and schema.router.js (Mermaid)
 */

/**
 * Columns hidden in diagram views (not relevant for data model visualization)
 */
const DIAGRAM_HIDDEN_COLUMNS = ['id', 'version', 'created_at', 'updated_at'];

/**
 * Filter and collapse columns for diagram display.
 * - Removes system columns (id, version, created_at, updated_at)
 * - Collapses aggregate fields (e.g., address_street, address_city → address)
 *
 * @param {Array} columns - Entity columns from schema
 * @returns {{ regularColumns: Array, aggregates: Map<string, string> }}
 *          regularColumns: non-aggregate, non-system columns
 *          aggregates: Map of aggregateSource → aggregateType
 */
function filterColumnsForDiagram(columns) {
    const aggregates = new Map();  // aggregateSource → aggregateType
    const regularColumns = [];

    for (const col of columns) {
        // Skip system columns
        if (DIAGRAM_HIDDEN_COLUMNS.includes(col.name)) continue;

        if (col.aggregateSource && col.aggregateType) {
            // Track aggregate source (only once per source)
            if (!aggregates.has(col.aggregateSource)) {
                aggregates.set(col.aggregateSource, col.aggregateType);
            }
        } else {
            regularColumns.push(col);
        }
    }

    return { regularColumns, aggregates };
}

module.exports = {
    DIAGRAM_HIDDEN_COLUMNS,
    filterColumnsForDiagram
};
