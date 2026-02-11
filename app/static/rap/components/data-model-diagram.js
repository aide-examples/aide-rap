/**
 * DataModelDiagram - Data Model Diagram Dialog
 * Shows Mermaid ER diagram for Views or Entities
 * - View: All entities from column paths
 * - Entity: Inbound refs + Outbound FKs
 * Entities colored by Area of Competence
 */
const DataModelDiagram = {
    cache: new Map(),  // Client-side cache: "view:Name" or "entity:Name" → {mermaidCode, entities}

    /**
     * Initialize Mermaid
     */
    init() {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                er: {
                    diagramPadding: 20,
                    layoutDirection: 'TB',
                    minEntityWidth: 100,
                    minEntityHeight: 75,
                    entityPadding: 15,
                    useMaxWidth: true
                }
            });
        }
    },

    /**
     * Open diagram for current View or Entity
     * @param {string} type - 'view' or 'entity'
     * @param {string} name - View or Entity name
     */
    async open(type, name) {
        const cacheKey = `${type}:${name}`;

        let mermaidCode, entities;

        // Check client-side cache first
        if (this.cache.has(cacheKey)) {
            ({ mermaidCode, entities } = this.cache.get(cacheKey));
        } else {
            // Fetch from server (cached there too)
            try {
                const result = await ApiClient.request(`api/schema/diagram/${type}/${encodeURIComponent(name)}`);
                mermaidCode = result.mermaid;
                entities = result.entities;
                this.cache.set(cacheKey, { mermaidCode, entities });
            } catch (e) {
                console.error('Failed to generate diagram:', e);
                DomUtils.showMessage(document.body, 'Failed to generate diagram', true);
                return;
            }
        }

        await this.render(name, type, mermaidCode, entities);
    },

    /**
     * Render the modal with Mermaid diagram
     */
    async render(name, type, mermaidCode, entities) {
        const title = type === 'view' ? `View: ${name}` : `Entity: ${name}`;
        const container = document.getElementById('modal-container');

        container.innerHTML = `
            <div class="modal-overlay diagram-overlay">
                <div class="modal-dialog diagram-dialog">
                    <div class="modal-header">
                        <h2>${DomUtils.escapeHtml(title)}</h2>
                        <button class="modal-close" data-action="close">&times;</button>
                    </div>
                    <div class="modal-body diagram-body">
                        <div id="diagram-render" class="diagram-container">
                            <div class="diagram-loading">Rendering diagram...</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <span class="diagram-info">${entities.length} entities</span>
                        <button class="btn-seed" data-action="copy">Copy Mermaid</button>
                        <button class="btn-seed primary" data-action="close">Close</button>
                    </div>
                </div>
            </div>
        `;
        container.classList.add('active');

        // Event handlers
        const closeBtn = container.querySelector('[data-action="close"]');
        const copyBtn = container.querySelector('[data-action="copy"]');
        const overlay = container.querySelector('.diagram-overlay');

        closeBtn.onclick = () => this.close();
        overlay.onclick = (e) => {
            if (e.target.classList.contains('diagram-overlay')) this.close();
        };
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(mermaidCode).then(() => {
                DomUtils.showMessage(container, 'Mermaid code copied to clipboard');
            });
        };

        // Render Mermaid diagram
        try {
            // Generate unique ID to avoid conflicts
            const diagramId = 'diagram-' + Date.now();
            const { svg } = await mermaid.render(diagramId, mermaidCode);
            container.querySelector('#diagram-render').innerHTML = svg;
            this.applyAreaColors(container, entities);
        } catch (e) {
            console.error('Mermaid render error:', e);
            container.querySelector('#diagram-render').innerHTML =
                `<div class="diagram-error">Failed to render diagram: ${DomUtils.escapeHtml(e.message)}</div>`;
        }
    },

    /**
     * Apply Area of Competence colors to SVG entity boxes
     */
    applyAreaColors(container, entityInfos) {
        const svg = container.querySelector('svg');
        if (!svg) return;

        for (const info of entityInfos) {
            if (!info.color) continue;

            // Find entity group in SVG by matching text content
            const texts = svg.querySelectorAll('text');
            for (const text of texts) {
                if (text.textContent.trim() === info.name) {
                    const group = text.closest('g');
                    const rect = group?.querySelector('rect');
                    if (rect) {
                        rect.style.fill = info.color + '30';  // Add transparency
                        rect.style.stroke = info.color;
                        rect.style.strokeWidth = '2';
                    }
                    break;
                }
            }
        }
    },

    /**
     * Close the modal
     */
    close() {
        const container = document.getElementById('modal-container');
        container.innerHTML = '';
        container.classList.remove('active');
    },

    /**
     * Clear the cache (call on schema reload)
     */
    clearCache() {
        this.cache.clear();
    }
};
