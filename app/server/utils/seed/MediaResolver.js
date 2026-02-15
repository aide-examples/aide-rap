/**
 * MediaResolver - Media URL resolution and aggregate type flattening
 *
 * LOCALITY: This module has NO imports of singletons (database.js, EventBus).
 * All DB/schema/path dependencies are received as explicit parameters.
 */

/**
 * Check if a string is a valid URL
 * @param {string} str - String to check
 * @returns {boolean}
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract URL from a markdown link [text](url) or return the string if it's a plain URL
 * @param {string} str - String to check (may be markdown link or plain URL)
 * @returns {string|null} - The URL or null if not a valid URL
 */
function extractUrl(str) {
  if (!str || typeof str !== 'string') return null;

  // Check for markdown link [text](url)
  const mdMatch = str.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
  if (mdMatch) {
    const url = mdMatch[2];
    return isValidUrl(url) ? url : null;
  }

  // Plain URL
  return isValidUrl(str) ? str : null;
}

/**
 * Resolve media URLs in a record.
 * For each media-type field, if the value is a URL, fetch it via MediaService
 * and replace with the resulting media UUID.
 *
 * @param {object} entity - Entity schema object
 * @param {object} record - Record to process
 * @param {object} mediaService - MediaService instance (or null)
 * @returns {Promise<{record: Object, mediaErrors: Array}>}
 */
async function resolveMediaUrls(entity, record, mediaService) {
  const mediaErrors = [];

  if (!mediaService) {
    return { record, mediaErrors };
  }

  if (!entity) return { record, mediaErrors };

  const resolved = { ...record };

  // Find media-type columns
  const mediaColumns = entity.columns.filter(c => c.customType === 'media');

  for (const col of mediaColumns) {
    const value = record[col.name];

    // Extract URL (handles both plain URLs and markdown links [text](url))
    const url = extractUrl(value);

    // Check if value is a URL (not already a UUID)
    if (url) {
      try {
        // Pass media constraints from schema (e.g., maxWidth, maxHeight from [DIMENSION=800x600])
        const constraints = col.media || null;
        const result = await mediaService.uploadFromUrl(url, 'seed', constraints);
        resolved[col.name] = result.id;
      } catch (err) {
        // Track the error for client feedback
        mediaErrors.push({
          field: col.name,
          url: url.length > 80 ? url.substring(0, 80) + '...' : url,
          error: err.message
        });
        // Set field to null (validation will fail later, or it might be optional)
        resolved[col.name] = null;
      }
    }
  }

  return { record: resolved, mediaErrors };
}

/**
 * Flatten nested aggregate type values in a record.
 * Converts { position: { latitude: 48.1, longitude: 11.5 } }
 * to { position_latitude: 48.1, position_longitude: 11.5 }
 *
 * @param {object} entity - Entity schema object
 * @param {object} record - Record to process
 * @param {object} typeRegistry - TypeRegistry instance
 * @returns {Object} - Record with flattened aggregate values
 */
function flattenAggregates(entity, record, typeRegistry) {
  if (!entity) return record;

  const flattened = { ...record };

  // Find aggregate columns by looking for aggregateSource metadata
  const aggregateSources = new Set();
  for (const col of entity.columns) {
    if (col.aggregateSource) {
      aggregateSources.add(col.aggregateSource);
    }
  }

  // For each aggregate source, check if record has nested value
  for (const sourceName of aggregateSources) {
    const nestedValue = record[sourceName];

    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      // Find the aggregate type from schema columns
      const aggregateCol = entity.columns.find(c => c.aggregateSource === sourceName);
      if (aggregateCol && aggregateCol.aggregateType) {
        const fields = typeRegistry.getAggregateFields(aggregateCol.aggregateType);

        if (fields) {
          // Flatten nested object to prefixed fields
          for (const field of fields) {
            const flatKey = `${sourceName}_${field.name}`;
            if (nestedValue[field.name] !== undefined) {
              flattened[flatKey] = nestedValue[field.name];
            }
          }
          // Remove the nested key
          delete flattened[sourceName];
        }
      }
    }
  }

  return flattened;
}

module.exports = {
  isValidUrl,
  extractUrl,
  resolveMediaUrls,
  flattenAggregates
};
