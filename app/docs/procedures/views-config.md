# User Views

> Cross-entity read-only tables defined via dot-notation path expressions.

## Overview

User Views join data across entities using FK relationships and display the result as a flat, read-only table in the UI. They are materialized as SQL views (`uv_*`) at server startup and appear in a separate **Views** dropdown left of the entity selector.

Clicking a row in a view jumps to the base entity's edit form in the detail panel.

---

## Directory Structure

Views are defined as individual Markdown files in `docs/views/`:

```
docs/views/
├── Projects/                   ← Area (dropdown separator)
│   ├── Project Status.md       ← View file
│   ├── Project Overview.md
│   └── Equipment by Type.md
├── Finance/
│   └── Exchange Rates.md
└── People/
    └── Staff Overview.md
```

**Conventions:**
- **Area = subdirectory name** (becomes dropdown separator)
- **View name = H1 header** (or filename without `.md`)
- Areas and views are sorted alphabetically

---

## View File Format

Each view is a Markdown file containing an H1 header (view name), an optional description line, a JSON block (view definition), and optionally a JS block (calculator):

```markdown
# Project Status

Overview of all projects with type and client information.

```json
{
  "base": "Project",
  "columns": [
    "project_ref",
    "hours_worked",
    "type.name AS Project Type",
    { "path": "type.client.name", "label": "Client" }
  ]
}
```

```js
// Optional: client-side calculator for row styling
for (const row of data) {
  row._rowClass = row['Hours Worked'] > 1000 ? 'highlight' : '';
}
```
```

### Description

A single text line between the H1 header and the JSON block serves as the view **description**. It is optional and used in three places:

1. **View dropdown**: Shown as subtitle below the view name and as tooltip on hover
2. **Breadcrumb**: Shown as tooltip when hovering over the view crumb
3. **Chart title**: Automatically used as Vega-Lite chart title when no explicit `title` is set in the `chart` object

```markdown
# AC Lease Distribution

Distribution of currently active aircraft leases by lessor.

```json
{ ... }
```
```

If omitted, no tooltip or subtitle is shown, and charts have no auto-title.

### View Object (JSON block)

| Key | Required | Description |
|-----|----------|-------------|
| `base` | Yes | Base entity (PascalCase). Determines the SQL base table, area color, and row-click target |
| `columns` | Yes | Array of column definitions (see below) |
| `sort` | No | Default sort column and order (see [Default Sorting](#default-sorting)) |
| `filter` | No | SQL WHERE clause for view-level filtering (see [View Filter](#view-filter)) |
| `requiredFilter` | No | Fields requiring user filter before loading (always shows dialog) |
| `prefilter` | No | Fields for optional prefilter (dialog shown when dataset is large) |

The `name` property is extracted from the H1 header (or filename) and the `description` from the text line after the header, so neither is needed in the JSON block.

---

## Column Syntax

Each entry in the `columns` array can be one of three formats:

### 1. Simple column (direct attribute)

```json
"project_ref"
```

References a column directly on the base entity. The display label is auto-generated via title-case: `project_ref` → **Project Ref**.

### 2. Dot-path with AS alias

```json
"type.name AS Project Type"
```

Follows the FK chain and assigns a custom display label. The `AS` keyword is case-insensitive.

### 3. Object format

```json
{ "path": "type.client.name", "label": "Client" }
```

Explicit path and label. Equivalent to `"type.client.name AS Client"`.

### OMIT — Value Suppression

The `OMIT` keyword suppresses specific values from display, rendering the cell as blank.

**String syntax** — append `OMIT <value>` after the column (or after `AS label`):

```json
"priority_level AS Priority OMIT 0"
"hours_worked OMIT 0"
```

**Object syntax** — add the `omit` property:

```json
{ "path": "hours_worked", "label": "Hours", "omit": 0 }
```

**FK default**: Columns using dot-notation paths (FK joins) automatically get `OMIT null` — missing FK references display as blank instead of showing `null`. This default can be overridden by specifying an explicit `OMIT` value.

| Format | OMIT Behavior |
|--------|---------------|
| `"project_ref"` | No suppression |
| `"project_ref OMIT 0"` | Suppress `0` |
| `"type.name AS Type"` | Suppress `null` (FK default) |
| `"type.name AS Type OMIT -"` | Suppress `-` (overrides FK default) |

### `.*` — Aggregate Type Expansion

The `.*` suffix expands [aggregate types](../aggregate-types.md) (like `geo`) into separate columns for each subfield.

**Default behavior** (without `.*`): Aggregate fields display as a single canonical column:
```json
"position"         // → "48.1, 11.5" (one column)
```

**Expanded behavior** (with `.*`): Aggregate fields display as separate columns:
```json
"position.*"       // → "Latitude", "Longitude" (two columns)
"position.* AS Pos"  // → "Pos Latitude", "Pos Longitude"
```

**With back-references:**
```json
"GpsLog<equipment(LIMIT 1).position.*"              // → "Position Latitude", "Position Longitude"
"GpsLog<equipment(LIMIT 1).position.* AS Tracker"   // → "Tracker Latitude", "Tracker Longitude"
```

**Object syntax:**
```json
{ "path": "position.*", "label": "GPS" }   // → "GPS Latitude", "GPS Longitude"
```

| Format | Result |
|--------|--------|
| `"position"` | One column: "48.1, 11.5" |
| `"position.*"` | Two columns: "Position Latitude", "Position Longitude" |
| `"position.* AS Pos"` | Two columns: "Pos Latitude", "Pos Longitude" |

---

## Dot-Notation Path Resolution

Paths are resolved segment by segment against the schema's FK chain:

```
type.client.name    (base: Project)
│    │       │
│    │       └─ Terminal: column "name" on Client
│    └─ FK segment: ProjectType.client → Client
└─ FK segment: Project.type → ProjectType
```

### Rules

- Each intermediate segment must match a FK column's `displayName`, `name`, or `name + '_id'`
- The last segment must be a regular (non-FK) column on the final joined entity
- Joins are `LEFT JOIN`, so missing FK references produce `NULL`
- The `id` column of the base entity is always included implicitly (needed for row-click navigation)

### Generated SQL

The example above produces:

```sql
CREATE VIEW IF NOT EXISTS uv_project_status AS
SELECT b.id,
       b.project_ref AS "Project Ref",
       b.hours_worked AS "Hours Worked",
       j_type.name AS "Project Type",
       j_type_client.name AS "Client"
FROM project b
LEFT JOIN project_type j_type ON b.type_id = j_type.id
LEFT JOIN client j_type_client
  ON j_type.client_id = j_type_client.id
```

Join aliases use the pattern `j_{path_segments}` (e.g., `j_type`, `j_type_manufacturer`) for uniqueness and debuggability.

---

## Back-Reference Columns (Inbound FKs)

Back-references allow a view to pull data from child entities that point *to* the base entity via a foreign key. They are implemented as correlated SQL subqueries.

### Syntax

```
Entity<fk_field(params).column AS Label
```

| Part | Description | Example |
|------|-------------|---------|
| `Entity` | Child entity that has an FK pointing to the base entity | `Deployment` |
| `<fk_field` | FK column name (displayName, without `_id`) | `<employee` (= `employee_id`) |
| `(params)` | Filter, sort, limit, or aggregation directives | `(WHERE end_date=null, LIMIT 1)` |
| `.column` | Target column on the child entity (or FK chain from it) | `.role` |

> ⚠️ **Parentheses required**: The `(params)` part is mandatory, even when empty or only specifying `LIMIT 1`. Omitting parentheses causes the column to be silently ignored.
>
> - ✅ `Entity<fk(LIMIT 1).column`
> - ✅ `Entity<fk(COUNT)`
> - ✅ `Entity<fk().column` (empty parens = defaults)
> - ❌ `Entity<fk.column` (missing parens — silently ignored)

### Parameters (comma-separated inside parentheses)

| Parameter | Effect | Example |
|-----------|--------|---------|
| `COUNT` | Returns count of matching records (no `.column` needed) | `(COUNT)` |
| `LIST` | Returns comma-separated values (GROUP_CONCAT) | `(LIST)` |
| `WHERE col=val` | Filter condition (`null` maps to `IS NULL`) | `WHERE end_date=null` |
| `ORDER BY col [ASC\|DESC]` | Sort order | `ORDER BY start_date DESC` |
| `LIMIT n` | Maximum records (scalar mode defaults to LIMIT 1) | `LIMIT 1` |

### FK-Following After Back-Reference

The `.column` part supports multi-segment dot-paths, following FK chains from the child entity outward:

```json
"Deployment<employee(WHERE end_date=null, LIMIT 1).project.name AS Current Project"
```

This resolves as: find `Deployment` records where `employee_id = base.id` and `end_date IS NULL`, then follow the `project` FK to `Project` and return `name`. The FK chain within the subquery produces internal LEFT JOINs.

### Examples

```json
"Deployment<employee(COUNT) AS Deployments"
"Milestone<project(COUNT) AS Milestones OMIT 0"
"Deployment<employee(ORDER BY start_date DESC, LIMIT 1).role AS Last Role"
"Deployment<employee(WHERE end_date=null, LIMIT 1).project.name AS Current Project"
"Assignment<employee(LIST, ORDER BY start_date DESC).start_date AS Assignment History"
```

### Generated SQL

Back-reference columns become correlated subqueries in the SELECT clause:

```sql
-- COUNT:
(SELECT COUNT(*) FROM deployment _br
 WHERE _br.employee_id = b.id) AS "Deployments"

-- Scalar with FK-following:
(SELECT _br_project.name FROM deployment _br
 LEFT JOIN project _br_project ON _br.project_id = _br_project.id
 WHERE _br.employee_id = b.id AND _br.end_date IS NULL
 LIMIT 1) AS "Current Project"
```

Subquery aliases use `_br` for the child table and `_br_{field}` for internal joins.

---

## UI Behavior

- Views appear in a separate **Views** dropdown (blue border) to the left of the entity selector
- The dropdown is hidden when no views are configured
- Selecting a view forces **table mode** (tree buttons are hidden)
- Column filters and sorting work identically to entity tables
- Clicking a row switches to the base entity and opens the edit form for that record
- View color is inherited from the base entity's area color

---

## Context Menu Navigation

When right-clicking a record in the CRUD table, the context menu shows **views whose `requiredFilter` references that entity type**. This allows quick navigation from a record to related views.

### How It Works

The system matches views by their `requiredFilter` field types:

1. **Row-level**: Right-clicking anywhere on a row shows views that require an input of the current entity's type
2. **FK cell**: Right-clicking on a FK cell additionally shows views that require an input of the FK target entity's type

### Example

Given these views:

```json
// Deployment Timeline — requiredFilter references Employee
{
  "base": "Deployment",
  "requiredFilter": ["employee._label:select"],
  "columns": ["project._label AS Project", "start_date AS Start Date", "employee._label AS Employee"]
}

// Team Roster — requiredFilter references Manager
{
  "base": "Employee",
  "requiredFilter": ["manager._label:select"],
  "columns": ["emp_code AS Code", "name AS Name", "manager._label AS Manager"]
}
```

In the **Employee** CRUD table:

| Action | Shown Views | Why |
|--------|-------------|-----|
| Right-click on row | Deployment Timeline | requiredFilter targets Employee |
| Right-click on `manager` FK cell | Deployment Timeline + Team Roster | Row match + FK cell match |

### Filter Behavior

- **Row-level views**: The clicked record's label becomes the filter value (e.g., `Employee:EMP-1042`)
- **FK cell views**: The FK cell's display text becomes the filter value (e.g., `Manager:Sarah Chen`)

The view opens immediately with the filter applied — no prefilter dialog is shown. Breadcrumb navigation is preserved (push, not replace).

---

## Complete Example

File structure:
```
docs/views/
├── Project Analysis/
│   ├── Project Status.md
│   ├── Staff Overview.md
│   └── Project Overview.md
└── Services/
    └── Open Tasks.md
```

**Project Analysis/Project Status.md:**
```markdown
# Project Status

```json
{
  "base": "Project",
  "columns": [
    "project_ref",
    "hours_worked OMIT 0",
    "budget",
    "type.name AS Project Type",
    { "path": "type.client.name", "label": "Client" }
  ]
}
```
```

**Project Analysis/Project Overview.md:**
```markdown
# Project Overview

```json
{
  "base": "Project",
  "columns": [
    "project_ref AS Ref",
    "type.name AS Type",
    "Deployment<project(COUNT) AS Team Size",
    "Deployment<project(WHERE end_date=null, LIMIT 1).employee.name AS Lead"
  ]
}
```
```

**Services/Open Tasks.md:**
```markdown
# Open Tasks

```json
{
  "base": "TaskTemplate",
  "columns": [
    "task_number",
    "status",
    "project.project_ref AS Project",
    "vendor.name AS Vendor"
  ]
}
```
```

---

## Verification

After adding or changing views, restart the server and check:

- [ ] Server log shows "Created N user view(s)"
- [ ] `GET /api/views` lists the views with correct groups and colors
- [ ] `GET /api/views/<Name>` returns data rows
- [ ] `GET /api/views/<Name>/schema` returns column metadata
- [ ] Views dropdown appears in the UI with correct entries
- [ ] Table displays correct joined data
- [ ] Column filters and sorting work
- [ ] Row click navigates to base entity edit form

---

## Default Sorting

Views can specify a default sort order that is applied when the view is first loaded.

### Syntax

**String format:**
```json
{
  "name": "Project Status",
  "base": "Project",
  "sort": "project_ref",
  "columns": [...]
}
```

**With direction (DESC):**
```json
{
  "sort": "hours_worked DESC"
}
```

**Object format:**
```json
{
  "sort": { "column": "serial_number", "order": "desc" }
}
```

| Format | Result |
|--------|--------|
| `"sort": "name"` | Sort by `name` ascending |
| `"sort": "date DESC"` | Sort by `date` descending |
| `"sort": { "column": "id", "order": "asc" }` | Sort by `id` ascending |

---

## Required Filter & Prefilter

Views support the same filter dialog behavior as CRUD entities.

### Required Filter

Forces a filter dialog before loading data (always shown, regardless of dataset size):

```json
{
  "name": "Employee Deployments",
  "base": "Deployment",
  "requiredFilter": ["employee.emp_code"],
  "columns": [...]
}
```

### Prefilter

Shows a filter dialog only when the dataset exceeds the pagination threshold:

```json
{
  "name": "All Milestones",
  "base": "Milestone",
  "prefilter": ["project.project_ref:select", "milestone_type"],
  "columns": [...]
}
```

### Field Syntax

| Suffix | Behavior |
|--------|----------|
| `"field"` | Text input with LIKE matching |
| `"field:select"` | Dropdown with distinct values |

### Combined Example

```json
{
  "name": "Project Milestones",
  "base": "Milestone",
  "requiredFilter": ["vendor.name:select"],
  "prefilter": ["project.type.name:select"],
  "sort": "due_date DESC",
  "columns": [
    "project.project_ref AS Project",
    "due_date",
    "vendor.name AS Vendor",
    "task_template.name AS Task"
  ]
}
```

---

## View Filter

Views can specify a `filter` property containing a SQL WHERE clause that filters rows at the database level. Unlike `requiredFilter` and `prefilter` (which prompt the user), `filter` is applied automatically and permanently.

### Syntax

```json
{
  "name": "Project Subtypes",
  "base": "ProjectType",
  "filter": "b.parent_type_id IS NOT NULL",
  "columns": [
    "name AS Type",
    "parent_type.name AS Parent Type"
  ]
}
```

### Use Cases

- **Exclude NULL relationships**: `"filter": "b.parent_type_id IS NOT NULL"`
- **Status filtering**: `"filter": "b.status = 'Active'"`
- **Combined conditions**: `"filter": "b.status = 'Active' AND b.deleted_at IS NULL"`

### Column References

The filter operates on the base table (aliased as `b`). **Always use the `b.` prefix** for base table columns to avoid ambiguity when JOINs are present:

| Entity Column | Filter Syntax |
|---------------|---------------|
| `super_type` (FK) | `b.super_type_id IS NOT NULL` |
| `status` (string) | `b.status = 'Active'` |
| `count` (number) | `b.count > 0` |

For joined columns, use the join alias pattern `j_{path}`:

```json
{
  "filter": "j_type.thrust > 20000",
  "columns": ["type.designation AS Type", "type.thrust AS Thrust"]
}
```

---

## Chart View

Views can include a `chart` property that defines a Vega-Lite visualization. When present, a **Chart** button appears in the view toggle (alongside Table, Tree, Map).

### Syntax

Add a `chart` object containing a Vega-Lite specification (without `$schema`, `width`, `data`):

```json
{
  "name": "Equipment by Type",
  "base": "EquipmentType",
  "columns": [
    "name AS Equipment Type",
    "Equipment<equipment_type(COUNT) AS Count"
  ],
  "chart": {
    "mark": "bar",
    "encoding": {
      "x": { "field": "Equipment Type", "type": "nominal" },
      "y": { "field": "Count", "type": "quantitative" }
    }
  }
}
```

### Chart Object

The `chart` property accepts any valid [Vega-Lite](https://vega.github.io/vega-lite/) specification fragment. The system automatically adds:

- `$schema`: Vega-Lite v5 schema URL
- `width`: `"container"` (responsive width)
- `height`: 400 (default height)
- `data.values`: View records (filtered to visible columns)

You define only the visualization-specific parts:

| Property | Description | Example |
|----------|-------------|---------|
| `mark` | Chart type | `"bar"`, `"line"`, `"point"`, `"arc"` |
| `encoding` | Data-to-visual mappings | See below |
| `title` | Chart title (optional) | `"Equipment Distribution"` |

### Encoding

The `encoding` object maps data fields to visual channels:

```json
"encoding": {
  "x": {
    "field": "Equipment Type",
    "type": "nominal",
    "axis": { "labelAngle": -45 }
  },
  "y": {
    "field": "Count",
    "type": "quantitative",
    "axis": { "tickMinStep": 1, "format": "d" }
  },
  "color": {
    "field": "Equipment Type",
    "type": "nominal",
    "legend": null
  }
}
```

| Channel | Purpose | Common Types |
|---------|---------|--------------|
| `x` | Horizontal position | `nominal`, `ordinal`, `quantitative`, `temporal` |
| `y` | Vertical position | `nominal`, `ordinal`, `quantitative`, `temporal` |
| `color` | Fill color | `nominal`, `quantitative` |
| `size` | Mark size | `quantitative` |
| `shape` | Mark shape | `nominal` |
| `tooltip` | Hover tooltip | `nominal`, `quantitative` |

### Field Names

Use the **column alias** (the part after `AS`) as the field name in encodings:

```json
"columns": [
  "name AS Equipment Type",                    // ← Use "Equipment Type" in chart
  "Equipment<equipment_type(COUNT) AS Count"   // ← Use "Count" in chart
]
```

### Chart Types

| Mark | Use Case | Example |
|------|----------|---------|
| `bar` | Categorical comparison | Counts by category |
| `line` | Trends over time | Time series |
| `point` | Scatter plot | Correlation analysis |
| `arc` | Pie/donut chart | Proportions |
| `area` | Cumulative trends | Stacked time series |

### Example: Bar Chart with Styling

```json
{
  "name": "Equipment by Type",
  "base": "EquipmentType",
  "columns": [
    "name AS Equipment Type",
    "Equipment<equipment_type(COUNT) AS Count"
  ],
  "chart": {
    "mark": "bar",
    "encoding": {
      "x": {
        "field": "Equipment Type",
        "type": "nominal",
        "axis": { "labelFontSize": 14, "labelColor": "black", "labelAngle": -45 }
      },
      "y": {
        "field": "Count",
        "type": "quantitative",
        "axis": { "tickMinStep": 1, "format": "d", "labelFontSize": 14, "labelColor": "black" }
      },
      "color": { "field": "Equipment Type", "type": "nominal", "legend": null }
    }
  }
}
```

### UI Behavior

- The **Chart** button appears in the view toggle only when `chart` is defined
- Charts use the Quartz theme and SVG rendering
- Charts are responsive (width adjusts to container)
- Chart data is prepared from the same records shown in the table view

### Vega-Lite Resources

- [Vega-Lite Documentation](https://vega.github.io/vega-lite/docs/)
- [Example Gallery](https://vega.github.io/vega-lite/examples/)
- [Online Editor](https://vega.github.io/editor/)

---

## Map View

Views with **geo columns** (type `geo`) automatically get a **Map** button. Clicking it displays records as markers on an interactive Leaflet map.

### Requirements

For Map View to appear, the view must include columns of type `geo` (which expand to latitude/longitude pairs):

```json
{
  "name": "Equipment Tracking",
  "base": "Equipment",
  "columns": [
    "serial_number AS Equipment",
    "GpsLog<equipment(LIMIT 1).position AS Position"
  ]
}
```

The `position` column (type `geo`) provides the coordinates for map markers.

### Map Features

- **Marker clustering**: Groups nearby markers at low zoom levels
- **Tooltips**: Show the label field (first non-geo column)
- **Popups**: Click markers to see all column values
- **Auto-zoom**: Fits bounds to show all markers
- **Toggle labels**: Show/hide permanent marker labels

### See Also

- [Aggregate Types: geo](../aggregate-types.md#built-in-geo) — GPS coordinate storage

---

## Limitations

- **Single-level back-references**: Back-reference columns support one inbound FK step with optional outbound FK-following. Chaining multiple back-references (e.g., `...column<Entity(...)`) is not supported.
- **Read-only**: Views do not support create, update, or delete operations.
- **FK chain depth**: There is no hard limit, but deeply nested paths (3+ joins) or many back-reference subqueries may impact query performance on large datasets.
