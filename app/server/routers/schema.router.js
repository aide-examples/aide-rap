/**
 * Schema Router
 * Endpoints for schema management: check for changes, reload schema, data model diagrams
 */

const express = require('express');
const { getSchema, getSchemaHash, checkSchemaChanged, reloadSchema } = require('../config/database');

// Cache for generated Mermaid diagrams
const diagramCache = new Map();

/**
 * Clear diagram cache (call on schema reload)
 */
function clearDiagramCache() {
  diagramCache.clear();
}

/**
 * Extract entities referenced by a View (from column definitions)
 * Uses entityName stored during view parsing + back-reference detection
 * @param {string} viewName - View name
 * @param {Object} schema - Full schema
 * @returns {string[]} Array of entity names
 */
function extractViewEntities(viewName, schema) {
  const view = schema.userViews?.find(v => v.name === viewName);
  if (!view) return [];

  const entitySet = new Set([view.base]);

  for (const col of view.columns) {
    // Use stored entityName (added during view parsing)
    if (col.entityName && schema.entities[col.entityName]) {
      entitySet.add(col.entityName);
    }

    // Also check fkEntity for FK link columns
    if (col.fkEntity && schema.entities[col.fkEntity]) {
      entitySet.add(col.fkEntity);
    }

    // For back-references, extract the referencing entity from path
    // (entityName points to final entity in tail, but we need the back-ref entity too)
    if (col.path?.includes('<')) {
      const backRefMatch = col.path.match(/^(\w+)</);
      if (backRefMatch && schema.entities[backRefMatch[1]]) {
        entitySet.add(backRefMatch[1]);
      }
    }
  }

  return Array.from(entitySet);
}

/**
 * Extract entity neighborhood (1 hop: inbound refs + outbound FKs)
 * @param {string} entityName - Entity name
 * @param {Object} schema - Full schema
 * @returns {string[]} Array of entity names
 */
function extractEntityNeighborhood(entityName, schema) {
  const entitySet = new Set([entityName]);
  const entity = schema.entities[entityName];

  if (!entity) return [entityName];

  // Outbound: entities this one references via FK
  for (const fk of entity.foreignKeys || []) {
    if (fk.references?.entity) {
      entitySet.add(fk.references.entity);
    }
  }

  // Inbound: entities that reference this one
  const inbound = schema.inverseRelationships[entityName] || [];
  for (const ref of inbound) {
    entitySet.add(ref.entity);
  }

  return Array.from(entitySet);
}

/**
 * Generate Mermaid class diagram code
 * @param {string[]} entityNames - Entities to include
 * @param {Object} schema - Full schema
 * @returns {string} Mermaid classDiagram code
 */
function generateMermaidClassDiagram(entityNames, schema) {
  const lines = ['classDiagram'];
  const addedRels = new Set();

  // Class definitions with ALL attributes
  for (const name of entityNames) {
    const entity = schema.entities[name];
    if (!entity) continue;

    lines.push(`    class ${name} {`);

    // Collect aggregate sources and non-aggregate columns
    const aggregateSources = new Map();  // source → type
    const regularColumns = [];

    for (const col of entity.columns) {
      // Skip internal columns
      if (['id', 'created_at', 'updated_at', 'version'].includes(col.name)) continue;

      // Check if this is an aggregate field (e.g., address_street, geo_lat)
      if (col.aggregateSource && col.aggregateType) {
        if (!aggregateSources.has(col.aggregateSource)) {
          aggregateSources.set(col.aggregateSource, col.aggregateType);
        }
      } else {
        regularColumns.push(col);
      }
    }

    // Add regular columns
    for (const col of regularColumns) {
      // For FK columns, show the display name (without _id suffix)
      const colName = col.foreignKey ? (col.displayName || col.name) : col.name;

      // Mark columns with symbols (no type, just name with prefix)
      let prefix = '';
      if (col.ui?.label) prefix = '★ ';       // LABEL = primary identifier
      else if (col.ui?.label2) prefix = '☆ '; // LABEL2 = secondary identifier
      else if (col.foreignKey) prefix = '← '; // FK = reference (arrow pointing left)

      lines.push(`        ${prefix}${colName}`);
    }

    // Add collapsed aggregate columns (e.g., "address" instead of address_street, address_city, etc.)
    for (const [source, type] of aggregateSources) {
      lines.push(`        ${source}`);
    }

    lines.push(`    }`);
  }

  // Relationships between included entities only
  // Arrow direction: FROM entity with FK TO referenced entity (like Layout-Editor)
  // Line styles: --> solid (required), ..> dashed (optional), ~~> wavy (readonly)
  for (const rel of schema.relationships || []) {
    if (entityNames.includes(rel.from) && entityNames.includes(rel.to)) {
      const key = `${rel.from}-${rel.to}-${rel.column}`;
      if (!addedRels.has(key)) {
        addedRels.add(key);
        const label = rel.displayName || rel.column;

        // Get column info for line style
        const fromEntity = schema.entities[rel.from];
        const fkCol = fromEntity?.columns.find(c => c.name === rel.column);
        const isOptional = fkCol?.optional;
        const isReadonly = fkCol?.ui?.readonly;

        // Mermaid class diagram arrows:
        // --> solid with arrow (required FK)
        // ..> dashed with arrow (optional FK)
        // ..> dashed with arrow (readonly FK, marked in label)
        let arrow;
        let styledLabel = label;
        if (isReadonly) {
          arrow = '..>';
          styledLabel = `${label} [ro]`;
        } else if (isOptional) {
          arrow = '..>';
        } else {
          arrow = '-->';
        }

        lines.push(`    ${rel.from} ${arrow} ${rel.to} : ${styledLabel}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = function(cfg) {
  const router = express.Router();

  /**
   * GET /api/schema
   * Returns the current cached schema (for Layout-Editor)
   */
  router.get('/api/schema', (req, res) => {
    try {
      const schema = getSchema();
      res.json({
        areas: schema.areas,
        entities: schema.entities,
        relationships: schema.relationships,
        globalTypes: schema.globalTypes,
        enabledEntities: schema.enabledEntities
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schema/hash
   * Returns the current schema hash
   */
  router.get('/api/schema/hash', (req, res) => {
    try {
      const hash = getSchemaHash();
      res.json({ hash });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schema/check-changes
   * Compares current schema hash with freshly parsed markdown
   * Returns { changed: boolean, currentHash, freshHash }
   */
  router.get('/api/schema/check-changes', (req, res) => {
    try {
      const result = checkSchemaChanged();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/schema/reload
   * Reloads schema from markdown files (does NOT rebuild database tables)
   * Returns { success: boolean, hash: string, warning?: string }
   */
  router.post('/api/schema/reload', (req, res) => {
    try {
      const result = reloadSchema();
      // Clear diagram cache on schema reload
      clearDiagramCache();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schema/diagram/:type/:name
   * Generate Mermaid ER diagram for a View or Entity
   * @param type - 'view' or 'entity'
   * @param name - View name or Entity name
   * @returns { mermaid: string, entities: [{name, color}] }
   */
  router.get('/api/schema/diagram/:type/:name', (req, res) => {
    try {
      const { type, name } = req.params;
      const cacheKey = `${type}:${name}`;

      // Check cache first
      if (diagramCache.has(cacheKey)) {
        return res.json(diagramCache.get(cacheKey));
      }

      const schema = getSchema();
      let entityNames;

      if (type === 'view') {
        entityNames = extractViewEntities(name, schema);
      } else {
        entityNames = extractEntityNeighborhood(name, schema);
      }

      if (entityNames.length === 0) {
        return res.status(404).json({ error: `${type} "${name}" not found` });
      }

      const mermaidCode = generateMermaidClassDiagram(entityNames, schema);

      // Build entity info with Area colors
      const entities = entityNames.map(eName => {
        const entity = schema.entities[eName];
        const areaKey = entity?.area;
        const color = schema.areas[areaKey]?.color || null;
        return { name: eName, color };
      });

      const result = { mermaid: mermaidCode, entities };

      // Cache the result
      diagramCache.set(cacheKey, result);

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// Export cache clearer for external use (reinitialize, etc.)
module.exports.clearDiagramCache = clearDiagramCache;
