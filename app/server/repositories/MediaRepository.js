/**
 * MediaRepository - Database operations for _media and _media_refs tables
 *
 * Handles:
 * - CRUD operations for media metadata
 * - Reference tracking (which entities use which media)
 * - Orphan detection for cleanup
 */

const { getDatabase } = require('../config/database');

/**
 * Create a new media record
 * @param {Object} metadata - Media metadata
 * @param {string} metadata.id - UUID
 * @param {string} metadata.originalName - Original filename
 * @param {string} metadata.mimeType - MIME type
 * @param {number} metadata.size - File size in bytes
 * @param {string} [metadata.extension] - File extension
 * @param {number} [metadata.width] - Image width
 * @param {number} [metadata.height] - Image height
 * @param {boolean} [metadata.hasThumbnail] - Whether thumbnail exists
 * @param {string} [metadata.uploadedBy] - Username of uploader
 * @returns {Object} Created record
 */
function create(metadata) {
  const db = getDatabase();

  const sql = `
    INSERT INTO _media (id, original_name, mime_type, size, extension, width, height, has_thumbnail, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.prepare(sql).run(
    metadata.id,
    metadata.originalName,
    metadata.mimeType,
    metadata.size,
    metadata.extension || null,
    metadata.width || null,
    metadata.height || null,
    metadata.hasThumbnail ? 1 : 0,
    metadata.uploadedBy || null
  );

  return getById(metadata.id);
}

/**
 * Get media record by ID
 * @param {string} id - Media UUID
 * @returns {Object|null} Media record or null
 */
function getById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM _media WHERE id = ?').get(id);

  if (!row) return null;

  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    extension: row.extension,
    width: row.width,
    height: row.height,
    hasThumbnail: row.has_thumbnail === 1,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Delete media record by ID
 * @param {string} id - Media UUID
 * @returns {boolean} True if deleted
 */
function deleteById(id) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM _media WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * List media records with pagination and filtering
 * @param {Object} options - Query options
 * @param {number} [options.limit=50] - Max records to return
 * @param {number} [options.offset=0] - Records to skip
 * @param {string} [options.mimeType] - Filter by MIME type prefix (e.g., 'image/')
 * @returns {Object} { data: Array, total: number }
 */
function list({ limit = 50, offset = 0, mimeType } = {}) {
  const db = getDatabase();

  let whereClauses = [];
  let params = [];

  if (mimeType) {
    whereClauses.push('mime_type LIKE ?');
    params.push(mimeType + '%');
  }

  const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Get total count
  const countSQL = `SELECT COUNT(*) as total FROM _media ${whereSQL}`;
  const { total } = db.prepare(countSQL).get(...params);

  // Get records
  const dataSQL = `
    SELECT * FROM _media
    ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSQL).all(...params, limit, offset);

  const data = rows.map(row => ({
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    extension: row.extension,
    width: row.width,
    height: row.height,
    hasThumbnail: row.has_thumbnail === 1,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return { data, total };
}

/**
 * Upsert media record (for rebuild from manifests)
 * @param {Object} metadata - Media metadata
 * @returns {Object} Upserted record
 */
function upsert(metadata) {
  const db = getDatabase();

  const sql = `
    INSERT INTO _media (id, original_name, mime_type, size, extension, width, height, has_thumbnail, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      original_name = excluded.original_name,
      mime_type = excluded.mime_type,
      size = excluded.size,
      extension = excluded.extension,
      width = excluded.width,
      height = excluded.height,
      has_thumbnail = excluded.has_thumbnail,
      uploaded_by = excluded.uploaded_by,
      updated_at = datetime('now')
  `;

  db.prepare(sql).run(
    metadata.id,
    metadata.originalName,
    metadata.mimeType,
    metadata.size,
    metadata.extension || null,
    metadata.width || null,
    metadata.height || null,
    metadata.hasThumbnail ? 1 : 0,
    metadata.uploadedBy || null
  );

  return getById(metadata.id);
}

// ============================================================================
// Reference Tracking
// ============================================================================

/**
 * Add a reference from an entity to a media file
 * @param {string} mediaId - Media UUID
 * @param {string} entityName - Entity class name
 * @param {number} entityId - Entity record ID
 * @param {string} fieldName - Field name that holds the reference
 */
function addReference(mediaId, entityName, entityId, fieldName) {
  const db = getDatabase();

  const sql = `
    INSERT OR REPLACE INTO _media_refs (media_id, entity_name, entity_id, field_name)
    VALUES (?, ?, ?, ?)
  `;

  db.prepare(sql).run(mediaId, entityName, entityId, fieldName);
}

/**
 * Remove a specific reference
 * @param {string} mediaId - Media UUID
 * @param {string} entityName - Entity class name
 * @param {number} entityId - Entity record ID
 * @param {string} fieldName - Field name
 */
function removeReference(mediaId, entityName, entityId, fieldName) {
  const db = getDatabase();

  const sql = `
    DELETE FROM _media_refs
    WHERE media_id = ? AND entity_name = ? AND entity_id = ? AND field_name = ?
  `;

  db.prepare(sql).run(mediaId, entityName, entityId, fieldName);
}

/**
 * Remove all references from a specific entity record
 * @param {string} entityName - Entity class name
 * @param {number} entityId - Entity record ID
 */
function removeEntityReferences(entityName, entityId) {
  const db = getDatabase();

  const sql = `
    DELETE FROM _media_refs
    WHERE entity_name = ? AND entity_id = ?
  `;

  db.prepare(sql).run(entityName, entityId);
}

/**
 * Get all references for a media file
 * @param {string} mediaId - Media UUID
 * @returns {Array} Array of { entityName, entityId, fieldName }
 */
function getReferences(mediaId) {
  const db = getDatabase();

  const sql = `
    SELECT entity_name, entity_id, field_name, created_at
    FROM _media_refs
    WHERE media_id = ?
  `;

  return db.prepare(sql).all(mediaId).map(row => ({
    entityName: row.entity_name,
    entityId: row.entity_id,
    fieldName: row.field_name,
    createdAt: row.created_at
  }));
}

/**
 * Check if a media file is referenced by any entity
 * @param {string} mediaId - Media UUID
 * @returns {boolean}
 */
function isReferenced(mediaId) {
  const db = getDatabase();

  const sql = `SELECT 1 FROM _media_refs WHERE media_id = ? LIMIT 1`;
  const result = db.prepare(sql).get(mediaId);

  return !!result;
}

/**
 * Get orphaned media (not referenced by any entity)
 * @param {number} [olderThanHours=24] - Only return media older than this many hours
 * @returns {Array} Array of media records
 */
function getOrphanedMedia(olderThanHours = 24) {
  const db = getDatabase();

  const sql = `
    SELECT m.*
    FROM _media m
    LEFT JOIN _media_refs r ON m.id = r.media_id
    WHERE r.media_id IS NULL
      AND m.created_at < datetime('now', '-' || ? || ' hours')
    ORDER BY m.created_at ASC
  `;

  const rows = db.prepare(sql).all(olderThanHours);

  return rows.map(row => ({
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    extension: row.extension,
    createdAt: row.created_at
  }));
}

/**
 * Get total media count and size
 * @returns {Object} { count, totalSize }
 */
function getStats() {
  const db = getDatabase();

  const sql = `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM _media`;
  return db.prepare(sql).get();
}

/**
 * Clear all media records (for testing/reset)
 */
function clearAll() {
  const db = getDatabase();
  db.exec('DELETE FROM _media_refs');
  db.exec('DELETE FROM _media');
}

module.exports = {
  // CRUD
  create,
  getById,
  deleteById,
  list,
  upsert,

  // Reference tracking
  addReference,
  removeReference,
  removeEntityReferences,
  getReferences,
  isReferenced,
  getOrphanedMedia,

  // Utilities
  getStats,
  clearAll
};
