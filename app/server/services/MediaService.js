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
   * Upload a single file
   * @param {Object} file - Multer file object
   * @param {Buffer} file.buffer - File content
   * @param {string} file.originalname - Original filename
   * @param {string} file.mimetype - MIME type
   * @param {number} file.size - File size
   * @param {string} [uploadedBy] - Username of uploader
   * @returns {Promise<Object>} Created media record with URLs
   */
  async upload(file, uploadedBy = null) {
    const id = uuidv4();
    const subdir = this.getSubdir(id);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${id}${ext}`;

    // Ensure subdirectory exists
    const originalsSubdir = path.join(this.originalsPath, subdir);
    if (!fs.existsSync(originalsSubdir)) {
      fs.mkdirSync(originalsSubdir, { recursive: true });
    }

    // Save original file
    const filePath = path.join(originalsSubdir, filename);
    fs.writeFileSync(filePath, file.buffer);

    // Process image: get dimensions and generate thumbnail
    const isImage = file.mimetype.startsWith('image/');
    let width = null;
    let height = null;
    let hasThumbnail = false;

    if (isImage && getSharp()) {
      try {
        const thumbSubdir = path.join(this.thumbnailsPath, subdir);
        if (!fs.existsSync(thumbSubdir)) {
          fs.mkdirSync(thumbSubdir, { recursive: true });
        }

        const sharpInstance = getSharp();
        const metadata = await sharpInstance(file.buffer).metadata();
        width = metadata.width;
        height = metadata.height;

        // Generate thumbnail
        const thumbSize = this.cfg.thumbnails?.maxWidth || 200;
        await sharpInstance(file.buffer)
          .resize(thumbSize, thumbSize, { fit: 'inside' })
          .jpeg({ quality: this.cfg.thumbnails?.quality || 80 })
          .toFile(path.join(thumbSubdir, `${id}_thumb.jpg`));

        hasThumbnail = true;
      } catch (err) {
        logger.warn('Thumbnail generation failed', { id, error: err.message });
      }
    }

    // Update manifest (safety net)
    this.updateManifest(subdir, id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy,
      uploadedAt: new Date().toISOString()
    });

    // Save to database
    const record = MediaRepository.create({
      id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extension: ext,
      width,
      height,
      hasThumbnail,
      uploadedBy
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
              uploadedBy: entry.uploadedBy || null
            });

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

  // ============================================================================
  // Event Listeners for Reference Tracking
  // ============================================================================

  /**
   * Setup EventBus listeners for entity changes
   */
  setupEventListeners() {
    // Track media references when entities are created/updated
    eventBus.on('entity:create:after', (entityName, record, context) => {
      this.trackMediaReferences(entityName, record.id, record);
    });

    eventBus.on('entity:update:after', (entityName, record, context) => {
      // Remove old references first (update might clear a media field)
      MediaRepository.removeEntityReferences(entityName, record.id);
      // Add current references
      this.trackMediaReferences(entityName, record.id, record);
    });

    // Remove all references when entity is deleted
    eventBus.on('entity:delete:after', (entityName, id, context) => {
      MediaRepository.removeEntityReferences(entityName, id);
    });
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
        }
      }
    } catch (err) {
      // Schema might not be loaded yet during initialization
      logger.debug('Could not track media references', { entityName, error: err.message });
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
