# User Views

> Cross-entity read-only tables defined in `config.json` via dot-notation path expressions.

## Overview

User Views join data across entities using FK relationships and display the result as a flat, read-only table in the UI. They are materialized as SQL views (`uv_*`) at server startup and appear in a separate **Views** dropdown left of the entity selector.

Clicking a row in a view jumps to the base entity's edit form in the detail panel.

---

## Configuration

Views are defined in `config.json` under the `"views"` key, sibling to `"crud"`:

```json
{
    "crud": { ... },
    "views": [
        "-------------------- Fleet Analysis",
        {
            "name": "Engine Status",
            "base": "Engine",
            "columns": [
                "serial_number",
                "total_cycles",
                "type.designation AS Engine Type",
                { "path": "type.manufacturer.name", "label": "OEM" }
            ]
        }
    ]
}
```

### View Object

| Key | Required | Description |
|-----|----------|-------------|
| `name` | Yes | Display name shown in the Views dropdown |
| `base` | Yes | Base entity (PascalCase). Determines the SQL base table, area color, and row-click target |
| `columns` | Yes | Array of column definitions (see below) |

### Separators

Strings starting with dashes serve as group headers in the dropdown:

```json
"-------------------- Fleet Analysis"
```

The dashes are stripped; only the label text is displayed.

---

## Column Syntax

Each entry in the `columns` array can be one of three formats:

### 1. Simple column (direct attribute)

```json
"serial_number"
```

References a column directly on the base entity. The display label is auto-generated via title-case: `serial_number` → **Serial Number**.

### 2. Dot-path with AS alias

```json
"type.designation AS Engine Type"
```

Follows the FK chain and assigns a custom display label. The `AS` keyword is case-insensitive.

### 3. Object format

```json
{ "path": "type.manufacturer.name", "label": "OEM" }
```

Explicit path and label. Equivalent to `"type.manufacturer.name AS OEM"`.

### OMIT — Value Suppression

The `OMIT` keyword suppresses specific values from display, rendering the cell as blank.

**String syntax** — append `OMIT <value>` after the column (or after `AS label`):

```json
"mount_position AS pos OMIT 0"
"total_cycles OMIT 0"
```

**Object syntax** — add the `omit` property:

```json
{ "path": "total_cycles", "label": "Cycles", "omit": 0 }
```

**FK default**: Columns using dot-notation paths (FK joins) automatically get `OMIT null` — missing FK references display as blank instead of showing `null`. This default can be overridden by specifying an explicit `OMIT` value.

| Format | OMIT Behavior |
|--------|---------------|
| `"serial_number"` | No suppression |
| `"serial_number OMIT 0"` | Suppress `0` |
| `"type.designation AS Type"` | Suppress `null` (FK default) |
| `"type.designation AS Type OMIT -"` | Suppress `-` (overrides FK default) |

---

## Dot-Notation Path Resolution

Paths are resolved segment by segment against the schema's FK chain:

```
type.manufacturer.name    (base: Engine)
│    │            │
│    │            └─ Terminal: column "name" on EngineOEM
│    └─ FK segment: EngineType.manufacturer → EngineOEM
└─ FK segment: Engine.type → EngineType
```

### Rules

- Each intermediate segment must match a FK column's `displayName`, `name`, or `name + '_id'`
- The last segment must be a regular (non-FK) column on the final joined entity
- Joins are `LEFT JOIN`, so missing FK references produce `NULL`
- The `id` column of the base entity is always included implicitly (needed for row-click navigation)

### Generated SQL

The example above produces:

```sql
CREATE VIEW IF NOT EXISTS uv_engine_status AS
SELECT b.id,
       b.serial_number AS "Serial Number",
       b.total_cycles AS "Total Cycles",
       j_type.designation AS "Engine Type",
       j_type_manufacturer.name AS "OEM"
FROM engine b
LEFT JOIN engine_type j_type ON b.type_id = j_type.id
LEFT JOIN engine_oem j_type_manufacturer
  ON j_type.manufacturer_id = j_type_manufacturer.id
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
| `Entity` | Child entity that has an FK pointing to the base entity | `EngineAllocation` |
| `<fk_field` | FK column name (displayName, without `_id`) | `<engine` (= `engine_id`) |
| `(params)` | Filter, sort, limit, or aggregation directives | `(WHERE end_date=null, LIMIT 1)` |
| `.column` | Target column on the child entity (or FK chain from it) | `.mount_position` |

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
"EngineAllocation<engine(WHERE end_date=null, LIMIT 1).aircraft.registration AS Current Aircraft"
```

This resolves as: find `EngineAllocation` records where `engine_id = base.id` and `end_date IS NULL`, then follow the `aircraft` FK to `Aircraft` and return `registration`. The FK chain within the subquery produces internal LEFT JOINs.

### Examples

```json
"EngineAllocation<engine(COUNT) AS Allocations"
"EngineEvent<engine(COUNT) AS Events OMIT 0"
"EngineAllocation<engine(ORDER BY start_date DESC, LIMIT 1).mount_position AS Last Pos"
"EngineAllocation<engine(WHERE end_date=null, LIMIT 1).aircraft.registration AS Current Aircraft"
"EngineStandMounting<engine(LIST, ORDER BY mounted_date DESC).mounted_date AS Mount History"
```

### Generated SQL

Back-reference columns become correlated subqueries in the SELECT clause:

```sql
-- COUNT:
(SELECT COUNT(*) FROM engine_allocation _br
 WHERE _br.engine_id = b.id) AS "Allocations"

-- Scalar with FK-following:
(SELECT _br_aircraft.registration FROM engine_allocation _br
 LEFT JOIN aircraft _br_aircraft ON _br.aircraft_id = _br_aircraft.id
 WHERE _br.engine_id = b.id AND _br.end_date IS NULL
 LIMIT 1) AS "Current Aircraft"
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

## Complete Example

```json
"views": [
    "-------------------- Fleet Analysis",
    {
        "name": "Engine Status",
        "base": "Engine",
        "columns": [
            "serial_number",
            "total_cycles OMIT 0",
            "total_flight_hours",
            "type.designation AS Engine Type",
            { "path": "type.manufacturer.name", "label": "OEM" }
        ]
    },
    {
        "name": "Aircraft Fleet",
        "base": "Aircraft",
        "columns": [
            "registration",
            "serial_number",
            "status",
            "type.designation AS Aircraft Type",
            { "path": "type.manufacturer.name", "label": "Manufacturer" }
        ]
    },
    {
        "name": "Engine Overview",
        "base": "Engine",
        "columns": [
            "serial_number AS ESN",
            "type.designation AS Type",
            "EngineAllocation<engine(COUNT) AS Allocations",
            "EngineAllocation<engine(WHERE end_date=null, LIMIT 1).aircraft.registration AS Current Aircraft"
        ]
    },
    "-------------------- Maintenance",
    {
        "name": "Open Shop Orders",
        "base": "ShopOrder",
        "columns": [
            "order_number",
            "status",
            "engine.serial_number AS Engine S/N",
            "mro.name AS MRO"
        ]
    }
]
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

## Limitations

- **Single-level back-references**: Back-reference columns support one inbound FK step with optional outbound FK-following. Chaining multiple back-references (e.g., `...column<Entity(...)`) is not supported.
- **Read-only**: Views do not support create, update, or delete operations.
- **FK chain depth**: There is no hard limit, but deeply nested paths (3+ joins) or many back-reference subqueries may impact query performance on large datasets.
