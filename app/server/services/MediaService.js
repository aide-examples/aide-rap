/**
 * MediaService - Business logic for media file management
 *
 * Features:
 * - Directory hashing (256 buckets based on UUID prefix)
 * - Thumbnail generation for images
 * - Manifest files as safety net for DB recovery
 * - Reference tracking via EventBus
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const MediaRepository = require('../repositories/MediaRepository');
const eventBus = require('../utils/EventBus');
const logger = require('../utils/logger');

// Lazy-load sharp (optional dependency for thumbnails)
let sharp = null;
function getSharp() {
  if (sharp === null) {
    try {
      sharp = require('sharp');
    } catch {
      logger.warn('sharp not available - thumbnail generation disabled');
      sharp = false;
    }
  }
  return sharp;
}

class MediaService {
  /**
   * @param {string} mediaPath - Base path for media storage
   * @param {Object} cfg - Configuration object
   */
  constructor(mediaPath, cfg = {}) {
    this.mediaPath = mediaPath;
    this.originalsPath = path.join(mediaPath, 'originals');
    this.thumbnailsPath = path.join(mediaPath, 'thumbnails');
    this.cfg = cfg.media || {};

    this.ensureDirectories();
    this.setupEventListeners();
  }

  /**
   * Ensure base directories exist
   */
  ensureDirectories() {
    if (!fs.existsSync(this.originalsPath)) {
      fs.mkdirSync(this.originalsPath, { recursive: true });
    }
    if (!fs.existsSync(this.thumbnailsPath)) {
      fs.mkdirSync(this.thumbnailsPath, { recursive: true });
    }
  }

  /**
   * Get subdirectory for a UUID (first 2 hex characters)
   * @param {string} uuid - Media UUID
   * @returns {string} Subdirectory name (e.g., 'a5')
   */
  getSubdir(uuid) {
    return uuid.substring(0, 2).toLowerCase();
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size (e.g., "2.5 MB")
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  /**
   * Upload a single file
   * @param {Object} file - Multer file object
   * @param {Buffer} file.buffer - File content
   * @param {string} file.originalname - Original filename
   * @param {string} file.mimetype - MIME type
   * @param {number} file.size - File size
   * @param {string} [uploadedBy] - Username of uploader
   * @param {string} [sourceUrl] - Original URL if fetched from web
   * @param {Object} [constraints] - Optional media constraints from schema
   * @param {number} [constraints.maxSize] - Max file size in bytes
   * @param {number} [constraints.maxWidth] - Max image width (will be scaled)
   * @param {number} [constraints.maxHeight] - Max image height (will be scaled)
   * @param {number} [constraints.maxDuration] - Max duration in seconds (for validation)
   * @returns {Promise<Object>} Created media record with URLs
   */
  async upload(file, uploadedBy = null, sourceUrl = null, constraints = null) {
    // Apply constraints if provided
    let fileBuffer = file.buffer;
    let fileSize = file.size;

    // Validate file size
    if (constraints?.maxSize && fileSize > constraints.maxSize) {
      throw new Error(`File too large: ${this.formatSize(fileSize)} exceeds ${this.formatSize(constraints.maxSize)}`);
    }

    const id = uuidv4();
    const subdir = this.getSubdir(id);
    let ext = path.extname(file.originalname).toLowerCase();
    const filename = `${id}${ext}`;

    // Ensure subdirectory exists
    const originalsSubdir = path.join(this.originalsPath, subdir);
    if (!fs.existsSync(originalsSubdir)) {
      fs.mkdirSync(originalsSubdir, { recursive: true });
    }

    // Process image: get dimensions, apply constraints, generate thumbnail
    const isImage = file.mimetype.startsWith('image/');
    let width = null;
    let height = null;
    let hasThumbnail = false;
    let wasResized = false;

    if (isImage && getSharp()) {
      try {
        const sharpInstance = getSharp();
        const metadata = await sharpInstance(fileBuffer).metadata();
        width = metadata.width;
        height = metadata.height;

        // Check if image needs to be resized based on constraints
        const maxW = constraints?.maxWidth;
        const maxH = constraints?.maxHeight;

        if ((maxW && width > maxW) || (maxH && height > maxH)) {
          // Resize image preserving aspect ratio
          logger.info('Resizing image to fit constraints', {
            id,
            original: `${width}x${height}`,
            maxWidth: maxW,
            maxHeight: maxH
          });

          const resizedBuffer = await sharpInstance(fileBuffer)
            .resize(maxW || null, maxH || null, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();

          // Update buffer and get new dimensions
          fileBuffer = resizedBuffer;
          fileSize = resizedBuffer.length;
          const newMeta = await sharpInstance(resizedBuffer).metadata();
          width = newMeta.width;
          height = newMeta.height;
          wasResized = true;

          logger.info('Image resized', { id, newSize: `${width}x${height}` });
        }

        // Ensure thumbnail subdirectory exists
        const thumbSubdir = path.join(this.thumbnailsPath, subdir);
        if (!fs.existsSync(thumbSubdir)) {
          fs.mkdirSync(thumbSubdir, { recursive: true });
        }

        // Generate thumbnail
        const thumbSize = this.cfg.thumbnails?.maxWidth || 200;
        await sharpInstance(fileBuffer)
          .resize(thumbSize, thumbSize, { fit: 'inside' })
          .jpeg({ quality: this.cfg.thumbnails?.quality || 80 })
          .toFile(path.join(thumbSubdir, `${id}_thumb.jpg`));

        hasThumbnail = true;
      } catch (err) {
        logger.warn('Image processing failed', { id, error: err.message });
      }
    }

    // Save file (potentially resized)
    const filePath = path.join(originalsSubdir, filename);
    fs.writeFileSync(filePath, fileBuffer);

    // Update manifest (safety net) - use potentially resized size
    this.updateManifest(subdir, id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: fileSize,
      uploadedBy,
      sourceUrl,
      uploadedAt: new Date().toISOString()
    });

    // Save to database (use potentially resized size)
    const record = MediaRepository.create({
      id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: fileSize,
      extension: ext,
      width,
      height,
      hasThumbnail,
      uploadedBy,
      sourceUrl
    });

    logger.info('Media uploaded', {
      id,
      name: file.originalname,
      size: file.size,
      isImage
    });

    return {
      ...record,
      fileUrl: `/api/media/${id}/file`,
      thumbnailUrl: hasThumbnail ? `/api/media/${id}/thumbnail` : null
    };
  }

  /**
   * Upload a file from a URL
   * Fetches the URL, extracts filename and content-type, stores as media
   * @param {string} url - URL to fetch
   * @param {string} [uploadedBy] - Username of uploader
   * @param {Object} [constraints] - Optional media constraints from schema
   * @returns {Promise<Object>} Created media record with URLs
   */
  async uploadFromUrl(url, uploadedBy = null, constraints = null) {
    // Fetch the URL with proper headers and redirect handling
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'AIDE-RAP/1.0 (Media Seeder; +https://github.com/anthropics/aide)',
        'Accept': 'image/*,*/*'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    // Get content type and filename
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const mimeType = contentType.split(';')[0].trim();

    // Reject HTML pages (user probably dropped an article link instead of an image link)
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
      throw new Error('URL returned HTML page instead of media file. Please use a direct link to the image/file.');
    }

    // Try to extract filename from Content-Disposition header or URL
    let filename = 'downloaded';
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '');
      }
    } else {
      // Extract from URL path
      try {
        const urlPath = new URL(url).pathname;
        const parts = urlPath.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.includes('.')) {
          filename = decodeURIComponent(lastPart);
        }
      } catch {
        // Keep default filename
      }
    }

    // Get file buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a file-like object for upload()
    const file = {
      buffer,
      originalname: filename,
      mimetype: mimeType,
      size: buffer.length
    };

    // Use existing upload method with sourceUrl and constraints
    return this.upload(file, uploadedBy, url, constraints);
  }

  /**
   * Upload multiple files
   * @param {Array} files - Array of multer file objects
   * @param {string} [uploadedBy] - Username of uploader
   * @returns {Promise<Object>} { uploaded: Array, failed: Array, total, successful }
   */
  async bulkUpload(files, uploadedBy = null) {
    const uploaded = [];
    const failed = [];

    for (const file of files) {
      try {
        const result = await this.upload(file, uploadedBy);
        uploaded.push(result);
      } catch (err) {
        failed.push({
          originalName: file.originalname,
          error: err.message
        });
        logger.error('Bulk upload file failed', { name: file.originalname, error: err.message });
      }
    }

    return {
      uploaded,
      failed,
      total: files.length,
      successful: uploaded.length
    };
  }

  /**
   * Get the file path for a media file
   * @param {string} id - Media UUID
   * @param {string} extension - File extension
   * @returns {string} Absolute file path
   */
  getFilePath(id, extension) {
    const subdir = this.getSubdir(id);
    return path.join(this.originalsPath, subdir, `${id}${extension}`);
  }

  /**
   * Get the thumbnail path for a media file
   * @param {string} id - Media UUID
   * @returns {string} Absolute thumbnail path
   */
  getThumbnailPath(id) {
    const subdir = this.getSubdir(id);
    return path.join(this.thumbnailsPath, subdir, `${id}_thumb.jpg`);
  }

  /**
   * Delete a media file (file system + database)
   * @param {string} id - Media UUID
   * @returns {boolean} True if deleted
   */
  delete(id) {
    const record = MediaRepository.getById(id);
    if (!record) return false;

    const subdir = this.getSubdir(id);

    // Delete original file
    const filePath = this.getFilePath(id, record.extension);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete thumbnail
    const thumbPath = this.getThumbnailPath(id);
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }

    // Remove from manifest
    this.removeFromManifest(subdir, id);

    // Delete from database
    MediaRepository.deleteById(id);

    logger.info('Media deleted', { id, name: record.originalName });

    return true;
  }

  /**
   * Clean up orphaned media files
   * @param {number} [olderThanHours=24] - Only delete files older than this
   * @returns {Object} { deleted: number, errors: number }
   */
  cleanupOrphans(olderThanHours = 24) {
    const orphans = MediaRepository.getOrphanedMedia(olderThanHours);
    let deleted = 0;
    let errors = 0;

    for (const orphan of orphans) {
      try {
        if (this.delete(orphan.id)) {
          deleted++;
        }
      } catch (err) {
        errors++;
        logger.error('Failed to delete orphan', { id: orphan.id, error: err.message });
      }
    }

    logger.info('Orphan cleanup completed', { deleted, errors, total: orphans.length });

    return { deleted, errors };
  }

  // ============================================================================
  // Manifest Management (Safety Net)
  // ============================================================================

  /**
   * Update manifest file for a subdirectory
   * @param {string} subdir - Subdirectory name (e.g., 'a5')
   * @param {string} id - Media UUID
   * @param {Object} entry - Manifest entry data
   */
  updateManifest(subdir, id, entry) {
    const manifestPath = path.join(this.originalsPath, subdir, 'manifest.json');
    let manifest = {};

    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        logger.warn('Could not parse manifest, starting fresh', { subdir });
      }
    }

    manifest[id] = entry;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Remove entry from manifest
   * @param {string} subdir - Subdirectory name
   * @param {string} id - Media UUID
   */
  removeFromManifest(subdir, id) {
    const manifestPath = path.join(this.originalsPath, subdir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        delete manifest[id];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (err) {
        logger.warn('Could not update manifest', { subdir, error: err.message });
      }
    }
  }

  /**
   * Get all manifests (for export/admin)
   * @returns {Object} Combined manifest from all subdirectories
   */
  getAllManifests() {
    const combined = {};

    if (!fs.existsSync(this.originalsPath)) return combined;

    const subdirs = fs.readdirSync(this.originalsPath);

    for (const subdir of subdirs) {
      const subdirPath = path.join(this.originalsPath, subdir);
      if (!fs.statSync(subdirPath).isDirectory()) continue;

      const manifestPath = path.join(subdirPath, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          Object.assign(combined, manifest);
        } catch {
          // Skip corrupted manifests
        }
      }
    }

    return combined;
  }

  /**
   * Rebuild database from manifest files
   * @returns {Object} { count: number, errors: number }
   */
  rebuildIndex() {
    if (!fs.existsSync(this.originalsPath)) {
      return { count: 0, errors: 0 };
    }

    const subdirs = fs.readdirSync(this.originalsPath);
    let count = 0;
    let errors = 0;

    for (const subdir of subdirs) {
      const subdirPath = path.join(this.originalsPath, subdir);
      if (!fs.statSync(subdirPath).isDirectory()) continue;

      const manifestPath = path.join(subdirPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        for (const [id, entry] of Object.entries(manifest)) {
          try {
            // Check if file actually exists
            const files = fs.readdirSync(subdirPath).filter(f => f.startsWith(id) && f !== 'manifest.json');
            if (files.length === 0) {
              logger.warn('Manifest entry without file', { id, subdir });
              continue;
            }

            const ext = path.extname(files[0]);
            const hasThumbnail = fs.existsSync(this.getThumbnailPath(id));

            MediaRepository.upsert({
              id,
              originalName: entry.originalName,
              mimeType: entry.mimeType,
              size: entry.size,
              extension: ext,
              width: entry.width || null,
              height: entry.height || null,
              hasThumbnail,
              uploadedBy: entry.uploadedBy || null,
              sourceUrl: entry.sourceUrl || null
            });

            // Also restore references from manifest if available
            if (entry.refs && Array.isArray(entry.refs)) {
              for (const ref of entry.refs) {
                try {
                  // Resolve entity ID: prefer label lookup (schema-resilient), fall back to stored id
                  let entityId = ref.id;
                  if (ref.label) {
                    const resolvedId = this.getEntityIdByLabel(ref.entity, ref.label);
                    if (resolvedId) {
                      entityId = resolvedId;
                    } else {
                      logger.debug('Could not resolve label to ID, skipping ref', {
                        mediaId: id, entity: ref.entity, label: ref.label
                      });
                      continue;
                    }
                  }
                  if (entityId) {
                    MediaRepository.addReference(id, ref.entity, entityId, ref.field);
                  }
                } catch (refErr) {
                  // Ignore duplicate reference errors
                  if (!refErr.message.includes('UNIQUE constraint')) {
                    logger.debug('Failed to restore reference', { id, ref, error: refErr.message });
                  }
                }
              }
            }

            count++;
          } catch (err) {
            errors++;
            logger.error('Failed to rebuild entry', { id, error: err.message });
          }
        }
      } catch (err) {
        logger.error('Failed to parse manifest', { subdir, error: err.message });
        errors++;
      }
    }

    logger.info('Index rebuild completed', { count, errors });
    return { count, errors };
  }

  /**
   * Rebuild media references from entity data
   * Scans all entities with media fields and reconstructs _media_refs table
   * @returns {Object} { count: number, errors: number }
   */
  rebuildReferences() {
    const { getSchema, getDatabase } = require('../config/database');

    try {
      const schema = getSchema();
      const db = getDatabase();
      let count = 0;
      let errors = 0;

      // Find all entities with media fields
      for (const [entityName, entity] of Object.entries(schema.entities)) {
        const mediaFields = entity.columns.filter(c => c.customType === 'media');
        if (mediaFields.length === 0) continue;

        // Query all records from this entity
        const tableName = entity.tableName;
        const fieldNames = mediaFields.map(c => c.name);

        try {
          const rows = db.prepare(`SELECT id, ${fieldNames.join(', ')} FROM ${tableName}`).all();

          for (const row of rows) {
            for (const field of mediaFields) {
              const mediaId = row[field.name];
              if (mediaId && typeof mediaId === 'string' && mediaId.length === 36) {
                try {
                  MediaRepository.addReference(mediaId, entityName, row.id, field.name);
                  // Also update manifest with reference
                  this.addRefToManifest(mediaId, entityName, row.id, field.name);
                  count++;
                } catch (err) {
                  // Reference might already exist - that's ok
                  if (!err.message.includes('UNIQUE constraint')) {
                    errors++;
                    logger.debug('Failed to add reference', { mediaId, entityName, error: err.message });
                  }
                }
              }
            }
          }
        } catch (err) {
          logger.warn('Failed to scan entity for media', { entityName, error: err.message });
          errors++;
        }
      }

      logger.info('References rebuild completed', { count, errors });
      return { count, errors };
    } catch (err) {
      logger.error('Failed to rebuild references', { error: err.message });
      return { count: 0, errors: 1 };
    }
  }

  // ============================================================================
  // Event Listeners for Reference Tracking
  // ============================================================================

  /**
   * Setup EventBus listeners for entity changes
   */
  setupEventListeners() {
    // Track media references when entities are created
    eventBus.on('entity:create:after', (entityName, record, context) => {
      this.trackMediaReferences(entityName, record.id, record);
    });

    // Track media references when entities are updated (with immediate orphan cleanup)
    eventBus.on('entity:update:after', (entityName, record, context) => {
      // 1. Get old references BEFORE removing (for orphan detection)
      const oldRefs = MediaRepository.getEntityReferences(entityName, record.id);
      const oldMediaIds = oldRefs.map(r => r.mediaId);

      // 2. Remove old references
      MediaRepository.removeEntityReferences(entityName, record.id);

      // 3. Add current references
      this.trackMediaReferences(entityName, record.id, record);

      // 4. Immediate cleanup: delete media that is now orphaned
      for (const mediaId of oldMediaIds) {
        if (!MediaRepository.isReferenced(mediaId)) {
          this.delete(mediaId);
          logger.info('Orphaned media deleted on update', { mediaId, entityName, entityId: record.id });
        }
      }
    });

    // Remove all references when entity is deleted (with immediate orphan cleanup)
    eventBus.on('entity:delete:after', (entityName, id, context) => {
      // 1. Get references before removing
      const refs = MediaRepository.getEntityReferences(entityName, id);
      const mediaIds = refs.map(r => r.mediaId);

      // 2. Remove references from DB and manifest
      MediaRepository.removeEntityReferences(entityName, id);
      for (const mediaId of mediaIds) {
        this.removeRefFromManifest(mediaId, entityName, id);
      }

      // 3. Delete orphaned media immediately
      for (const mediaId of mediaIds) {
        if (!MediaRepository.isReferenced(mediaId)) {
          this.delete(mediaId);
          logger.info('Orphaned media deleted on entity delete', { mediaId, entityName, entityId: id });
        }
      }
    });

    // Update media references after seed load (bulk operation)
    // SeedManager uses direct SQL, so entity:create/update events don't fire
    eventBus.on('seed:load:after', (entityName, result) => {
      this.updateEntityMediaRefs(entityName);
    });

    // Clear all media files when seed data is cleared
    eventBus.on('seed:clearAll:after', (results) => {
      this.clearAll();
      logger.info('Media files cleared along with entity data');
    });

    // Backup media files when entity data is backed up
    eventBus.on('seed:backup:after', ({ backupDir }) => {
      this.backupTo(backupDir);
    });

    // Restore media files when entity data is restored
    eventBus.on('seed:restore:before', ({ backupDir }) => {
      this.restoreFrom(backupDir);
    });
  }

  /**
   * Backup media originals to backup directory
   * @param {string} backupDir - Backup directory path
   */
  backupTo(backupDir) {
    const mediaBackupDir = path.join(backupDir, 'media');

    // Remove existing media backup
    if (fs.existsSync(mediaBackupDir)) {
      fs.rmSync(mediaBackupDir, { recursive: true, force: true });
    }

    // Copy originals directory (includes manifests)
    if (fs.existsSync(this.originalsPath)) {
      fs.cpSync(this.originalsPath, mediaBackupDir, { recursive: true });
      logger.info('Media files backed up', { dir: mediaBackupDir });
    }
  }

  /**
   * Restore media originals from backup directory
   * @param {string} backupDir - Backup directory path
   */
  restoreFrom(backupDir) {
    const mediaBackupDir = path.join(backupDir, 'media');

    if (!fs.existsSync(mediaBackupDir)) {
      logger.debug('No media backup found, skipping restore');
      return;
    }

    // Clear current media
    this.clearAll();

    // Copy backup to originals
    fs.cpSync(mediaBackupDir, this.originalsPath, { recursive: true });

    // Rebuild index from manifests
    this.rebuildIndex();

    logger.info('Media files restored from backup');
  }

  /**
   * Clear all media files and database records
   * Used when resetting all entity data
   */
  clearAll() {
    // Clear database tables
    MediaRepository.clearAll();

    // Delete all files in originals and thumbnails directories
    if (fs.existsSync(this.originalsPath)) {
      fs.rmSync(this.originalsPath, { recursive: true, force: true });
      fs.mkdirSync(this.originalsPath, { recursive: true });
    }
    if (fs.existsSync(this.thumbnailsPath)) {
      fs.rmSync(this.thumbnailsPath, { recursive: true, force: true });
      fs.mkdirSync(this.thumbnailsPath, { recursive: true });
    }
  }

  /**
   * Update media references for all records of an entity
   * Used after bulk operations like seeding where individual entity events don't fire
   * @param {string} entityName - Entity class name
   */
  updateEntityMediaRefs(entityName) {
    const { getSchema, getDatabase } = require('../config/database');

    try {
      const schema = getSchema();
      const db = getDatabase();
      const entity = schema.entities[entityName];
      if (!entity) return;

      // Find media columns
      const mediaColumns = entity.columns.filter(c => c.customType === 'media');
      if (mediaColumns.length === 0) return;

      // Query all records with media fields
      const fieldNames = mediaColumns.map(c => c.name);
      const rows = db.prepare(`SELECT id, ${fieldNames.join(', ')} FROM ${entity.tableName}`).all();

      for (const row of rows) {
        for (const col of mediaColumns) {
          const mediaId = row[col.name];
          if (mediaId && typeof mediaId === 'string' && mediaId.length === 36) {
            try {
              MediaRepository.addReference(mediaId, entityName, row.id, col.name);
            } catch (e) {
              // Ignore duplicate errors
            }
            this.addRefToManifest(mediaId, entityName, row.id, col.name);
          }
        }
      }
    } catch (err) {
      logger.debug('Could not update entity media refs', { entityName, error: err.message });
    }
  }

  /**
   * Track media references for an entity record
   * @param {string} entityName - Entity class name
   * @param {number} entityId - Entity record ID
   * @param {Object} record - Entity data
   */
  trackMediaReferences(entityName, entityId, record) {
    // Get schema to find media fields
    const { getSchema } = require('../config/database');

    try {
      const schema = getSchema();
      const entity = schema.entities[entityName];
      if (!entity) return;

      // Find columns with customType 'media'
      const mediaFields = entity.columns.filter(c => c.customType === 'media');

      for (const col of mediaFields) {
        const mediaId = record[col.name];
        if (mediaId && typeof mediaId === 'string' && mediaId.length === 36) {
          MediaRepository.addReference(mediaId, entityName, entityId, col.name);
          // Also update manifest with reference info
          this.addRefToManifest(mediaId, entityName, entityId, col.name);
        }
      }
    } catch (err) {
      // Schema might not be loaded yet during initialization
      logger.debug('Could not track media references', { entityName, error: err.message });
    }
  }

  /**
   * Get the LABEL column value for an entity record
   * Uses the column marked with [LABEL] in the schema
   * @param {string} entityName - Entity class name
   * @param {number} entityId - Entity record ID
   * @returns {string|null} Label value or null
   */
  getEntityLabelValue(entityName, entityId) {
    const { getSchema, getDatabase } = require('../config/database');

    try {
      const schema = getSchema();
      const db = getDatabase();
      const entity = schema.entities[entityName];
      if (!entity) return null;

      // Find the LABEL column
      const labelCol = entity.columns.find(c => c.ui?.label);
      if (!labelCol) return null;

      // Query the label value
      const row = db.prepare(`SELECT ${labelCol.name} FROM ${entity.tableName} WHERE id = ?`).get(entityId);
      return row ? row[labelCol.name] : null;
    } catch (err) {
      logger.debug('Could not get entity label value', { entityName, entityId, error: err.message });
      return null;
    }
  }

  /**
   * Get the entity ID by its LABEL value
   * Used when restoring refs from manifest that store label values
   * @param {string} entityName - Entity class name
   * @param {string} labelValue - Label value to look up
   * @returns {number|null} Entity ID or null
   */
  getEntityIdByLabel(entityName, labelValue) {
    const { getSchema, getDatabase } = require('../config/database');

    try {
      const schema = getSchema();
      const db = getDatabase();
      const entity = schema.entities[entityName];
      if (!entity) return null;

      // Find the LABEL column
      const labelCol = entity.columns.find(c => c.ui?.label);
      if (!labelCol) return null;

      // Query by label value
      const row = db.prepare(`SELECT id FROM ${entity.tableName} WHERE ${labelCol.name} = ?`).get(labelValue);
      return row ? row.id : null;
    } catch (err) {
      logger.debug('Could not get entity ID by label', { entityName, labelValue, error: err.message });
      return null;
    }
  }

  /**
   * Add reference info to manifest file
   * Stores the LABEL value instead of ID for schema resilience
   * @param {string} mediaId - Media UUID
   * @param {string} entityName - Entity class name
   * @param {number} entityId - Entity record ID
   * @param {string} fieldName - Field name
   */
  addRefToManifest(mediaId, entityName, entityId, fieldName) {
    const subdir = this.getSubdir(mediaId);
    const manifestPath = path.join(this.originalsPath, subdir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) return;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest[mediaId]) return;

      // Get label value for the entity (schema-resilient identifier)
      const labelValue = this.getEntityLabelValue(entityName, entityId);

      // Initialize or update refs array
      if (!manifest[mediaId].refs) {
        manifest[mediaId].refs = [];
      }

      // Check if this ref already exists (by label if available, otherwise by entity+field+id)
      const existingRefIndex = manifest[mediaId].refs.findIndex(r => {
        if (r.entity !== entityName || r.field !== fieldName) return false;
        // Match by label if both have it, otherwise by id
        if (labelValue && r.label) return r.label === labelValue;
        if (r.id !== undefined) return r.id === entityId;
        return false;
      });

      if (existingRefIndex === -1) {
        // New ref - add it
        const refEntry = {
          entity: entityName,
          field: fieldName
        };
        // Prefer label over id for schema resilience
        if (labelValue) {
          refEntry.label = labelValue;
        } else {
          refEntry.id = entityId;
        }
        manifest[mediaId].refs.push(refEntry);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      } else {
        // Existing ref - migrate from id to label format if needed
        const existingRef = manifest[mediaId].refs[existingRefIndex];
        if (labelValue && existingRef.id !== undefined && !existingRef.label) {
          // Upgrade: remove id, add label
          delete existingRef.id;
          existingRef.label = labelValue;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        }
      }
    } catch (err) {
      logger.debug('Could not update manifest with ref', { mediaId, error: err.message });
    }
  }

  /**
   * Remove reference from manifest file
   * Handles both label-based and id-based refs
   * @param {string} mediaId - Media UUID
   * @param {string} entityName - Entity class name
   * @param {number} entityId - Entity record ID
   */
  removeRefFromManifest(mediaId, entityName, entityId) {
    const subdir = this.getSubdir(mediaId);
    const manifestPath = path.join(this.originalsPath, subdir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) return;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest[mediaId] || !manifest[mediaId].refs) return;

      // Get label value to match label-based refs
      const labelValue = this.getEntityLabelValue(entityName, entityId);

      // Filter out refs matching by either id or label
      manifest[mediaId].refs = manifest[mediaId].refs.filter(r => {
        if (r.entity !== entityName) return true;
        // Match by label if ref has label and we have a label value
        if (r.label && labelValue) return r.label !== labelValue;
        // Match by id for legacy refs
        if (r.id) return r.id !== entityId;
        return true;
      });

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (err) {
      logger.debug('Could not remove ref from manifest', { mediaId, error: err.message });
    }
  }

  /**
   * Get service statistics
   * @returns {Object} { fileCount, totalSize, orphanCount }
   */
  getStats() {
    const dbStats = MediaRepository.getStats();
    const orphans = MediaRepository.getOrphanedMedia(0);

    return {
      fileCount: dbStats.count,
      totalSize: dbStats.totalSize,
      orphanCount: orphans.length
    };
  }
}

module.exports = MediaService;
