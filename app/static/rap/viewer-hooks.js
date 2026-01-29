/**
 * Viewer content hook for AIDE RAP.
 *
 * Linkifies references in attribute table cells at display time,
 * keeping source markdown files clean.
 *
 * Three kinds of references are resolved:
 *   1. Entity names   (e.g., "AircraftType")  → link to entity doc
 *   2. Internal types  (e.g., "MaintenanceCategory") → anchor in current page
 *   3. External types  (e.g., "TailSign")     → anchor in Types.md
 */
(function() {
    let externalTypes = null;       // [{name, anchor}] from Types.md headings
    let externalTypesPromise = null;
    let typesDocPath = null;        // path to Types.md (or false if not found)

    /**
     * Generate a heading slug matching the viewer's TOC algorithm.
     */
    function toSlug(text) {
        return text.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Replace a <td>'s text content with a clickable link + remaining text.
     */
    function linkify(td, fullText, matchName, href, onClick) {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = matchName;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            onClick();
        });
        const rest = fullText.substring(matchName.length);
        td.textContent = '';
        td.appendChild(link);
        if (rest) td.appendChild(document.createTextNode(rest));
    }

    /**
     * Scroll to a heading by ID, accounting for the sticky header.
     */
    function scrollToAnchor(anchor) {
        const el = document.getElementById(anchor);
        if (el) {
            const headerHeight = 70;
            const top = el.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({ top: top - headerHeight, behavior: 'smooth' });
        }
    }

    // -------------------------------------------------------------------------

    window.viewerContentHook = async function(container, context) {
        const { docPath, viewerRoot, docNames } = context;
        if (!docNames || docNames.length === 0) return;

        const currentName = docPath
            ? docPath.replace('.md', '').split('/').pop()
            : null;

        // --- Fetch external type headings from Types.md (once) ---------------
        if (typesDocPath === null) {
            const typesEntry = docNames.find(d => d.name === 'Types');
            typesDocPath = typesEntry ? typesEntry.path : false;
            if (typesDocPath) {
                externalTypesPromise = fetch(
                    `/api/viewer/content?root=${viewerRoot}&path=${encodeURIComponent(typesDocPath)}`
                )
                .then(res => res.json())
                .then(data => {
                    externalTypes = [];
                    if (data.content) {
                        for (const line of data.content.split('\n')) {
                            const m = line.match(/^### (.+)$/);
                            if (m) {
                                externalTypes.push({
                                    name: m[1].trim(),
                                    anchor: toSlug(m[1].trim())
                                });
                            }
                        }
                    }
                })
                .catch(() => { externalTypes = []; });
            }
        }
        if (externalTypesPromise && externalTypes === null) {
            await externalTypesPromise;
        }

        // --- Collect internal types (### headings under ## Types) -------------
        const internalTypes = [];
        let inTypesSection = false;
        for (const h of container.querySelectorAll('h2, h3')) {
            if (h.tagName === 'H2') {
                inTypesSection = h.textContent.trim() === 'Types';
                continue;
            }
            if (inTypesSection && h.tagName === 'H3') {
                const name = h.textContent.trim();
                let anchor = h.id;
                if (!anchor) {
                    anchor = toSlug(name);
                    h.id = anchor;
                }
                internalTypes.push({ name, anchor });
            }
        }

        // --- Linkify table cells and list items (priority: entity > internal type > external type)
        const isTypesDoc = docPath === typesDocPath;

        function processElement(el) {
            if (el.querySelector('a')) return;
            const text = el.textContent.trim();
            if (!text || text.length < 2) return;

            // 1. Entity name → link to entity documentation page
            for (const { name, path } of docNames) {
                if (name === currentName) continue;
                if (text === name || text.startsWith(name + ' ')) {
                    linkify(el, el.textContent, name, '?doc=' + path,
                        () => loadDoc(path));
                    return;
                }
            }

            // 2. Internal type → anchor in current page
            for (const { name, anchor } of internalTypes) {
                if (text === name || text.startsWith(name + ' ')) {
                    linkify(el, el.textContent, name, '#' + anchor,
                        () => scrollToAnchor(anchor));
                    return;
                }
            }

            // 3. External type → heading in Types.md
            if (externalTypes && typesDocPath) {
                for (const { name, anchor } of externalTypes) {
                    if (text === name || text.startsWith(name + ' ')) {
                        if (isTypesDoc) {
                            linkify(el, el.textContent, name, '#' + anchor,
                                () => scrollToAnchor(anchor));
                        } else {
                            linkify(el, el.textContent, name,
                                '?doc=' + typesDocPath + '#' + anchor,
                                () => loadDoc(typesDocPath, '#' + anchor));
                        }
                        return;
                    }
                }
            }
        }

        // Process table cells
        container.querySelectorAll('td').forEach(processElement);

        // Process list items (for entity lists in Crud.md etc.)
        container.querySelectorAll('li').forEach(processElement);
    };
})();
