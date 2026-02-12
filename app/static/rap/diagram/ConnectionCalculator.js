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
         * Connection always originates at the attribute row (same in compact and detailed mode).
         * @param {Object} fromPos - Source position {x, y}
         * @param {Object} toPos - Target position {x, y}
         * @param {number} fromHeight - Source box height
         * @param {number} toHeight - Target box height
         * @param {number} attrIndex - Attribute index for connection point
         * @param {boolean} showDetailed - Unused, kept for API compatibility
         * @param {number} fromWidth - Source box width (optional, defaults to BOX_WIDTH)
         * @param {number} toWidth - Target box width (optional, defaults to BOX_WIDTH)
         */
        getConnectionPoint(fromPos, toPos, fromHeight, toHeight, attrIndex, showDetailed, fromWidth, toWidth) {
            const { BOX_WIDTH, HEADER_HEIGHT, ATTR_LINE_HEIGHT, BOX_PADDING, STUB_LENGTH } = DiagramConstants;

            // Use provided widths or fall back to default
            const actualFromWidth = fromWidth || BOX_WIDTH;
            const actualToWidth = toWidth || BOX_WIDTH;

            const toCx = toPos.x + actualToWidth / 2;
            const toCy = toPos.y + toHeight / 2;

            // Source Y: attribute row center (BOX_PADDING/2 accounts for .attributes top padding)
            const fromY = fromPos.y + HEADER_HEIGHT + BOX_PADDING / 2 + (attrIndex + 0.5) * ATTR_LINE_HEIGHT;

            // Source X: left or right edge depending on target position
            let fromX = toCx > fromPos.x + actualFromWidth / 2
                ? fromPos.x + actualFromWidth
                : fromPos.x;

            // Direction: away from source box (right edge = +1, left edge = -1)
            const direction = (fromX === fromPos.x + actualFromWidth) ? 1 : -1;

            // Ray starts from stub end (where the visible line to target begins)
            const stubX = fromX + direction * STUB_LENGTH;
            const intersection = this.rayBoxIntersection(
                stubX, fromY, toCx, toCy,
                toPos.x, toPos.y, actualToWidth, toHeight
            );

            return { fromX, fromY, toX: intersection.x, toY: intersection.y, direction };
        },

        /**
         * Calculate self-reference semicircle geometry.
         * Arc originates at the attribute row that creates the self-reference.
         * @param {Object} pos - Entity position {x, y}
         * @param {number} boxWidth - Box width (optional, defaults to BOX_WIDTH)
         * @param {number} boxHeight - Box height (unused, kept for compatibility)
         * @param {number} attrIndex - Index of the self-referencing attribute (0-based)
         */
        getSelfReferenceArc(pos, boxWidth, boxHeight, attrIndex = 0) {
            const { BOX_WIDTH, HEADER_HEIGHT, ATTR_LINE_HEIGHT, BOX_PADDING } = DiagramConstants;

            const actualWidth = boxWidth || BOX_WIDTH;
            const startX = pos.x + actualWidth;
            const endX = startX;
            const endY = pos.y;

            // Start at the specific attribute row (center of the row)
            const startY = pos.y + HEADER_HEIGHT + BOX_PADDING / 2 + (attrIndex + 0.5) * ATTR_LINE_HEIGHT;

            const vertDist = startY - endY;
            const radius = vertDist / 2;

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
            return `M ${arc.startX} ${arc.startY} A ${arc.radius} ${arc.radius} 0 0 0 ${arc.endX} ${arc.endY}`;
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
         * Get visible attributes, reordered to minimize FK line crossings.
         * When a layout context is provided, FK attributes are placed at slots
         * closest to the target entity's center Y — producing horizontal lines
         * where possible and pushing FKs to edges otherwise, leaving the middle
         * free for incoming connections.
         * Note: System columns and aggregate collapsing are handled server-side
         * in layout-editor.router.js schemaToModel().
         * @param {Array} attributes
         * @param {string} className - Current entity name (for self-ref detection)
         * @param {Object} [context] - Layout context for position-aware ordering:
         *   { positions, entityCenterYs, headerHeight, attrLineHeight }
         */
        getVisibleAttributes(attributes, className, context) {
            const attrs = attributes || [];

            // Without context: simple sort (self-refs first, rest stable)
            if (!context || !context.positions) {
                return attrs.slice().sort((a, b) => {
                    const aIsSelf = this.extractBaseType(a.type) === className;
                    const bIsSelf = this.extractBaseType(b.type) === className;
                    if (aIsSelf && !bIsSelf) return -1;
                    if (!aIsSelf && bIsSelf) return 1;
                    return 0;
                });
            }

            const { positions, entityCenterYs, headerHeight, attrLineHeight } = context;
            const sourceY = (positions[className] || { y: 0 }).y;

            // Categorize attributes
            const selfRefs = [];
            const fks = [];
            const nonFKs = [];

            for (const attr of attrs) {
                const baseType = this.extractBaseType(attr.type);
                if (baseType === className) {
                    selfRefs.push(attr);
                } else if (positions[baseType] && entityCenterYs[baseType] !== undefined) {
                    // Ideal slot: where this attr's y equals target center y
                    const idealSlot = (entityCenterYs[baseType] - sourceY - headerHeight) / attrLineHeight - 0.5;
                    fks.push({ attr, idealSlot });
                } else {
                    nonFKs.push(attr);
                }
            }

            const totalSlots = attrs.length;
            const result = new Array(totalSlots);

            // Tier 1: Self-refs at top
            for (let i = 0; i < selfRefs.length; i++) {
                result[i] = selfRefs[i];
            }

            // Available slot indices for FKs and non-FKs
            const availSlots = [];
            for (let s = selfRefs.length; s < totalSlots; s++) {
                availSlots.push(s);
            }

            // Tier 2: Place FKs at slots closest to target center Y
            // Sorted by idealSlot to prevent crossings; each FK's search range
            // is bounded to leave room for remaining FKs
            fks.sort((a, b) => a.idealSlot - b.idealSlot);
            const fkIndices = new Set();
            let startIdx = 0;

            for (let k = 0; k < fks.length; k++) {
                const maxIdx = availSlots.length - (fks.length - k);
                const ideal = Math.round(fks[k].idealSlot);

                let bestIdx = startIdx;
                let bestDist = Math.abs(availSlots[startIdx] - ideal);

                for (let i = startIdx + 1; i <= maxIdx; i++) {
                    const dist = Math.abs(availSlots[i] - ideal);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = i;
                    } else if (dist > bestDist) {
                        break; // Past optimum (slots are sorted ascending)
                    }
                }

                result[availSlots[bestIdx]] = fks[k].attr;
                fkIndices.add(bestIdx);
                startIdx = bestIdx + 1;
            }

            // Tier 3: Non-FKs fill remaining slots in original order
            let nfIdx = 0;
            for (let i = 0; i < availSlots.length; i++) {
                if (!fkIndices.has(i) && nfIdx < nonFKs.length) {
                    result[availSlots[i]] = nonFKs[nfIdx++];
                }
            }

            return result;
        },

        /**
         * Extract base type from a type string (removes annotations like [DEFAULT=...]).
         */
        extractBaseType(typeStr) {
            return (typeStr || '').replace(/\s*\[[^\]]+\]/g, '').trim();
        },

        /**
         * Built-in aggregate types (structured types with multiple DB columns).
         */
        AGGREGATE_TYPES: ['geo', 'address', 'contact'],

        /**
         * Check if a type is a built-in aggregate type.
         */
        isAggregateType(typeStr) {
            const baseType = this.extractBaseType(typeStr);
            return this.AGGREGATE_TYPES.includes(baseType);
        },

        /**
         * Format attribute for display.
         * - FK to entity: just the name
         * - Aggregate type: «name»
         * - Regular: name: type
         */
        formatAttribute(attr, entityNames) {
            const cleanType = this.extractBaseType(attr.type);
            if (entityNames.includes(cleanType)) {
                return attr.name;  // FK reference
            }
            if (this.isAggregateType(cleanType)) {
                return `«${attr.name}»`;  // Structured type with guillemets
            }
            return `${attr.name}: ${cleanType}`;  // Regular attribute
        }
    };

    // Export as browser global
    window.ConnectionCalculator = ConnectionCalculator;
})();
