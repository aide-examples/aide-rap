# Filter Dialogs

> Pre-load filters for entities and views with large datasets.

## Overview

Filter Dialogs appear before data is loaded, allowing users to narrow down results on large tables. Two modes are available:

| Mode | Trigger | Use Case |
|------|---------|----------|
| **Required Filter** | Always shows dialog | Master-detail tables (e.g., Readings by Meter) |
| **Prefilter** | Shows dialog only when `total > threshold` | Large reference tables |

Both modes support four input types:

| Suffix | Input | Filter Mode | Use Case |
|--------|-------|-------------|----------|
| (none) | Text input | LIKE (`%text%`) | High-cardinality FKs (many values) |
| `:select` | Dropdown | Exact match | Low-cardinality FKs (few values) |
| `:year` | Dropdown | Year extraction | Date columns filtered by year |
| `:month` | Dropdown | Year-month extraction | Date columns filtered by month |

---

## Configuration

### Entity Filters (Crud.md)

Filters are defined inline with the entity list item:

```markdown
## Metering
- Meter
- Reading (required: meter)
- Reading (required: meter:select)
- Reading (prefilter: meter, building)
- Reading (required: meter, prefilter: building:select)
```

**Syntax:**

```
- EntityName (required: field1, field2:select, prefilter: field3)
```

| Option | Behavior |
|--------|----------|
| `required: field` | Always show dialog before loading |
| `required: field:select` | Always show dialog with dropdown |
| `required: field:year` | Always show dialog with year dropdown |
| `required: field:month` | Always show dialog with year-month dropdown |
| `prefilter: field` | Show dialog only when `total > threshold` |
| `prefilter: field:select` | Show dialog with dropdown when large |
| `prefilter: field:year` | Show dialog with year dropdown when large |
| `prefilter: field:month` | Show dialog with year-month dropdown when large |

### View Filters (Views.md)

Filters are defined in the view JSON:

```json
{
  "base": "Reading",
  "prefilter": ["meter.resource_type:select"],
  "columns": [
    "meter.resource_type.name as resource",
    "value",
    "reading_at"
  ]
}
```

**Note:** View prefilters always show the dialog (like `required` for entities) since views typically aggregate large datasets.

### Pagination Config (config.json)

The threshold and page size are configured globally:

```json
{
  "pagination": {
    "threshold": 500,
    "pageSize": 200
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `threshold` | 500 | Show prefilter dialog when `total > threshold` |
| `pageSize` | 200 | Records per page when paginating |

---

## Field Path Syntax

### Entity Filters

For entity filters, the field path refers to a **FK field name** (without `_id`):

```markdown
- Reading (required: meter)
```

This references the `meter_id` FK column. The dialog will filter on the `meter_label` view column.

### View Filters

For view filters, the field path should match the **beginning of a column path** in the view:

```json
{
  "prefilter": ["meter.resource_type:select"],
  "columns": [
    "meter.resource_type.name as resource",  // ← matches prefilter path
    ...
  ]
}
```

The system finds the view column whose `path` starts with the prefilter path and uses that column for filtering.

---

## Input Types

### Text Input (LIKE)

When no suffix is specified, a text input appears:

```markdown
- Reading (required: meter)
```

- User enters partial text (e.g., "Gas")
- Filter: `WHERE meter_label LIKE '%Gas%'`
- Best for: High-cardinality FKs (many possible values)

### Dropdown (Exact Match)

With `:select` suffix, a dropdown with all distinct values appears:

```markdown
- Reading (required: meter:select)
```

```json
"prefilter": ["meter.resource_type:select"]
```

- Dropdown populated via `GET /api/entities/:entity/distinct/:column`
- Filter: `WHERE meter_label = 'Gas Meter 1'` (exact match)
- Best for: Low-cardinality FKs (few values like ResourceType, Status)

### Year Dropdown

With `:year` suffix, a dropdown with distinct years from a date column appears:

```markdown
- Reading (required: reading_at:year)
```

```json
"prefilter": ["reading_at:year"]
```

- Dropdown populated via `GET /api/entities/:entity/distinct/:column?type=year`
- Values extracted using `strftime('%Y', column)` (e.g., "2023", "2024", "2025")
- Filter: `WHERE strftime('%Y', reading_at) = '2024'`
- Best for: Date columns where year-level filtering is useful

### Month Dropdown

With `:month` suffix, a dropdown with distinct year-months from a date column appears:

```markdown
- Reading (required: reading_at:month)
```

```json
"prefilter": ["reading_at:month"]
```

- Dropdown populated via `GET /api/entities/:entity/distinct/:column?type=month`
- Values extracted using `strftime('%Y-%m', column)` (e.g., "2024-01", "2024-02")
- Filter: `WHERE strftime('%Y-%m', reading_at) = '2024-03'`
- Best for: Date columns where month-level filtering is useful

---

## Filter String Formats

The filter dialog generates URL query parameters in these formats:

| Format | Mode | Example |
|--------|------|---------|
| `~column:value` | LIKE on view column | `~meter_label:Gas` |
| `=column:value` | Exact match on view column | `=meter_label:Wasser` |
| `@Ycolumn:value` | Year extraction on date column | `@Yreading_at:2024` |
| `@Mcolumn:value` | Month extraction on date column | `@Mreading_at:2024-03` |
| `column:value` | Exact match on entity column | `type_id:5` |

### Entity Filters

| Input Type | Generated Filter |
|------------|------------------|
| Text input | `~meter_label:Gas` (LIKE) |
| Dropdown (select) | `=meter_label:Wasser` (exact) |
| Dropdown (year) | `@Yreading_at:2024` (year extraction) |
| Dropdown (month) | `@Mreading_at:2024-03` (month extraction) |

### View Filters

| Input Type | Generated Filter |
|------------|------------------|
| Text input | `~resource:Gas` (LIKE) |
| Dropdown (select) | `resource:Wasser` (exact) |
| Dropdown (year) | `@Yreading_at:2024` (year extraction) |
| Dropdown (month) | `@Mreading_at:2024-03` (month extraction) |

---

## UI Behavior

### Dialog Layout

```
┌─────────────────────────────────────┐
│  Filter Reading                     │
│  Select values to filter by         │
│                                     │
│  Meter:  [________________]         │  ← Text input
│                                     │
│  Resource Type:  [▼ Strom     ]     │  ← Dropdown
│                                     │
│  [Load All]         [Apply Filter]  │
└─────────────────────────────────────┘
```

### Actions

| Button | Behavior |
|--------|----------|
| **Apply Filter** | Load data with selected filter |
| **Load All** | Load data without filter (respects pagination) |
| **Enter key** | Same as Apply Filter |
| **Escape / Close** | Same as Load All |

### After Filtering

- Status bar shows: `Showing 42 records` or `Showing 200 of 1,234 records`
- Infinite scroll loads more records when scrolling to bottom
- Re-filtering (via search box) reloads from server with new filter

---

## Backend API

### Distinct Values

**Entity columns:**
```
GET /api/entities/:entity/distinct/:column
→ ["Value 1", "Value 2", ...]
```

**View columns:**
```
GET /api/views/:view/distinct/:column
→ { values: [...], column: "sqlAlias", label: "Display Label" }
```

### Filtered Data

**Entity data with filter:**
```
GET /api/entities/Reading?filter=~meter_label:Gas&limit=200
```

**View data with filter:**
```
GET /api/views/Readings%20by%20Resource?filter=resource:Strom
```

---

## Examples

### Example 1: Master-Detail with Text Input

Large detail table where users filter by parent FK:

**Crud.md:**
```markdown
## Metering
- Meter
- Reading (required: meter)
```

**Behavior:** Opening "Reading" always shows dialog with text input for Meter. User types "Haupt" to find readings for meters containing "Haupt".

### Example 2: View with Dropdown

View filtered by low-cardinality reference:

**Views.md:**
```json
{
  "base": "Reading",
  "prefilter": ["meter.resource_type:select"],
  "columns": [
    "meter.resource_type.name as resource",
    "meter.serial_number as meter",
    "value",
    "reading_at"
  ]
}
```

**Behavior:** Opening "Readings by Resource" view shows dialog with dropdown containing resource types (Strom, Gas, Wasser). User selects one and sees only readings for that resource.

### Example 3: Date Filtering by Year

View or entity filtered by year:

**Crud.md:**
```markdown
- Reading (required: reading_at:year)
```

**Views.md:**
```json
{
  "base": "Reading",
  "prefilter": ["reading_at:year"],
  "columns": [
    "meter.serial_number as meter",
    "value",
    "reading_at"
  ]
}
```

**Behavior:** Opening "Reading" shows dialog with dropdown containing years (2025, 2024, 2023...). User selects a year and sees only readings from that year. Years are sorted descending (most recent first).

### Example 4: Date Filtering by Month

View or entity filtered by month:

**Crud.md:**
```markdown
- Reading (required: reading_at:month)
```

**Behavior:** Opening "Reading" shows dialog with dropdown containing year-months (2025-01, 2024-12, 2024-11...). User selects a month and sees only readings from that specific month.

### Example 5: Combined Filters

Both required and threshold-based filters:

**Crud.md:**
```markdown
- Transaction (required: account:select, prefilter: category)
```

**Behavior:**
- `account:select` — Always show dropdown for Account
- `prefilter: category` — Also show text input for Category, but only if total > threshold

---

## Verification

After configuring filters:

- [ ] Dialog appears at correct time (always vs. threshold-based)
- [ ] Text input filters with LIKE (`%text%`)
- [ ] Dropdown shows all distinct values
- [ ] Dropdown filters with exact match
- [ ] "Load All" loads data without filter
- [ ] Pagination kicks in for large results
- [ ] Status bar shows correct record counts

---

## Multiple Filters (AND Logic)

When multiple prefilter fields are configured and the user fills in multiple values, they are combined with **AND** logic:

```json
"prefilter": ["meter.building:select", "reading_at:year"]
```

If the user selects "Hauptgebäude" for building and "2024" for year, the generated filter is:

```
building:Hauptgebäude&&@Yreading_at:2024
```

This translates to SQL:
```sql
WHERE "building" = 'Hauptgebäude' AND strftime('%Y', "reading_at") = '2024'
```

---

## Limitations

- **View column matching:** Prefilter path must match beginning of a view column path
- **FK labels only:** Entity filters operate on `_label` columns, not raw IDs
