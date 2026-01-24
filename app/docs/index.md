# AIDE IRMA - Development Docs

**Rapid Application Development from Markdown**

> *Describe your data model in Markdown. Get a fully functional application with database, API, and UI – instantly.*

---

## The Vision

What if you could design your application's data model as naturally as writing documentation? No XML schemas, no code generation wizards, no framework boilerplate. Just describe what you need in plain Markdown, and watch as the system generates:

- **SQLite database** with proper constraints and relationships
- **REST API** with CRUD operations, filtering, and validation
- **Modern browser UI** with table views, tree navigation, and forms
- **Seed data** – either imported or AI-generated from your descriptions

This is the dream of what CASE tools in the 1990s wanted to be – now actually working.

---

## How It Works

### Data Model as Documentation

Define entities in simple Markdown tables. Foreign keys, types, and constraints are expressed naturally:

```markdown
# Aircraft

| Attribute     | Type            | Description                    |
|---------------|-----------------|--------------------------------|
| registration  | TailSign [LABEL]| Aircraft registration (D-AINA) |
| serial_number | MSN             | Manufacturer serial number     |
| type          | AircraftType    | ← Foreign key, just by name    |
| status        | OperationalStatus| Active, Grounded, or Retired  |
```

No `type_id INTEGER REFERENCES aircraft_type(id)` – just write `type: AircraftType` and the system handles the rest.

### Smart Type System

**Pattern Types** – Define validation patterns with regex:
```markdown
| Type     | Pattern           | Example   |
|----------|-------------------|-----------|
| TailSign | ^[A-Z]-[A-Z]{4}$  | D-AINA    |
| MSN      | ^MSN \d+$         | MSN 4711  |
```

**Enum Types** – Map internal values to display labels:
```markdown
| Internal | External  | Description           |
|----------|-----------|----------------------|
| 1        | Active    | Currently in service |
| 2        | Grounded  | Temporarily offline  |
| 3        | Retired   | Permanently removed  |
```

Validation happens identically on frontend (for UX) and backend (for integrity).

### Color-Coded Areas of Competence

Group related entities into colored areas. The colors flow through from your data model diagram into the UI – entity selector, tree nodes, and table headers all respect the grouping:

- **Fleet Management** (blue) – Aircraft, Registration, Operator
- **Technical Data** (green) – AircraftType, AircraftManufacturer
- **Maintenance** (orange) – MaintenanceEvent, MaintenanceType

---

## UI Features

### Three-View Entity Explorer

Switch seamlessly between viewing modes:

| View | Best For |
|------|----------|
| **Table** | Quick scanning, sorting, filtering |
| **Tree (Vertical)** | Deep relationship exploration |
| **Tree (Horizontal)** | Compact attribute display |

### Deep Relationship Traversal

The tree view doesn't stop at one level. Click any foreign key to expand it, then expand *its* foreign keys, and so on – as deep as you want to go:

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

### FK Label Resolution via SQL Views

Instead of showing raw IDs, the system creates database views that join display labels:

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

### Context Menu Actions

Right-click any record (in table or tree) for quick actions:
- **New** – Create a new record of this entity type
- **Details** – Read-only view in side panel
- **Edit** – Open form for modification
- **Delete** – With confirmation and FK constraint checking
- **Export CSV** – Download current table view as CSV (semicolon-separated, UTF-8)
- **Export PDF** – Download current table view as PDF

### PDF Export

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

### Admin Seed Manager

The Admin menu opens a dedicated interface for managing seed data across all entities:

**Entity Overview Table:**
- Shows all entities in dependency order
- **DB Rows** – Current record count in database
- **Seed Available** – Record count in seed file (or `--` if none)

**Context Menu Actions** (right-click on entity row):
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
- **Load All** – Load all available seed files
- **Clear All** – Clear all database tables
- **Reset All** – Clear then reload all seed data

---

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

## Architecture

```
aide-irma/
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
│   ├── static/irma/
│   │   ├── components/           # UI components (ES6 modules)
│   │   ├── irma.html             # Main page
│   │   └── irma.css              # Styling
│   └── data/
│       ├── irma.sqlite           # Database
│       └── seed/                 # Seed data (imported or AI-generated)
├── tools/                        # CLI utilities
└── aide-frame/                   # Framework (symlink)
```

### Data Flow

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

---

## Key Innovations

| Feature | Traditional Approach | AIDE Framework |
|---------|---------------------|----------------|
| Schema Definition | XML, YAML, or code | Markdown tables |
| FK Display | Raw IDs or extra queries | SQL Views with labels |
| Type Validation | Code annotations | Markdown patterns |
| Seed Data | Manual JSON files | AI-generated from descriptions |
| Relationship Navigation | Flat lists | Infinite-depth tree with cycle detection |
| Entity Grouping | Folder structure | Color-coded areas in UI |

---

## API Reference

```
GET    /api/entities                      # List entity types
GET    /api/entities/:entity/schema       # Schema metadata
GET    /api/entities/:entity/schema/extended  # + UI hints, enums, FK info
GET    /api/entities/:entity              # List records (filter, sort, page)
GET    /api/entities/:entity/:id          # Single record
GET    /api/entities/:entity/:id/references   # Back-references
POST   /api/entities/:entity              # Create (with validation)
PUT    /api/entities/:entity/:id          # Update (with validation)
DELETE /api/entities/:entity/:id          # Delete (with FK check)
```

**Filtering**: `?filter=column:value` or `?filter=searchterm` (LIKE search)
**Sorting**: `?sort=column&order=asc|desc`
**Pagination**: `?limit=50&offset=100`

---

## Configuration

Edit `app/config.json`:

```json
{
  "port": 18354,
  "crud": {
    "enabledEntities": ["Aircraft", "Operator", "Registration", ...]
  },
  "llm": {
    "active": "gemini",
    "providers": {
      "gemini": { "apiKey": "...", "model": "gemini-2.0-flash-lite" },
      "anthropic": { "apiKey": "...", "model": "claude-sonnet-4-20250514" }
    }
  }
}
```

---

## Feature Backlog

Ideas for future development:

### Export & Import
- [x] **CSV Export** – Table View context menu "Export CSV"
- [x] **PDF Export** – Table View context menu "Export PDF"
- [x] **TreeView PDF Export** – Exports currently expanded tree structure
- [ ] Detail Panel PDF Export

### Admin / Seed Data Manager
- [x] **Import Dialog** – Paste or drag & drop JSON/CSV, auto-detect format, FK validation preview
- [x] **Export Dialog** – Export seed file as JSON or CSV
- [x] **Load Preview** – Preview seed data before loading into database
- [x] **AI Generate** – LLM-powered seed data generation from entity descriptions
- [x] **Seed Context** – `## Seed Context` section for cross-entity validation constraints
- [x] **Context Menu** – Right-click on entity rows: Import, Export, Generate, Load, Clear

### UI Enhancements
- [ ] Keyboard shortcuts (arrow keys, Enter for details)
- [ ] Column visibility toggle
- [ ] Drag & Drop column reordering
- [ ] Saved filter presets
- [ ] Dark mode

### Visualization
- [ ] Simple charts (count by status, by type)
- [ ] Timeline view for date fields

---

## See Also

- [IRMA User Guide](/help) – How to use the demonstration application
- [aide-frame Repository](https://github.com/aide-examples/aide-frame) – The underlying framework
