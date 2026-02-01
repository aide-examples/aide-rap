/**
 * Media Router - REST API for file upload and management
 *
 * Endpoints:
 * - GET    /api/media           - List all media (paginated)
 * - GET    /api/media/:id       - Get media metadata
 * - GET    /api/media/:id/file  - Download/view file
 * - GET    /api/media/:id/thumbnail - Get thumbnail
 * - POST   /api/media           - Upload single file
 * - POST   /api/media/bulk      - Upload multiple files
 * - DELETE /api/media/:id       - Delete media (admin only)
 * - POST   /api/media/cleanup   - Remove orphaned files (admin)
 * - POST   /api/media/rebuild-index - Rebuild DB from manifests (admin)
 * - GET    /api/media/manifests - Export all manifests (admin)
 * - GET    /api/media/stats     - Get storage statistics
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const MediaRepository = require('../repositories/MediaRepository');

/**
 * Create media router
 * @param {MediaService} mediaService - MediaService instance
 * @param {Object} cfg - Configuration
 * @returns {express.Router}
 */
module.exports = function(mediaService, cfg) {
  const router = express.Router();

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: parseSize(cfg.media?.maxFileSize) || 50 * 1024 * 1024, // 50MB default
      files: cfg.media?.maxBulkFiles || 20
    },
    fileFilter: (req, file, cb) => {
      // Optional: filter by allowed types
      const allowedTypes = cfg.media?.allowedTypes;
      if (allowedTypes && allowedTypes.length > 0) {
        const allowed = allowedTypes.some(type => {
          if (type.startsWith('.')) {
            // Extension filter (e.g., '.pdf')
            return file.originalname.toLowerCase().endsWith(type);
          } else if (type.endsWith('/*')) {
            // MIME prefix filter (e.g., 'image/*')
            return file.mimetype.startsWith(type.replace('/*', '/'));
          } else {
            // Exact MIME match
            return file.mimetype === type;
          }
        });
        if (!allowed) {
          return cb(new Error(`File type not allowed: ${file.mimetype}`), false);
        }
      }
      cb(null, true);
    }
  });

  // ============================================================================
  // Public Endpoints (guest+)
  // ============================================================================

  /**
   * GET /api/media - List media with pagination
   * Query params:
   *   - limit, offset: pagination
   *   - type: filter by MIME type prefix (e.g., 'image/')
   *   - entity, field: filter by entity/field reference (for media browser)
   */
  router.get('/', (req, res, next) => {
    try {
      const { limit = 50, offset = 0, type, entity, field } = req.query;
      const parsedLimit = parseInt(limit, 10);
      const parsedOffset = parseInt(offset, 10);

      let result;

      // If entity and field specified, use field-specific query
      if (entity && field) {
        result = MediaRepository.listByEntityField(entity, field, {
          limit: parsedLimit,
          offset: parsedOffset
        });
      } else {
        result = MediaRepository.list({
          limit: parsedLimit,
          offset: parsedOffset,
          mimeType: type
        });
      }

      // Add URLs to each record
      result.data = result.data.map(m => ({
        ...m,
        fileUrl: `/api/media/${m.id}/file`,
        thumbnailUrl: m.hasThumbnail ? `/api/media/${m.id}/thumbnail` : null
      }));

      res.json({
        data: result.data,
        pagination: {
          total: result.total,
          limit: parsedLimit,
          offset: parsedOffset
        }
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/media/stats - Get storage statistics
   */
  router.get('/stats', (req, res, next) => {
    try {
      const stats = mediaService.getStats();
      res.json(stats);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/media/:id - Get media metadata
   */
  router.get('/:id', (req, res, next) => {
    try {
      const { id } = req.params;
      const record = MediaRepository.getById(id);

      if (!record) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Media ${id} not found` }
        });
      }

      res.json({
        ...record,
        fileUrl: `/api/media/${id}/file`,
        thumbnailUrl: record.hasThumbnail ? `/api/media/${id}/thumbnail` : null,
        references: MediaRepository.getReferences(id)
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/media/:id/file - Serve the actual file
   */
  router.get('/:id/file', (req, res, next) => {
    try {
      const { id } = req.params;
      const record = MediaRepository.getById(id);

      if (!record) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Media ${id} not found` }
        });
      }

      const filePath = mediaService.getFilePath(id, record.extension);

      // Set headers for inline display or download
      res.setHeader('Content-Type', record.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.originalName)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache

      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({
            error: { code: 'FILE_NOT_FOUND', message: 'File not found on disk' }
          });
        }
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/media/:id/thumbnail - Serve thumbnail
   */
  router.get('/:id/thumbnail', (req, res, next) => {
    try {
      const { id } = req.params;
      const record = MediaRepository.getById(id);

      if (!record) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Media ${id} not found` }
        });
      }

      if (!record.hasThumbnail) {
        return res.status(404).json({
          error: { code: 'NO_THUMBNAIL', message: 'No thumbnail available' }
        });
      }

      const thumbPath = mediaService.getThumbnailPath(id);

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      res.sendFile(thumbPath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({
            error: { code: 'THUMBNAIL_NOT_FOUND', message: 'Thumbnail not found on disk' }
          });
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Write Endpoints (user+)
  // ============================================================================

  /**
   * POST /api/media - Upload single file
   * Body can include constraints: { maxSize, maxWidth, maxHeight, maxDuration }
   */
  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No file provided' }
        });
      }

      const uploadedBy = req.user?.username || null;

      // Parse optional constraints from request body (passed as JSON in a field)
      let constraints = null;
      if (req.body.constraints) {
        try {
          constraints = typeof req.body.constraints === 'string'
            ? JSON.parse(req.body.constraints)
            : req.body.constraints;
        } catch {
          // Ignore invalid constraints
        }
      }

      const result = await mediaService.upload(req.file, uploadedBy, null, constraints);

      res.status(201).json(result);
    } catch (err) {
      // Handle size/dimension errors with appropriate status code
      if (err.message.includes('too large') || err.message.includes('exceeds')) {
        return res.status(413).json({
          error: { code: 'FILE_TOO_LARGE', message: err.message }
        });
      }
      next(err);
    }
  });

  /**
   * POST /api/media/from-url - Upload file from URL
   * Body: { url, constraints?: { maxSize, maxWidth, maxHeight } }
   */
  router.post('/from-url', async (req, res, next) => {
    try {
      const { url, constraints } = req.body;

      if (!url) {
        return res.status(400).json({
          error: { code: 'NO_URL', message: 'No URL provided' }
        });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          error: { code: 'INVALID_URL', message: 'Invalid URL format' }
        });
      }

      const uploadedBy = req.user?.username || null;
      const result = await mediaService.uploadFromUrl(url, uploadedBy, constraints || null);

      res.status(201).json(result);
    } catch (err) {
      if (err.message.includes('Failed to fetch')) {
        return res.status(400).json({
          error: { code: 'FETCH_FAILED', message: err.message }
        });
      }
      if (err.message.includes('too large') || err.message.includes('exceeds')) {
        return res.status(413).json({
          error: { code: 'FILE_TOO_LARGE', message: err.message }
        });
      }
      if (err.message.includes('HTML page')) {
        return res.status(400).json({
          error: { code: 'INVALID_CONTENT_TYPE', message: err.message }
        });
      }
      next(err);
    }
  });

  /**
   * POST /api/media/bulk - Upload multiple files
   */
  router.post('/bulk', upload.array('files', cfg.media?.maxBulkFiles || 20), async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: { code: 'NO_FILES', message: 'No files provided' }
        });
      }

      const uploadedBy = req.user?.username || null;
      const result = await mediaService.bulkUpload(req.files, uploadedBy);

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * DELETE /api/media/:id - Delete media file
   */
  router.delete('/:id', (req, res, next) => {
    try {
      // Check admin role (if auth enabled)
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const { id } = req.params;
      const record = MediaRepository.getById(id);

      if (!record) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Media ${id} not found` }
        });
      }

      // Check if referenced
      if (MediaRepository.isReferenced(id)) {
        return res.status(409).json({
          error: {
            code: 'REFERENCED',
            message: 'Cannot delete: media is referenced by entities',
            references: MediaRepository.getReferences(id)
          }
        });
      }

      mediaService.delete(id);

      res.json({ success: true, deleted: id });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/media/cleanup - Remove orphaned files
   */
  router.post('/cleanup', (req, res, next) => {
    try {
      // Check admin role
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const { olderThanHours = 24 } = req.body;
      const result = mediaService.cleanupOrphans(parseInt(olderThanHours, 10));

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/media/rebuild-index - Rebuild DB from manifests
   */
  router.post('/rebuild-index', (req, res, next) => {
    try {
      // Check admin role
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const result = mediaService.rebuildIndex();

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/media/restore-links - Restore media links from manifests
   * Updates entity records' media fields based on manifest refs
   */
  router.post('/restore-links', (req, res, next) => {
    try {
      // Check admin role
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const result = mediaService.restoreMediaLinks();

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/media/manifests - Export all manifests
   */
  router.get('/manifests', (req, res, next) => {
    try {
      // Check admin role
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const manifests = mediaService.getAllManifests();
      const count = Object.keys(manifests).length;

      res.json({
        count,
        manifests
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Error Handler for Multer
  // ============================================================================

  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File too large. Maximum size: ${formatSize(parseSize(cfg.media?.maxFileSize) || 50 * 1024 * 1024)}`
          }
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          error: {
            code: 'TOO_MANY_FILES',
            message: `Too many files. Maximum: ${cfg.media?.maxBulkFiles || 20}`
          }
        });
      }
      return res.status(400).json({
        error: { code: err.code, message: err.message }
      });
    }

    if (err.message && err.message.includes('File type not allowed')) {
      return res.status(400).json({
        error: { code: 'INVALID_FILE_TYPE', message: err.message }
      });
    }

    next(err);
  });

  return router;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse size string (e.g., '50MB') to bytes
 * @param {string|number} size - Size string or number
 * @returns {number} Size in bytes
 */
function parseSize(size) {
  if (typeof size === 'number') return size;
  if (!size) return 0;

  const match = String(size).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };

  return Math.floor(num * (multipliers[unit] || 1));
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
