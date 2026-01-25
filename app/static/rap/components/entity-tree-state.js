/**
 * Entity Tree State Management
 * Handles node expansion state and selection
 */

class TreeState {
    constructor() {
        this.expandedNodes = new Set();
        this.selectedNodeId = null;
    }

    /**
     * Check if a node is expanded
     */
    isExpanded(nodeId) {
        return this.expandedNodes.has(nodeId);
    }

    /**
     * Expand a node
     */
    expand(nodeId) {
        this.expandedNodes.add(nodeId);
    }

    /**
     * Clear all expanded nodes and selection
     */
    clear() {
        this.expandedNodes.clear();
        this.selectedNodeId = null;
    }

    /**
     * Toggle node expansion with focused navigation
     * When closing a node, also close all child nodes (deeper levels)
     * @returns {boolean} true if node is now expanded
     */
    toggleNode(nodeId) {
        if (this.expandedNodes.has(nodeId)) {
            // Closing: Remove this node and all descendants
            this.closeNodeAndDescendants(nodeId);
            return false;
        } else {
            // Opening: Just add this node
            this.expandedNodes.add(nodeId);
            return true;
        }
    }

    /**
     * Close a node and all its descendants (child expansions)
     * Descendants are identified by tracking which nodes were expanded within this node's context
     */
    closeNodeAndDescendants(nodeId) {
        // Remove the node itself
        this.expandedNodes.delete(nodeId);

        // Find descendants based on node ID structure
        // FK nodes: fk-{Entity}-{targetId}-from-{parentRecordId}
        // Backref nodes: backref-{Entity}-to-{ParentEntity}-{parentRecordId}
        // Backref row nodes: backref-row-{Entity}-{recordId}-in-{ParentEntity}-{parentRecordId}

        // Parse the closed node to find its target entity-id pair
        let targetEntity = null;
        let targetId = null;

        if (nodeId.startsWith('fk-')) {
            // fk-Entity-ID-from-X → target is Entity-ID
            const match = nodeId.match(/^fk-([^-]+)-(\d+)-from-/);
            if (match) {
                targetEntity = match[1];
                targetId = match[2];
            }
        } else if (nodeId.startsWith('backref-row-')) {
            // backref-row-Entity-ID-in-X-Y → target is Entity-ID
            const match = nodeId.match(/^backref-row-([^-]+)-(\d+)-in-/);
            if (match) {
                targetEntity = match[1];
                targetId = match[2];
            }
        } else if (nodeId.match(/^[A-Z][a-zA-Z]+-\d+$/)) {
            // Root node: Entity-ID
            const match = nodeId.match(/^([A-Za-z]+)-(\d+)$/);
            if (match) {
                targetEntity = match[1];
                targetId = match[2];
            }
        }

        if (!targetEntity || !targetId) {
            return; // Can't determine descendants
        }

        // Close all nodes that were opened from within this entity-id context
        // These have "-from-{targetId}" or "-in-{Entity}-{targetId}" in their ID
        const toRemove = [];
        for (const id of this.expandedNodes) {
            // Check if this node was opened from the target record
            if (id.includes(`-from-${targetId}`) || id.includes(`-in-${targetEntity}-${targetId}`)) {
                toRemove.push(id);
            }
        }

        // Recursively find descendants of the removed nodes
        const allToRemove = new Set(toRemove);
        let changed = true;
        while (changed) {
            changed = false;
            for (const removedId of [...allToRemove]) {
                // Parse this removed node to find its target
                let childTarget = null;
                let childId = null;

                if (removedId.startsWith('fk-')) {
                    const match = removedId.match(/^fk-([^-]+)-(\d+)-from-/);
                    if (match) {
                        childTarget = match[1];
                        childId = match[2];
                    }
                } else if (removedId.startsWith('backref-row-')) {
                    const match = removedId.match(/^backref-row-([^-]+)-(\d+)-in-/);
                    if (match) {
                        childTarget = match[1];
                        childId = match[2];
                    }
                }

                if (childTarget && childId) {
                    for (const id of this.expandedNodes) {
                        if (!allToRemove.has(id)) {
                            if (id.includes(`-from-${childId}`) || id.includes(`-in-${childTarget}-${childId}`)) {
                                allToRemove.add(id);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }

        allToRemove.forEach(id => this.expandedNodes.delete(id));
    }

    /**
     * Select a node (toggle selection)
     * @returns {boolean} true if node is now selected, false if deselected
     */
    selectNode(nodeId) {
        if (this.selectedNodeId === nodeId) {
            this.selectedNodeId = null;
            return false;
        } else {
            this.selectedNodeId = nodeId;
            return true;
        }
    }

    /**
     * Get the currently selected node ID
     */
    getSelectedNodeId() {
        return this.selectedNodeId;
    }

    /**
     * Set selection without toggling
     */
    setSelection(nodeId) {
        this.selectedNodeId = nodeId;
    }

    /**
     * Clear selection only
     */
    clearSelection() {
        this.selectedNodeId = null;
    }
}

// Make available globally
window.TreeState = TreeState;
