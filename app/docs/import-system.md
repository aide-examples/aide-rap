# XLSX Import System

Reference for the XLSX import pipeline — how external spreadsheet data flows through mapping rules to JSON seed files and into the database.

---

## Overview

The import system converts external XLSX files into seed-compatible JSON using declarative mapping rules defined in Markdown files.

```
extern/FDB.xlsx  →  docs/imports/Aircraft.md  →  import/Aircraft.json  →  Database
    (XLSX)            (Mapping Rules)         (JSON Seed)           (SQLite)
```

This separates data acquisition (XLSX from external systems) from data transformation (mapping) and loading (seed pipeline).

---

## Import Definition Files

Each entity can have an import definition in `docs/imports/{Entity}.md`:

```markdown
# Aircraft Import

Source: extern/FDB 2025-12-31.xlsx
Sheet: Tabelle1
MaxRows: 100000
Limit: 50

## Mapping

| Source                | Target              | Transform       |
|-----------------------|---------------------|-----------------|
| Machine Serial Number | serial_number       |                 |
| Registration          | registration        |                 |
| Aircraft Status       | status              |                 |
| Manufacturing Date    | manufacture_date    | date:DD.MM.YYYY |

## Filter

WHERE status IN ('Asset Fleet', 'Fixed Deliveries', 'Out Plan')
```

### Header Directives

| Directive | Required | Description |
|-----------|----------|-------------|
| `Source:` | Yes | Path to XLSX file relative to `data/` |
| `Sheet:` | No | Sheet name (default: first sheet) |
| `MaxRows:` | No | Row limit for XLSX reading (default: 100000) |
| `Limit:` | No | Output limit after all filtering (for testing) |
| `First:` | No | Deduplicate rows by this source column (keep first occurrence) |

**MaxRows vs Limit:**
- `MaxRows` limits how many rows are read from the XLSX file (performance optimization for very large files)
- `Limit` limits how many records are written to the output JSON (for testing with a small subset)

---

## Source Expressions

The **Source** column in the mapping table supports several expression types:

| Type | Syntax | Example | Description |
|------|--------|---------|-------------|
| Column | `Name` | `Registration` | Value from XLSX column |
| Number | `42` | `1000` | Fixed numeric value |
| String | `"text"` | `"DLH"` | Fixed string value |
| Random Number | `random(min,max)` | `random(1000,2000)` | Random integer in range |
| Random Choice | `random("a","b")` | `random("A","B","C")` | Random selection from strings |
| Random Enum | `random(EnumType)` | `random(CurrencyCode)` | Random internal value from enum type |
| Concat | `concat(a, b, ...)` | `concat(First, " ", Last)` | Combine columns with separators |
| Calc | `calc(expr)` | `calc(Price * Factor)` | Arithmetic expression with columns |

### Examples

```markdown
| Source                        | Target              | Transform       |
|-------------------------------|---------------------|-----------------|
| Machine Serial Number         | serial_number       |                 |
| "DLH"                         | current_operator    |                 |
| random(1000,5000)             | total_flight_hours  |                 |
| random("A","B","C")           | maintenance_grade   |                 |
| random(OperationalStatus)     | status              |                 |
| concat(Code, "-", Year)       | reference           |                 |
| concat(First, " ", Last)      | full_name           |                 |
| calc(Price * Factor)          | adjusted_price      |                 |
| calc(Amount / 100)            | amount_cents        |                 |
```

### Concat Function

`concat(arg1, arg2, ...)` combines multiple values into a single string:
- **Column names** (without quotes): Read value from XLSX column
- **String literals** (with quotes): Fixed separator or prefix/suffix

NULL values in columns are converted to empty strings.

### Calc Function

`calc(expression)` performs arithmetic operations on numeric columns:
- **Column names**: Reference XLSX columns (may contain spaces and hyphens)
- **Operators**: `+`, `-`, `*`, `/` — **must be surrounded by spaces**
- **Parentheses**: For grouping `( A + B ) * C`
- **Number literals**: Fixed values like `100` or `0.5`

**Important:** Operators are only recognized when surrounded by spaces. This allows column names with hyphens like `Faktor Von-Währung` to work correctly.

If any referenced column is NULL or non-numeric, the result is NULL.

```markdown
| Source                                     | Target  |
|--------------------------------------------|---------|
| calc(Umrechnungskurs * Faktor Von-Währung) | rate    |
| calc(Price / 100)                          | cents   |
| calc((Base + Tax) * Quantity)              | total   |
```

### Enum Resolution

`random(EnumType)` uses the TypeRegistry to find enum values. It returns the **internal** value (the database-stored value), not the external/display value.

### Multiple Targets from Same Source

The same source expression can be used multiple times to map to different target columns:

```markdown
| Source        | Target    |
|---------------|-----------|
| Name          | label     |
| Name          | display   |
| 0             | count_a   |
| 0             | count_b   |
```

---

## Target Column Names

The **Target** column specifies where to write the value. Two naming conventions are supported:

| Convention | Example | Description |
|------------|---------|-------------|
| Conceptual | `current_operator` | FK display name (without `_id`) |
| Technical | `current_operator_id` | Actual DB column name |

Using **conceptual names** is recommended. The seed pipeline will resolve them to IDs automatically (see [Seed Data: FK Label Resolution](seed-data.md#fk-label-resolution)).

---

## Transforms

The **Transform** column applies conversions to source values:

| Transform | Description | Example |
|-----------|-------------|---------|
| `date:DD.MM.YYYY` | German date format → ISO | `01.06.2020` → `2020-06-01` |
| `date:MM/DD/YYYY` | US date format → ISO | `06/01/2020` → `2020-06-01` |
| `date:YYYY-MM-DD` | ISO format (passthrough) | — |
| `number` | Parse with German decimal (`,` → `.`) | `1.234,56` → `1234.56` |
| `trim` | Remove whitespace | — |
| `replace:/pattern/replacement/flags` | Regex replacement | See below |

Excel serial dates (numeric) are automatically converted when a date transform is specified.

### Regex Replace

The `replace:/pattern/replacement/flags` transform applies a JavaScript regex replacement:

```markdown
| Source      | Target      | Transform                      |
|-------------|-------------|--------------------------------|
| Engine Type | engine_type | replace:/^(PW)(\d)/$1 $2/      |
| Code        | code        | replace:/[^A-Z0-9]//g          |
| Name        | name        | replace:/\s+/ /g               |
```

- **pattern**: JavaScript regex pattern
- **replacement**: Replacement string (supports `$1`, `$2` for capture groups)
- **flags**: Optional flags (`g` = global, `i` = case-insensitive, etc.)

Examples:
- `replace:/^(PW)(\d)/$1 $2/` — "PW4000" → "PW 4000"
- `replace:/[^A-Z0-9]//g` — Remove non-alphanumeric
- `replace:/\s+/ /g` — Collapse multiple spaces

---

## Source Filter

The `## Source Filter` section filters XLSX rows **before** mapping, using regex patterns on source columns:

```markdown
## Source Filter

Aircraft Status: /^(Active|In Service)$/
Registration: /^D-/
```

### Syntax

Each line specifies a column and regex pattern:
```
ColumnName: /pattern/flags
ColumnName: !/pattern/flags   (negated)
```

- **ColumnName**: Exact XLSX column name
- **/pattern/**: JavaScript regex pattern
- **!/pattern/**: Negated pattern (rows that do NOT match)
- **flags**: Optional regex flags (g, i, m, s, u, y)

Multiple filters are **AND-ed** together (all must match).

### Examples

```markdown
## Source Filter

Status: /Active/i
Country Code: /^(DE|AT|CH)$/
Serial Number: /^\d{5,}$/
Exclude Flag: !/^(TEST|DEMO)/i
```

The negation syntax `!/regex/` is useful for excluding rows that match a pattern (e.g., test data, obsolete records).

### Use Cases

Source Filter is useful when:
- You want to filter by XLSX columns that aren't mapped to the target
- You need regex-based pattern matching (not just equality)
- You want to reduce data volume **before** the mapping step

For simple equality filters on **target** columns (after mapping), use the `## Filter` section instead.

---

## Deduplication (First)

The `First:` header directive keeps only the first occurrence of each unique value in a source column:

```markdown
Source: extern/data.xlsx
First: Serial Number
```

This is useful for denormalized source data where multiple rows have the same key but you only need one record per key. The first row (in XLSX order) is kept, duplicates are discarded.

---

## Filter Clause

The `## Filter` section supports SQL-like WHERE syntax:

```markdown
## Filter

WHERE status IN ('Asset Fleet', 'Fixed Deliveries')
  AND aircraft_type != 'Cargo'
```

### Supported Operators

| Operator | Example |
|----------|---------|
| `=`, `!=` | `status = 'Active'` |
| `<`, `<=`, `>`, `>=` | `year >= 2020` |
| `IN (...)` | `status IN ('A', 'B', 'C')` |
| `NOT IN (...)` | `status NOT IN ('Retired')` |
| `LIKE` | `name LIKE 'A%'` (prefix), `LIKE '%A'` (suffix), `LIKE '%A%'` (contains) |
| `AND`, `OR` | Combine conditions |

Filter is applied **after** mapping, so use **target** column names.

---

## Validation

The import validation checks mapping rules against both source and target schemas:

### Source Validation

| Check | Severity |
|-------|----------|
| Column not in XLSX | Error |
| Unknown ENUM type in `random(Enum)` | Error |
| Source filter column not in XLSX | Error |
| Invalid regex in source filter | Error |
| First column not in XLSX | Error |
| Unused XLSX columns | Info |

### Target Validation

| Check | Severity |
|-------|----------|
| Column not in entity | Error |
| FK displayName not recognized | Error |
| Required column not mapped | Error |
| Optional column not mapped | Info |

FK columns (e.g., `current_operator_id`) are considered "covered" when the displayName (e.g., `current_operator`) is mapped.

---

## Data Flow & FK Validation

The import pipeline has distinct stages, each with different validation responsibilities:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Stage 1: XLSX → JSON (Run Tab)                                         │
│  ImportManager.runImport()                                              │
│                                                                         │
│  ✓ Parse XLSX file                                                      │
│  ✓ Apply source filter (regex on XLSX columns, before mapping)          │
│  ✓ Apply deduplication (First: directive)                               │
│  ✓ Apply column mapping (with transforms)                               │
│  ✓ Apply target filter clause (SQL-like, after mapping)                 │
│  ✗ NO FK validation (values are stored as-is)                           │
│                                                                         │
│  Output: data/import/{Entity}.json                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Stage 2: Preview (Load Tab → Preview Button)                           │
│  SeedManager.getConflictInfo()                                          │
│                                                                         │
│  ✓ Count records in JSON file                                           │
│  ✓ Detect conflicts (existing records by unique key)                    │
│  ✗ NO FK validation (preview is fast, FK check deferred)                │
│                                                                         │
│  Output: Record count, conflict count, sample records                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Stage 3: Load (Load Tab → Load Button)                                 │
│  SeedManager.loadEntity()                                               │
│                                                                         │
│  ✓ validateImport() — FK VALIDATION HAPPENS HERE                        │
│    - Check each FK field against target entity                          │
│    - Mark invalid rows (label not found in referenced table)            │
│    - Collect warnings with row number, field, value, target entity      │
│                                                                         │
│  ✓ resolveConceptualFKs() — Convert labels to IDs                       │
│    - "Lufthansa" → operator_id: 1                                       │
│    - Returns unresolved FK warnings                                     │
│                                                                         │
│  ✓ INSERT/UPDATE based on load mode                                     │
│    - merge: Update existing, insert new                                 │
│    - skip_conflicts: Insert only new records                            │
│    - replace: Clear table, insert all                                   │
│                                                                         │
│  Output: { loaded, updated, skipped, fkErrors }                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why FK Validation is Deferred

FK validation requires database queries to check if referenced records exist. Doing this during XLSX→JSON conversion would:
- Slow down the conversion significantly
- Require the referenced tables to be loaded first

By deferring FK validation to load time:
- Conversion stays fast
- User can review mapping errors first
- FK errors are reported with clear context (row, field, value, target)

### FK Error Reporting

When FK validation fails, the Load result includes:

```javascript
{
  success: true,
  loaded: 0,
  skipped: 1899,
  fkErrors: [
    { row: 1, field: "current_operator", value: "DLH",
      targetEntity: "Operator", message: "Row 1: \"DLH\" not found in Operator" },
    // ... up to 10 errors shown
  ],
  fkErrorsTotal: 1899  // Total count if more than 10
}
```

This helps identify:
- Which label values are missing in the referenced table
- Whether the referenced table needs to be seeded first
- Whether the mapping uses wrong labels

---

## Import Dialog

The unified import dialog (`Admin → Entity → Import...`) provides five tabs:

| Tab | Function |
|-----|----------|
| **Schema** | Shows XLSX column names for reference |
| **Rule** | Editable import definition with Save button |
| **Run** | Execute XLSX → JSON conversion |
| **Load** | Preview import JSON, detect conflicts, load to DB |
| **Paste** | Manual JSON/CSV paste (works without import definition) |

### Workflow

1. **Schema Tab**: Review XLSX columns to understand available source data
2. **Rule Tab**: Edit mapping rules, save, validation runs automatically
3. **Run Tab**: Click "Run Import" to generate `import/{Entity}.json`
4. **Load Tab**: Preview data, select mode (merge/skip/replace), load to DB

### Log Panel

A persistent log at the bottom shows messages from all operations:
- ✓ Success (green)
- ⚠ Warning (yellow)
- ✗ Error (red)

The log panel is resizable via drag handle.

---

## Directory Structure

```
app/systems/<system>/
├── docs/
│   ├── imports/           ← Import definition files
│   │   └── Aircraft.md
│   ├── classes/           ← Entity class definitions
│   ├── views/             ← View definitions (one file per view)
│   └── Crud.md            ← Entity visibility configuration
├── data/
│   ├── extern/            ← External XLSX files (gitignored)
│   │   └── FDB 2025-12-31.xlsx
│   ├── import/            ← Generated JSON from import
│   │   └── Aircraft.json
│   ├── seed/              ← Seed files (may include import output)
│   └── rap.sqlite
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/status` | GET | List available import definitions |
| `/api/import/run/:entity` | POST | Run XLSX → JSON conversion |
| `/api/import/definition/:entity` | GET | Get parsed import definition |
| `/api/import/definition/:entity/raw` | GET | Get raw markdown content |
| `/api/import/definition/:entity/raw` | PUT | Save raw markdown content |
| `/api/import/schema/:entity` | GET | Get XLSX column names |
| `/api/import/validate/:entity` | GET | Validate mapping against schemas |

---

## Files

| File | Role |
|------|------|
| `app/server/utils/ImportManager.js` | Core: parse definitions, read XLSX, apply mapping, filter, write JSON |
| `app/server/routers/import.router.js` | REST API for import operations |
| `app/static/rap/components/seed-import-dialog.js` | UI: unified import dialog with tabs |
| `app/systems/*/docs/imports/*.md` | Import definition files |
| `app/systems/*/data/extern/*.xlsx` | Source XLSX files |
| `app/systems/*/data/import/*.json` | Generated import JSON files |

---

## Relationship to Seed System

The import system generates JSON files that are **compatible with the seed pipeline**:

1. **Import**: `extern/*.xlsx` → `import/*.json` (via mapping rules)
2. **Seed**: `import/*.json` → Database (via Load tab or SeedManager)

Both use:
- Conceptual FK names (resolved to IDs during load)
- Same validation pipeline
- Same load modes (merge/skip/replace)

See [Seed Data System](seed-data.md) for details on FK resolution, load modes, and the validation pipeline.
