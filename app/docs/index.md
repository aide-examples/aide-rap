# AIDE RAP - Platform Documentation

**Rapid Application Prototyping from Markdown**

> *Describe your data model in Markdown. Get a fully functional application with database, API, and UI – instantly.*

---

## The Vision

What if you could design your application as naturally as writing documentation? No XML schemas, no code generation wizards, no framework boilerplate. Just describe what you need in plain Markdown, and watch as the system generates:

- **SQLite database** with proper constraints and relationships
- **REST API** with CRUD operations, filtering, and validation
- **Modern browser UI** with table views, tree navigation, and forms
- **Views & processes** - define use cases with links to complex views 
- **Visualize data** by defining graph diagrams and geo maps
- **connect data sources** using AI-generated seeds or configurable imports
This is the dream of what CASE tools in the 1990s wanted to be – now actually working.

| What you write | What you get |
|----------------|--------------|
| Markdown tables | SQLite with constraints |
| `department: Department` | Foreign key with label resolution |
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

Example from a project management system:
- **Organization** (blue) – Company, Department, Client, ProjectType
- **People** (green) – Division, Team, Manager, Employee, Assignment
- **Projects** (orange) – Project, Contract, Milestone, Deployment
- **Services** (purple) – Vendor, Office, TaskTemplate

## Data Model

Define entities in simple Markdown tables. Foreign keys, types, and constraints are expressed naturally.

```markdown
### Employee (Example)

| Attribute     | Type            | Description                    | Example    |
|---------------|-----------------|--------------------------------|------------|
| emp_code      | EmpCode [LABEL] | Employee code                  | EMP-1042   |
| name          | string          | Full name                      | Sarah Chen |
| department    | Department      | Refers to a different entity   | Marketing  |
| status        | EmpStatus       | Active, On Leave, or Departed  | Active     |
```
The database will use internal ids to uniquely identify objects and to create
foreign key relations, but there is no need to define this in the Entity document.
No `department_id INTEGER REFERENCES department(id)` – just write `department: Department`
and the system handles the rest.

## Smart Type System

**Pattern Types** – Define validation patterns with regex:
```markdown
| Type       | Pattern              | Example      |
|------------|----------------------|--------------|
| EmpCode    | ^EMP-\d{4}$          | EMP-1042     |
| ProjectRef | ^PRJ-\d{4}-\d{3}$    | PRJ-2024-001 |
```

**Enum Types** – Map internal values to display labels:
```markdown

**EmpStatus**

| Internal | External  | Description             |
|----------|-----------|-------------------------|
| 1        | Active    | Currently employed       |
| 2        | On Leave  | Temporarily unavailable  |
| 3        | Departed  | No longer with company   |
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

## Aggregate Types – Composite Fields

Some data naturally groups together – like GPS coordinates (latitude + longitude) or addresses (street, city, zip, country). Aggregate types let you define these as a single logical field that expands to multiple database columns.

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| position | geo | GPS coordinates | 48.1371, 11.5754 |
```

The system automatically:
- Creates `position_latitude` and `position_longitude` columns in the database
- Accepts nested objects in seed data: `"position": { "latitude": 48.1, "longitude": 11.5 }`
- Displays as one canonical column in tables: "48.1371, 11.5754"
- Groups subfields in edit forms

| Aggregate | Expands to | Status |
|-----------|------------|--------|
| `geo` | `{name}_latitude`, `{name}_longitude` | Available |
| `address` | `{name}_street`, `{name}_city`, `{name}_zip`, `{name}_country` | Available |

See [Aggregate Types](aggregate-types.md) for full reference.

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

Three-view Entity Explorer (Table, Tree Vertical, Tree Horizontal), breadcrumb navigation with deep linking and QR sharing, cross-entity User Views with dot-notation FK paths, context menus, and export to PDF/DOCX/XLSX/CSV.

See [User Interface](user-interface.md) for details.

---

## Admin Tools

Seed Manager for import/export/backup/restore of data, Media Store for file uploads with thumbnails and dimension constraints, AI-powered seed data generation, and schema reinitialization without server restart.

See [Admin Tools](admin-tools.md) for details.

## Advanced Features

### Computed Foreign Keys

Express dynamic relationships that depend on time:

```markdown
current_department: Department [DAILY=Assignment[end_date=null OR end_date>TODAY].department]
```

This calculates the current department by finding the active Assignment record – recalculated daily to handle future-dated changes.

### AI-Powered Seed Data Generation

Each entity can include generation instructions:

```markdown
## Data Generator
Generate 10 realistic employee records with various departments
and employment statuses. Use diverse names and realistic job titles.
```

The system sends your schema + instructions to an LLM (Gemini or Claude) and receives properly structured JSON. Foreign keys can use display labels (`"department": "Marketing"`) – the system resolves them to IDs automatically.

### Dual-Layer Validation

The same `ObjectValidator` and validation rules run in both places:
- **Frontend**: On-blur field validation + pre-submit check — instant feedback without server roundtrip
- **Backend**: Security and integrity guarantee — always authoritative

The isomorphic `ObjectValidator` (in `shared/validation/`) works identically in Node.js and the browser. Rules are generated once from Markdown by `SchemaGenerator`, delivered via `/api/meta`, and loaded into `SchemaCache` on the client. Pattern regex, required fields, enum constraints — all defined once, enforced everywhere.

In addition to single-field rules, **object-level constraints** (`## Constraints` section) validate cross-field relationships: `TimeRange(start_date, end_date)`, `NumericRange(min, max)`, and custom JS snippets with multilingual error messages. Custom JS constraints can use `lookup(entityName, id)` for cross-entity validation (server-side with batch cache). See [validation.md](validation.md) for full documentation.

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

### System Landscape Diagrams

Beyond data models, the same diagram infrastructure supports **System Landscape** diagrams – visualizing IT systems and their data flows.

**Overview file** (`docs/SystemLandscape.md`):
```markdown
# System Landscape

## System Diagram

### Engine Management
<div style="background-color: #FCE5CD;">

| System | Description |
|--------|-------------|
| IRMA | Engine management system |

</div>
```

Uses the same area format as `DataModel.md` – same area names, same colors. The `## System Diagram` marker (instead of `## Entity Descriptions`) tells the layout editor to load the system model.

**System files** (`docs/systems/SystemName.md`):
```markdown
# SystemName

Description of the system.

#### Long Name
Full system name

#### Owner
Department / Organization

#### Vendor
Internal Development | Vendor Name

#### Technical Platform
Node.js / Oracle / SAP / ...

#### Access
https://system.example.com

#### Contact
Responsible person

## Flow: Data Flow Name

Description of what data is sent.

| Receiver | Trigger | Format | Transport |
|----------|---------|--------|-----------|
| OtherSystem | daily 06:00 UTC | JSON | API-SEND |
| ThirdSystem | on event | XML | UPLOAD |

## Input

| Source | Content | Trigger | Format |
|--------|---------|---------|--------|
| Excel upload | Master data | manual | XLSX |
```

**Key concepts:**
- Each system is described in its own Markdown file under `docs/systems/`
- `####` sections define system properties (flexible, not a rigid schema)
- `## Flow: Name` chapters describe **outgoing** data flows
- Each flow has a description and a receiver table – a flow can have **multiple receivers**
- `## Input` section lists external data sources without a defined system
- In the diagram: systems render as boxes, flows as attributes, receiver connections as lines
- Lines from one flow can go in **both directions** (left and right) depending on receiver positions

#### Format & Transport Icons

In **detail view**, each flow name is followed by small icons showing the data **format** and **transport method**. The keywords come from the `Format` and `Transport` columns of the receiver table.

**Perspective rule:** Keywords always describe the flow from the **data owner's** perspective – the system that defines the flow.

**Format keywords** (what is sent):

| Keyword | Description |
|---------|-------------|
| `JSON` | JSON data |
| `XML` | XML document |
| `XLSX` | Excel spreadsheet |
| `CSV` | Comma-separated values |
| `PDF` | PDF document |
| `DOCX` | Word document |

**Transport keywords** (how the data reaches the receiver):

| Keyword | Initiative | Description |
|---------|-----------|-------------|
| `MAIL` | Ours | We send the data by email |
| `API-SEND` | Ours | We push data via API call to the receiver |
| `UPLOAD` | Ours | We place the data in the receiver's inbox (file transfer) |
| `API-RESPONSE` | Theirs | The receiver requests data via API, we respond |
| `DOWNLOAD` | Theirs | The receiver pulls the data from us (file transfer) |

*"Ours"* = The data owner initiates the transfer.
*"Theirs"* = The receiver initiates the transfer, we deliver.

Icons are rendered as small SVGs (12×12 px) right-aligned in the flow slot. They appear in both the interactive canvas and the exported SVG. In **compact view**, flows are hidden, so no icons are shown.

Icon definitions live in `app/static/rap/diagram/FlowIcons.js`. Static SVG files are in `app/static/icons/flow/`.

**How it maps to the layout editor model:**

| System concept | Layout model | Diagram |
|----------------|-------------|---------|
| System | class (box) | Colored box with area color |
| Outgoing Flow | attribute | Flow name in box + format/transport icons |
| Flow → Receiver | relationship | Arrow from flow to receiver box |
| Area | area | Background color grouping |

---

# TECHNICAL REFERENCE

## Architecture

```
aide-rap/
├── app/
│   ├── server/
│   │   ├── routers/              # REST API endpoints
│   │   ├── services/             # Business logic + LLM integration
│   │   ├── repositories/         # Data access layer
│   │   └── utils/                # Schema generation, import, logging
│   ├── shared/
│   │   ├── types/                # TypeRegistry, TypeParser
│   │   └── validation/           # ObjectValidator (isomorphic)
│   ├── static/rap/
│   │   ├── components/           # UI components (JS modules)
│   │   ├── rap.html              # Main page
│   │   └── rap.css               # Styling
│   ├── docs/                     # RAP platform documentation
│   └── systems/
│       └── <name>/               # One directory per system
│           ├── docs/
│           │   ├── DataModel.md          # Data model with areas
│           │   ├── SystemLandscape.md    # IT systems and data flows
│           │   ├── Types.md              # Custom type definitions
│           │   ├── Crud.md               # Entity selector layout
│           │   ├── Views.md              # View selector layout
│           │   ├── Processes.md          # Process selector layout
│           │   ├── classes/              # Entity Markdown files
│           │   ├── systems/              # System Markdown files
│           │   ├── views/                # View definitions (by area)
│           │   ├── processes/            # Process guides (by area)
│           │   └── imports/              # XLSX import definitions
│           ├── data/
│           │   ├── rap.sqlite            # Database
│           │   ├── seed/                 # Seed data (JSON)
│           │   ├── media/                # Uploaded files
│           │   ├── backup/               # DB backup exports
│           │   ├── import/               # Imported data (JSON)
│           │   └── extern/               # Source files (XLSX)
│           ├── help/                     # Context help pages
│           ├── icons/                    # System-specific icons
│           └── config.json               # System configuration
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
GET    /api/entities/:entity/:id/lineage     # Ancestor chain (hierarchical entities)
POST   /api/entities/:entity              # Create (with validation)
PUT    /api/entities/:entity/:id          # Update (If-Match header for OCC)
DELETE /api/entities/:entity/:id          # Delete (with FK check)

GET    /api/views                         # List views with groups/colors
GET    /api/views/:name                   # Query view data (filter, sort, page)
GET    /api/views/:name/schema            # View column metadata

GET    /api/processes                     # List processes with groups/colors
GET    /api/processes/:name               # Get full process (steps, markdown)

GET    /api/audit                         # Audit trail (readonly)
GET    /api/audit/:id                     # Single audit entry
GET    /api/audit/schema/extended         # Audit schema for UI
```

**Filtering**: `?filter=column:value` or `?filter=type_id:1,3,7` (IN match) or `?filter=searchterm` (LIKE search)
**Sorting**: `?sort=column&order=asc|desc`
**Pagination**: `?limit=50&offset=100`
**OCC**: PUT with `If-Match: "Entity:id:version"` → 409 on conflict

---

## Configuration

System configuration via `config.json` (port, pagination, PWA, layout), role-based authentication with SHA-256 password hashing, and UI layout via Markdown files (`Crud.md`, `Views.md`, `Processes.md`).

See [Configuration](configuration.md) for the full reference.

# Reference & Procedures

### Technical Framework

- [aide-frame Repository](https://github.com/aide-examples/aide-frame) – The underlying framework

### Reference

- [User Interface](user-interface.md) – Entity Explorer, breadcrumbs, views, context menus, export
- [Configuration](configuration.md) – System config, pagination, authentication, UI layout files
- [Admin Tools](admin-tools.md) – Seed Manager, Media Store, bulk operations
- [Scalar Types](scalar-types.md) – `int`, `number`, `string`, `date`, `bool` – built-in attribute types
- [Attribute Markers](attribute-markers.md) – `[LABEL]`, `[READONLY]`, `[UNIQUE]`, `[DEFAULT=x]`, `[MIN=x]`, `[MAX=x]`, and more
- [Aggregate Types](aggregate-types.md) – `geo`, `address`, and custom composite types
- [Computed References](computed-references.md) – `[DAILY=rule]`, `[IMMEDIATE=rule]` for algorithmically computed FK relationships
- [Computed Entities](attribute-markers.md#computed-entity-pairs) – `[PAIRS=Source(chain1, chain2)]` for auto-derived M:N mapping tables
- [Calculations](calculations.md) – `## Client Calculations` and `## Server Calculations` for derived field values
- [Import System](import-system.md) – XLSX import pipeline with transforms, filters, and source expressions
- [Seed Data](seed-data.md) – Import, export, and AI-generate test data

### Operations

- [Deployment](deployment.md) – Package, deploy (Node.js or Docker), update, and export pre-built images

### Procedures

- [Create New System](procedures/system-create.md) – AI-assisted system creation via Model Builder
- [Add Entity](procedures/entity-add.md) – Step-by-step guide for adding new entities
- [Add Attribute](procedures/attribute-add.md) – Adding attributes to existing entities
- [Diagram Workflow](procedures/diagram-workflow.md) – Creating and editing data model diagrams
- [Database Features](procedures/database-features.md) – WAL mode, system columns, optimistic concurrency, audit trail
- [Views Configuration](procedures/views-config.md) – Cross-entity join views with dot-notation FK paths
- [Filter Dialogs](procedures/filter-dialogs.md) – Pre-load filters for large datasets (required/prefilter, text/dropdown/year/month, AND logic)
- [Schema Migration](procedures/schema-migration.md) – Reinitialize database schema without server restart

---

# Ideas

- Detail Panel PDF Export
- Process Context – Required initial object selection, context accumulation across steps
- Breadcrumb Cooperation – Process learns context from user navigation via breadcrumb entries
- Keyboard shortcuts (arrow keys, Enter for details)
- Column visibility toggle
- Drag & Drop column reordering
