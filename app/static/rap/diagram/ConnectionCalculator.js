/**
 * Connection calculation logic for diagram rendering.
 * Used by the layout editor (browser).
 */

(function() {
    // Get DiagramConstants from browser global (must be loaded first via <script> tag)
    const DiagramConstants = window.DiagramConstants;

    const ConnectionCalculator = {
        /**
         * Calculate ray-box intersection.
         * Returns the point where a ray from (x1,y1) to (x2,y2) intersects a box.
         */
        rayBoxIntersection(x1, y1, x2, y2, boxX, boxY, boxW, boxH) {
            const edges = [
                { x1: boxX, y1: boxY, x2: boxX + boxW, y2: boxY },                 // top
                { x1: boxX, y1: boxY + boxH, x2: boxX + boxW, y2: boxY + boxH },   // bottom
                { x1: boxX, y1: boxY, x2: boxX, y2: boxY + boxH },                 // left
                { x1: boxX + boxW, y1: boxY, x2: boxX + boxW, y2: boxY + boxH }    // right
            ];

            let closestPoint = null;
            let minDist = Infinity;

            for (const edge of edges) {
                const denom = (x1 - x2) * (edge.y1 - edge.y2) - (y1 - y2) * (edge.x1 - edge.x2);
                if (Math.abs(denom) < 0.0001) continue;

                const t = ((x1 - edge.x1) * (edge.y1 - edge.y2) - (y1 - edge.y1) * (edge.x1 - edge.x2)) / denom;
                const u = -((x1 - x2) * (y1 - edge.y1) - (y1 - y2) * (x1 - edge.x1)) / denom;

                if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                    const ix = x1 + t * (x2 - x1);
                    const iy = y1 + t * (y2 - y1);
                    const dist = Math.hypot(ix - x1, iy - y1);
                    if (dist < minDist) {
                        minDist = dist;
                        closestPoint = { x: ix, y: iy };
                    }
                }
            }

            return closestPoint || { x: x2, y: y2 };
        },

        /**
         * Get connection points for a relationship between two entities.
         * @param {Object} fromPos - Source position {x, y}
         * @param {Object} toPos - Target position {x, y}
         * @param {number} fromHeight - Source box height
         * @param {number} toHeight - Target box height
         * @param {number} attrIndex - Attribute index for connection point
         * @param {boolean} showDetailed - Whether detailed view is shown
         * @param {number} fromWidth - Source box width (optional, defaults to BOX_WIDTH)
         * @param {number} toWidth - Target box width (optional, defaults to BOX_WIDTH)
         */
        getConnectionPoint(fromPos, toPos, fromHeight, toHeight, attrIndex, showDetailed, fromWidth, toWidth) {
            const { BOX_WIDTH, HEADER_HEIGHT, ATTR_LINE_HEIGHT } = DiagramConstants;

            // Use provided widths or fall back to default
            const actualFromWidth = fromWidth || BOX_WIDTH;
            const actualToWidth = toWidth || BOX_WIDTH;

            const toCx = toPos.x + actualToWidth / 2;
            const toCy = toPos.y + toHeight / 2;

            // Source Y: attribute row in detailed mode, or box center
            let fromY;
            if (showDetailed && attrIndex >= 0) {
                fromY = fromPos.y + HEADER_HEIGHT + (attrIndex + 0.5) * ATTR_LINE_HEIGHT + 2;
            } else {
                fromY = fromPos.y + fromHeight / 2;
            }

            // Source X: left or right edge depending on target position
            let fromX = toCx > fromPos.x + actualFromWidth / 2
                ? fromPos.x + actualFromWidth
                : fromPos.x;

            // Calculate intersection with target box
            const intersection = this.rayBoxIntersection(
                fromX, fromY, toCx, toCy,
                toPos.x, toPos.y, actualToWidth, toHeight
            );

            // Direction: away from source box (right edge = +1, left edge = -1)
            const direction = (fromX === fromPos.x + actualFromWidth) ? 1 : -1;

            return { fromX, fromY, toX: intersection.x, toY: intersection.y, direction };
        },

        /**
         * Calculate self-reference arc geometry.
         * @param {Object} pos - Entity position {x, y}
         * @param {number} boxWidth - Box width (optional, defaults to BOX_WIDTH)
         */
        getSelfReferenceArc(pos, boxWidth) {
            const { BOX_WIDTH, HEADER_HEIGHT, ATTR_LINE_HEIGHT, MIN_LOOP_RADIUS } = DiagramConstants;

            const actualWidth = boxWidth || BOX_WIDTH;
            const startX = pos.x + actualWidth;
            const startY = pos.y + HEADER_HEIGHT + 0.5 * ATTR_LINE_HEIGHT + 2;
            const endX = startX;
            const endY = pos.y + HEADER_HEIGHT / 2;

            const vertDist = startY - endY;
            const radius = Math.max(vertDist / 2 + 10, MIN_LOOP_RADIUS);

            return { startX, startY, endX, endY, radius };
        },

        /**
         * Generate SVG path for a normal connection line.
         */
        getNormalConnectionPath(conn) {
            const { STUB_LENGTH } = DiagramConstants;
            const stubX = conn.fromX + conn.direction * STUB_LENGTH;
            return `M ${conn.fromX} ${conn.fromY} L ${stubX} ${conn.fromY} L ${conn.toX} ${conn.toY}`;
        },

        /**
         * Generate SVG path for a self-reference arc.
         */
        getSelfReferenceArcPath(arc) {
            return `M ${arc.startX} ${arc.startY} A ${arc.radius} ${arc.radius} 0 1 0 ${arc.endX} ${arc.endY}`;
        },

        /**
         * Get label position for a normal connection.
         */
        getNormalLabelPosition(conn) {
            const { STUB_LENGTH } = DiagramConstants;
            const stubX = conn.fromX + conn.direction * STUB_LENGTH;
            return {
                x: (stubX + conn.toX) / 2,
                y: (conn.fromY + conn.toY) / 2 - 5
            };
        },

        /**
         * Get label position for a self-reference arc.
         */
        getSelfReferenceLabelPosition(arc) {
            return {
                x: arc.startX + arc.radius + 5,
                y: (arc.startY + arc.endY) / 2
            };
        },

        /**
         * Get visible attributes, sorted with self-references first.
         */
        getVisibleAttributes(attributes, className) {
            const attrs = (attributes || []).filter(a => a.name !== 'id');
            return attrs.slice().sort((a, b) => {
                const aType = (a.type || '').replace(/\s*\[[^\]]+\]/g, '').trim();
                const bType = (b.type || '').replace(/\s*\[[^\]]+\]/g, '').trim();
                const aIsSelf = aType === className;
                const bIsSelf = bType === className;
                if (aIsSelf && !bIsSelf) return -1;
                if (!aIsSelf && bIsSelf) return 1;
                return 0;
            });
        },

        /**
         * Extract base type from a type string (removes annotations like [DEFAULT=...]).
         */
        extractBaseType(typeStr) {
            return (typeStr || '').replace(/\s*\[[^\]]+\]/g, '').trim();
        }
    };

    // Export as browser global
    window.ConnectionCalculator = ConnectionCalculator;
})();
