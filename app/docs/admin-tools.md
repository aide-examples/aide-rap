# Admin Tools

### Seed Manager

The Admin menu opens a dedicated interface for managing seed data across all entities:

**Entity Overview Table:**
- Shows all entities in dependency order (load top-to-bottom, clear bottom-to-top)
- **Seed** – Record count in seed file (or `--` if none); shows `valid / total` when some records have unresolved FKs
- **Backup** – Record count in backup file (or `--` if none)
- **DB Rows** – Current record count in database

**Context Menu Actions** (click or right-click on entity row):
- **Import...** – Open import dialog (paste or drag & drop JSON/CSV)
- **Export...** – Download seed file as JSON or CSV
- **Generate...** – Open AI generator dialog
- **Load...** – Preview seed data, then load into database
- **Clear** – Delete all records from database

**Import Dialog Features:**
- **Auto-detect format** – JSON or CSV (semicolon, comma, or tab separated)
- **Drag & drop** – Drop `.json` or `.csv` files directly
- **Paste support** – Paste text from clipboard
- **Preview table** – Shows parsed records before saving
- **FK validation** – Warns about unresolved foreign key references

**Bulk Operations:**
- **Backup** – Export all DB data to `data/backup/` as JSON (with FK label resolution)
- **Restore** – Clear DB and reload from backup files
- **Load All** – Load all available seed files (merge mode)
- **Clear All** – Clear all database tables
- **Reset All** – Clear then reload all seed data
- **Reinitialize** – Re-read DataModel.md and rebuild database schema without server restart. Two-step confirmation: warns about data loss, then offers backup before proceeding. See [Schema Migration](procedures/schema-migration.md) for details.

### Media Store

Upload and manage files attached to entities. Files are stored in the filesystem with metadata in SQLite.

**Features:**
- Drag & drop file upload in entity forms
- Automatic thumbnail generation for images
- Directory hashing for scalability (256 buckets based on UUID prefix)
- Manifest files as safety net for database recovery
- Reference tracking to prevent orphaned files

**Storage Structure:**
```
system/data/media/
  originals/
    a5/                        # First 2 hex chars of UUID
      a5f3e2d1-...-....pdf
      manifest.json            # Safety net: original filenames, metadata
    b2/
      ...
  thumbnails/
    a5/
      a5f3e2d1-..._thumb.jpg
```

**API Endpoints:**
```
POST   /api/media              # Upload single file
POST   /api/media/from-url     # Upload from URL (server fetches)
POST   /api/media/bulk         # Upload multiple files (max 20)
GET    /api/media              # List all media (paginated)
GET    /api/media/:id          # Get metadata
GET    /api/media/:id/file     # Download/view file
GET    /api/media/:id/thumbnail # Get thumbnail (images only)
DELETE /api/media/:id          # Delete (admin, if unreferenced)
POST   /api/media/cleanup      # Remove orphaned files (admin)
POST   /api/media/rebuild-index # Rebuild DB from manifests (admin)
```

**Configuration** (optional in `config.json`):
```json
{
  "media": {
    "maxFileSize": "50MB",
    "maxBulkFiles": 20,
    "allowedTypes": ["image/*", "application/pdf", ".doc", ".docx"]
  }
}
```

**Field-Level Constraints:**

Control individual media fields with annotations:

| Annotation | Description | Example |
|------------|-------------|---------|
| `[SIZE=50MB]` | Max file size (B, KB, MB, GB) | `[SIZE=10MB]` |
| `[DIMENSION=800x600]` | Max image dimensions | `[DIMENSION=1920x1080]` |
| `[MAXWIDTH=800]` | Max image width only | `[MAXWIDTH=1200]` |
| `[MAXHEIGHT=600]` | Max image height only | `[MAXHEIGHT=800]` |
| `[DURATION=5min]` | Max audio/video duration (sec, min, h) | `[DURATION=30sec]` |

Example usage in DataModel.md:
```markdown
## Employee
| Attribute | Type | Description |
|-----------|------|-------------|
| photo | media | Profile picture [DIMENSION=400x400] [SIZE=2MB] |
| contract | media | Employment contract [SIZE=10MB] |
| intro_video | media | Introduction video [DURATION=2min] |
```

Images exceeding dimension constraints are automatically scaled down, preserving aspect ratio. Size and duration constraints trigger validation errors if exceeded.

**URL-based Media Seeding:**

Seed files can reference media by URL. The system automatically fetches and stores the files:
```json
[
  {
    "code": "USD",
    "name": "US Dollar",
    "bills": "https://example.com/usd-bills.jpg"
  }
]
```
