# AIDE RAP - Platform Documentation

**Rapid Application Prototyping from Markdown**

> *Describe your data model in Markdown. Get a fully functional application with database, API, and UI – instantly.*

---

## The Vision

What if you could design your application's data model as naturally as writing documentation? No XML schemas, no code generation wizards, no framework boilerplate. Just describe what you need in plain Markdown, and watch as the system generates:

- **SQLite database** with proper constraints and relationships
- **REST API** with CRUD operations, filtering, and validation
- **Modern browser UI** with table views, tree navigation, and forms
- **Seed data** – either imported or AI-generated from your descriptions

This is the dream of what CASE tools in the 1990s wanted to be – now actually working.

| What you write | What you get |
|----------------|--------------|
| Markdown tables | SQLite with constraints |
| `type: AircraftType` | Foreign key with label resolution |
| `[DAILY=rule]` | Computed fields, auto-updated |
| `## Data Generator` | AI-generated test data |

There are two essential parts for each aide-rap system:
- The DESIGN DOCUMENTS which describe your system
- The RUNTIME ENVIRONMENT which populates the model with data and lets you work with it
---

# DESIGN DOCUMENTS

## How It Works

### Model Builder: AI-Assisted System Creation

The fastest way to start: describe your system in plain language, let AI generate the data model.

1. **Open Model Builder** (Seed Data → + New System)
2. **Write a Design Brief** in natural language:
   ```
   I need a library system: Authors write Books, Members borrow them.
   Track loan dates and return status.
   ```
3. **Copy the generated prompt** to Claude, ChatGPT, or any LLM
4. **Paste the AI response** (Mermaid ER diagram) back into the builder
5. **Import** → Entity files, DataModel.md, and seed files are created

See [Create New System](procedures/system-create.md) for the full workflow.

### Manual Modeling

You describe the data *Entities* of your system, grouping them into *Areas of Competence*.
You can use built-in *DataTypes* (like string, number, email, media, json, ..) and you can define your *Own Types* using *Enumerations* or *Regular Expressions* or *Numeric Ranges*. You define *Derived Attributes* to be computed on the server or on the client. You describe certain aspects of the *User Interface*, especially *Joined Views* which span a path over several Entities following their (foreign key) *Relations*.

Everything is described in *Markdown Documents* with a fairly simple syntax.

When you want to change your model, an AI assistant can guide you
because there is a set of pre-defined [procedures](/rap#procedures) for it which contains hints on how to handle typical steps like adding new Entities, renaming attributes and so on.

## Areas of Competence

First you define Areas which act as a semantic group of the Entities of your Data Model.
You assign a color code to each Area which will flow through from your data model diagram into the UI of the running system – entity selector, tree nodes, and table headers all respect the grouping.

Example from IRMA (engine management system):
- **OEM** (blue) – AircraftOEM, AircraftType, EngineOEM, EngineType
- **Operations** (green) – CAMO, Airline, Operator, Aircraft, Registration
- **Engine Management** (orange) – Engine, EngineLease, EngineEvent, EngineAllocation
- **Maintenance** (purple) – MRO, RepairShop, Workscope

## Data Model

Define entities in simple Markdown tables. Foreign keys, types, and constraints are expressed naturally.

```markdown
### Aircraft (Example)

| Attribute     | Type            | Description                    | Example  |
|---------------|-----------------|--------------------------------|----------|
| registration  | TailSign [LABEL]| Aircraft registration          | D-AINA   |
| serial_number | MSN             | Manufacturer serial number     | 7-13     |
| type          | AircraftType    | Refers to a different entity   | A-320    |
| status        | AcStatus        | Active, Grounded, or Retired   | Grounded |
```
The database will use internal ids to uniquely identify objects and to create
foreign key relations, but there is no need to define this in the Entity document.
No `type_id INTEGER REFERENCES aircraft_type(id)` – just write `type: AircraftType` 
and the system handles the rest.

## Smart Type System

**Pattern Types** – Define validation patterns with regex:
```markdown
| Type     | Pattern           | Example   |
|----------|-------------------|-----------|
| TailSign | ^[A-Z]-[A-Z]{4}$  | D-AINA    |
| MSN      | ^MSN \d+$         | MSN 4711  |
```

**Enum Types** – Map internal values to display labels:
```markdown

**AcStatus**

| Internal | External  | Description           |
|----------|-----------|----------------------|
| 1        | Active    | Currently in service |
| 2        | Grounded  | Temporarily offline  |
| 3        | Retired   | Permanently removed  |
```

Validation happens identically on frontend (for UX) and backend (for integrity).

## Built-in Types – Ready to use without defining:

| Type | Storage | Validation | UI Display |
|------|---------|------------|------------|
| `int` | INTEGER | Must be a number | Number input |
| `string` | TEXT | Must be a string | Text input |
| `date` | TEXT | YYYY-MM-DD format | Date picker |
| `bool` | INTEGER | true/false | Checkbox |
| `json` | TEXT | Valid JSON | Pretty-printed code block |
| `url` | TEXT | http(s):// URL | Clickable link |
| `mail` | TEXT | Valid email | Mailto link |
| `media` | TEXT (UUID) | Valid media reference | Thumbnail/download link |

Example usage:
```markdown
| Attribute | Type | Description |
|-----------|------|-------------|
| website | url | Company website |
| contact | mail | Support email |
| metadata | json | Additional data |
| attachment | media | Uploaded file |
```

# RUNTIME ENVIRONMENT

## Relational Database

AIDE RAP generates DDL for a database system (SQLite at the moment).
It provides a Web API for CRUD actions and for reading joined views.
It also handles defined rules for derived read-only attributes which
improve performance and readability. The database handles updates
with optimistic concurrency control and keeps track of changes in
an audit trail. It uses internal keys to identify objects and foreign
key relationships. It offers backup, restore and loading from JSON
data with "natural keys" resolving them to internal identifiers.

## User Interface

### Three-View Entity Explorer

Switch seamlessly between viewing modes:

| View | Best For |
|------|----------|
| **Table** | Quick scanning, sorting, filtering |
| **Tree (Vertical)** | Deep relationship exploration |
| **Tree (Horizontal)** | Compact attribute display |

**Deep Relationship Traversal:** The tree view doesn't stop at one level. Click any foreign key to expand it, then expand *its* foreign keys, and so on – as deep as you want to go:

```
Aircraft D-AINA
  └─ type: Airbus A320neo
       └─ manufacturer: Airbus SE
            └─ Aircraft [5] ← back-references!
                 └─ D-AINB
                      └─ operator: Lufthansa
                           └─ ...
```

**Cycle Detection** prevents infinite loops – if you'd circle back to an already-visited record, you'll see a ↻ marker instead of an expand arrow.

**Focused Navigation** keeps the tree manageable – opening a new branch automatically closes sibling branches.

**FK Label Resolution:** Instead of showing raw IDs, the system creates database views that join display labels:

```sql
-- Auto-generated view
CREATE VIEW aircraft_view AS
SELECT a.*,
       t.designation AS type_label,
       o.name AS operator_label
FROM aircraft a
LEFT JOIN aircraft_type t ON a.type_id = t.id
LEFT JOIN operator o ON a.operator_id = o.id
```

One query returns everything the UI needs – no N+1 problems.

### User Views (Cross-Entity Join Tables)

Define read-only views in `config.json` that join data across entities via FK chains:

```json
{
    "name": "Engine Status",
    "base": "EngineAllocation",
    "columns": [
        "engine.serial_number AS ESN",
        "engine.type.thrust_lbs AS Thrust",
        "mount_position AS pos OMIT 0"
    ]
}
```

- **Dot-notation paths** follow FK relationships: `engine.type.thrust_lbs` → EngineAllocation → Engine → EngineType
- **AS alias** for custom column headers
- **OMIT** suppresses specific values from display (FK columns default to `OMIT null`)
- Materialized as SQL views (`uv_*`) at startup — no runtime overhead
- Separate **Views dropdown** (blue) left of the entity selector
- Full column filtering and sorting, same as entity tables
- Row click jumps to the base entity's edit form

**Back-Reference Columns** pull data from child entities that point *to* the base entity via FK — implemented as correlated SQL subqueries:

```json
{
    "name": "Engine Overview",
    "base": "Engine",
    "columns": [
        "serial_number AS ESN",
        "type.designation AS Type",
        "EngineAllocation<engine(COUNT) AS Allocations",
        "EngineEvent<engine(COUNT) AS Events OMIT 0",
        "EngineAllocation<engine(WHERE end_date=null, LIMIT 1).aircraft.registration AS Current Aircraft"
    ]
}
```

Syntax: `Entity<fk_field(params).column`

| Part | Description | Example |
|------|-------------|---------|
| `Entity` | Child entity with FK to base | `EngineAllocation` |
| `<fk_field` | FK column pointing to base (without `_id`) | `<engine` |
| `(params)` | Comma-separated: `COUNT`, `LIST`, `WHERE col=val`, `ORDER BY col`, `LIMIT n` | `(WHERE end_date=null, LIMIT 1)` |
| `.column` | Target column, supports FK-chain dot-paths | `.aircraft.registration` |

See [Views Configuration](procedures/views-config.md) for the full syntax reference.

### Context Menu

Right-click any record (in table or tree) for quick actions:
- **New** – Create a new record of this entity type
- **Details** – Read-only view in side panel
- **Edit** – Open form for modification
- **Delete** – With confirmation and FK constraint checking
- **Export CSV** – Download current table view as CSV (semicolon-separated, UTF-8)
- **Export PDF** – Download current table view as PDF

### Export (PDF, CSV)

Export the current table view to a professionally formatted PDF:

- **A4 Landscape** layout for maximum column space
- **Entity color** in title bar and column headers
- **FK column colors** match their target entity's area color
- **Dynamic column widths** based on content
- **Filtered data** – exports only what's currently visible
- **FK labels** instead of raw IDs
- **Enum conversion** – shows external values, not internal codes
- **Automatic page breaks** with header repetition
- **Page numbers** on each page

**TreeView PDF Export:**

When in Tree View mode, PDF export captures the currently expanded structure:
- Exports only what's visible (expanded nodes)
- Uses indentation to show hierarchy depth
- Includes symbols for relationships: `▸` root, `→` FK, `←` back-reference, `↻` cycle
- Respects current sort settings (attribute order, reference position)

---

## Admin Tools

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


## Advanced Features

### Computed Foreign Keys

Express dynamic relationships that depend on time:

```markdown
current_operator: Operator [DAILY=Registration[exit_date=null OR exit_date>TODAY].operator]
```

This calculates the current operator by finding the active Registration assignment – recalculated daily to handle future-dated changes.

### AI-Powered Seed Data Generation

Each entity can include generation instructions:

```markdown
## Data Generator
Generate 10 realistic German aircraft registrations with various
operational statuses. Use actual Airbus and Boeing type designations.
```

The system sends your schema + instructions to an LLM (Gemini or Claude) and receives properly structured JSON. Foreign keys can use display labels (`"operator": "Lufthansa"`) – the system resolves them to IDs automatically.

### Dual-Layer Validation

The same validation rules run in both places:
- **Frontend**: Instant feedback while typing
- **Backend**: Security and integrity guarantee

Pattern regex, required fields, enum constraints, min/max values – all defined once in your Markdown, enforced everywhere.

### Visual Diagram Editor

Design your data model visually with an interactive layout editor:

- **Drag & Drop**: Position entity boxes freely on a canvas
- **Auto-generated SVG**: Class diagrams rendered from your Markdown definitions
- **Relationship Lines**: Foreign key connections drawn automatically
- **Area Grouping**: Color-coded backgrounds show entity groupings
- **Two Detail Levels**: Compact (names only) or detailed (with attributes)
- **Persistent Layout**: Positions saved in `layout.json`, diagrams regenerated on change
- **Entity Cards PDF**: Printable cards for each entity (32pt name, FK indicators, space for notes) – cut out for physical magnet board modeling

The workflow:
1. Define entities in Markdown (the source of truth)
2. Open the Layout Editor to arrange boxes visually
3. Save → SVG diagrams regenerate automatically
4. Diagrams embed in documentation with live links

This approach keeps documentation and diagrams in sync – change the Markdown, regenerate the diagram. No manual drawing tools needed.

*Future potential: The same pattern could support state diagrams, sequence diagrams, or other UML artifacts – all driven by Markdown definitions with visual layout.*

---

# TECHNICAL REFERENCE

## Architecture

```
your-system/
├── app/
│   ├── docs/requirements/
│   │   ├── DataModel.md          # Visual data model with areas
│   │   ├── Types.md              # Global type definitions
│   │   └── classes/              # Entity Markdown files
│   │       ├── Aircraft.md
│   │       ├── Operator.md
│   │       └── ...
│   ├── server/
│   │   ├── routers/              # REST API endpoints
│   │   ├── services/             # Business logic + LLM integration
│   │   ├── repositories/         # Data access layer
│   │   └── utils/                # Schema generation, logging
│   ├── shared/
│   │   ├── types/                # TypeRegistry, TypeParser
│   │   └── validation/           # ObjectValidator (isomorphic)
│   ├── static/<system>/
│   │   ├── components/           # UI components (ES6 modules)
│   │   ├── <system>.html         # Main page
│   │   └── <system>.css          # Styling
│   └── data/
│       ├── <system>.sqlite       # Database
│       └── seed/                 # Seed data (imported or AI-generated)
├── tools/                        # CLI utilities
└── aide-frame/                   # Framework (symlink)
```

## Data Flow

```
Markdown Definition
       ↓
  SchemaGenerator
       ↓
  ┌────┴────┐
  ↓         ↓
SQLite    REST API
  ↓         ↓
Views    Extended Schema
  └────┬────┘
       ↓
   Browser UI
```

## API Reference

```
GET    /api/entities                      # List entity types
GET    /api/entities/:entity/schema       # Schema metadata
GET    /api/entities/:entity/schema/extended  # + UI hints, enums, FK info
GET    /api/entities/:entity              # List records (filter, sort, page)
GET    /api/entities/:entity/:id          # Single record (ETag header for OCC)
GET    /api/entities/:entity/:id/references   # Back-references
POST   /api/entities/:entity              # Create (with validation)
PUT    /api/entities/:entity/:id          # Update (If-Match header for OCC)
DELETE /api/entities/:entity/:id          # Delete (with FK check)

GET    /api/views                         # List views with groups/colors
GET    /api/views/:name                   # Query view data (filter, sort, page)
GET    /api/views/:name/schema            # View column metadata

GET    /api/audit                         # Audit trail (readonly)
GET    /api/audit/:id                     # Single audit entry
GET    /api/audit/schema/extended         # Audit schema for UI
```

**Filtering**: `?filter=column:value` or `?filter=searchterm` (LIKE search)
**Sorting**: `?sort=column&order=asc|desc`
**Pagination**: `?limit=50&offset=100`
**OCC**: PUT with `If-Match: "Entity:id:version"` → 409 on conflict

---

## Configuration

### System Configuration

Each system has its own `config.json` in `app/systems/<name>/`.
Use `app/config_sample.json` as template for new systems.

```json
{
  "port": 18354,
  "log_level": "INFO",
  "titleHtml": "<img src='/icons/logo.png'>My System",
  "auth": {
    "enabled": true,
    "passwords": { "admin": "<sha256-hash>", "user": "" },
    "sessionSecret": "change-in-production",
    "sessionTimeout": 86400
  },
  "pagination": { "threshold": 100, "pageSize": 100 },
  "pwa": {
    "enabled": true,
    "name": "My System",
    "short_name": "SYS",
    "theme_color": "#2563eb"
  },
  "layout": { "default": "page-fill", "allow_toggle": false },
  "docsEditable": true,
  "helpEditable": false
}
```

### UI Configuration (Markdown)

Entity visibility and views are defined in `docs/requirements/ui/`:

**Crud.md** — Which entities appear in the UI:
```markdown
# CRUD

## Engine Management
- Engine
- EngineEvent

## Operations
- Aircraft
- Operator
```

**Views.md** — Cross-entity join views:
```markdown
# Views

## Engine Management

### Engine Status
```
```json
{ "base": "EngineAllocation", "columns": ["engine.serial_number AS ESN", "aircraft.registration"] }
```

See [Views Configuration](procedures/views-config.md) for the full syntax.

### Authentication

Enable authentication in `config.json`:

```json
{
  "auth": {
    "enabled": true,
    "passwords": {
      "admin": "<sha256-hash>",
      "user": "",
      "guest": ""
    },
    "sessionSecret": "change-in-production",
    "sessionTimeout": 86400
  }
}
```

**Generate password hash:**
```bash
node app/tools/generate-password-hash.js mypassword
# Output: 5e884898da28047d1650f25e4ca478eb...
```

**Roles:**
- `admin` – Full access, always requires password
- `user` – Standard access, password optional (empty = no password required)
- `guest` – Read-only access, password optional

**URL-Login for Bookmarks:**
```
http://server/?user=admin&password=mypassword
http://server/?user=admin&pwh=5e884898da28047d...
```

Passwords are hashed client-side (SHA-256) before transmission. URL is cleaned after login to prevent credentials in browser history.

**Disable auth:** Start server with `--noauth` flag or set `"enabled": false`.

---

# FEATURE BACKLOG

Ideas for future development:

### Export & Import
- [x] **CSV Export** – Table View context menu "Export CSV"
- [x] **PDF Export** – Table View context menu "Export PDF"
- [x] **TreeView PDF Export** – Exports currently expanded tree structure
- [ ] Detail Panel PDF Export

### Admin / Seed Data Manager
- [x] **Import Dialog** – Paste or drag & drop JSON/CSV, auto-detect format, FK validation preview
- [x] **Export Dialog** – Export seed file as JSON or CSV
- [x] **Load Preview** – Preview seed data before loading into database with conflict detection
- [x] **AI Generate** – LLM-powered seed data generation from entity descriptions
- [x] **Seed Context** – `## Seed Context` section for cross-entity validation constraints
- [x] **Context Menu** – Right-click on entity rows: Import, Export, Generate, Load, Clear
- [x] **Duplicate Detection** – Business key matching on load (LABEL column fallback)
- [x] **Load Modes** – Skip conflicts / merge / replace with user choice in preview
- [x] **FK Label Fallback** – Resolves `engine_id: "GE-900101"` (technical name with label)
- [x] **Computed FK Support** – READONLY FK columns included in AI prompts and seed loading
- [x] **Seed File FK Fallback** – Load FK references from seed files when DB table is empty

See [Seed Data Reference](seed-data.md) for technical details.

### User Views
- [x] **Cross-Entity Views** – Dot-notation FK paths, SQL view materialization, separate dropdown
- [x] **OMIT Value Suppression** – Per-column `OMIT <value>`, FK default `OMIT null`
- [x] **Row-Click Navigation** – Jump from view row to base entity edit form
- [x] **Back-Reference Columns** – Inbound FK subqueries (`Entity<fk(params).column`), COUNT/LIST/scalar, FK-following within subquery
- [x] **Aggregation** – COUNT and GROUP_CONCAT (LIST) via back-reference columns
- [x] **Filter Dialogs** – Pre-load filters for large datasets with text input (LIKE), dropdown (exact match), or date extraction (year/month)
- [ ] **View-Guided Tree** – Render User View columns as hierarchical tree (FK paths become expandable branches, leaves show only view-selected attributes). Usefulness TBD.

See [Views Configuration](procedures/views-config.md) for syntax details.
See [Filter Dialogs](procedures/filter-dialogs.md) for pre-load filter configuration.

### UI Enhancements
- [ ] Keyboard shortcuts (arrow keys, Enter for details)
- [ ] Column visibility toggle
- [ ] Drag & Drop column reordering
- [ ] Saved filter presets
- [ ] Dark mode
- [ ] Accessibility (ARIA labels, high-contrast mode, screen reader support)

### Visualization
- [ ] Simple charts (count by status, by type)
- [ ] Timeline view for date fields

---

# Reference & Procedures

### Technical Framework

- [aide-frame Repository](https://github.com/aide-examples/aide-frame) – The underlying framework

### Reference

- [Attribute Markers](attribute-markers.md) – `[LABEL]`, `[READONLY]`, `[UNIQUE]`, `[DEFAULT=x]`, and more
- [Computed References](computed-references.md) – `[DAILY=rule]`, `[IMMEDIATE=rule]` for algorithmically computed FK relationships
- [Seed Data](seed-data.md) – Import, export, and AI-generate test data

### Procedures

- [Create New System](procedures/system-create.md) – AI-assisted system creation via Model Builder
- [Add Entity](procedures/entity-add.md) – Step-by-step guide for adding new entities
- [Add Attribute](procedures/attribute-add.md) – Adding attributes to existing entities
- [Diagram Workflow](procedures/diagram-workflow.md) – Creating and editing data model diagrams
- [Database Features](procedures/database-features.md) – WAL mode, system columns, optimistic concurrency, audit trail
- [Views Configuration](procedures/views-config.md) – Cross-entity join views with dot-notation FK paths
- [Filter Dialogs](procedures/filter-dialogs.md) – Pre-load filters for large datasets (required/prefilter, text/dropdown/year/month, AND logic)
- [Schema Migration](procedures/schema-migration.md) – Reinitialize database schema without server restart
