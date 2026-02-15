# XLSX Import System

Reference for the XLSX import pipeline — how external spreadsheet data flows through mapping rules to JSON seed files and into the database.

---

## Overview

The import system converts external XLSX files into seed-compatible JSON using declarative mapping rules defined in Markdown files.

```
extern/Staff.xlsx  →  docs/imports/Employee.md  →  import/Employee.json  →  Database
    (XLSX)              (Mapping Rules)           (JSON Seed)             (SQLite)
```

This separates data acquisition (XLSX from external systems) from data transformation (mapping) and loading (seed pipeline).

---

## Import Definition Files

Each entity can have an import definition in `docs/imports/{Entity}.md`:

```markdown
# Employee Import

Source: extern/Staff Export 2025-12-31.xlsx
Sheet: Sheet1
MaxRows: 100000
Limit: 50

## Mapping

| Source                | Target              | Transform       |
|-----------------------|---------------------|-----------------|
| Employee Number       | emp_code            | string          |
| Full Name             | name                |                 |
| Department            | department          |                 |
| Hire Date             | hire_date           | date:DD.MM.YYYY |

## Filter

WHERE status IN ('Active', 'On Leave', 'Probation')
```

### Header Directives

| Directive | Required | Description |
|-----------|----------|-------------|
| `Source:` | Yes | Path to XLSX file relative to `data/` |
| `Sheet:` | No | Sheet name (default: first sheet) |
| `MaxRows:` | No | Row limit for XLSX reading (default: 100000) |
| `Limit:` | No | Row limit applied early (caps XLSX reading for fast testing) |
| `First:` | No | Deduplicate rows by this source column (keep first occurrence) |
| `AcceptQL:` | No | Quality deficit acceptance bitmask (see [Data Quality](data-quality.md)) |

**MaxRows vs Limit:**
- `MaxRows` limits how many rows are read from the XLSX file (performance optimization for very large files)
- `Limit` caps how many rows are read from the XLSX (for fast testing with a small subset)

---

## Source Expressions

The **Source** column in the mapping table supports several expression types:

| Type | Syntax | Example | Description |
|------|--------|---------|-------------|
| Column | `Name` | `Full Name` | Value from XLSX column |
| Number | `42` | `1000` | Fixed numeric value |
| String | `"text"` | `"Engineering"` | Fixed string value |
| Random Number | `random(min,max)` | `random(1000,2000)` | Random integer in range |
| Random Choice | `random("a","b")` | `random("A","B","C")` | Random selection from strings |
| Random Enum | `random(EnumType)` | `random(CurrencyCode)` | Random internal value from enum type |
| Concat | `concat(a, b, ...)` | `concat(First, " ", Last)` | Combine columns with separators |
| Calc | `calc(expr)` | `calc(Price * Factor)` | Arithmetic expression with columns |

### Examples

```markdown
| Source                        | Target              | Transform       |
|-------------------------------|---------------------|-----------------|
| Employee Number               | emp_code            | string          |
| "Engineering"                 | department          |                 |
| random(1000,5000)             | hours_worked        |                 |
| random("A","B","C")           | performance_grade   |                 |
| random(EmpStatus)             | status              |                 |
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
| Conceptual | `department` | FK display name (without `_id`) |
| Technical | `department_id` | Actual DB column name |

Using **conceptual names** is recommended. The seed pipeline will resolve them to IDs automatically (see [Seed Data: FK Label Resolution](seed-data.md#fk-label-resolution)).

---

## Transforms

The **Transform** column applies conversions to source values:

| Transform | Description | Example |
|-----------|-------------|---------|
| `string` | Force string type | `424114` → `"424114"` |
| `date:DD.MM.YYYY` | German date format → ISO | `01.06.2020` → `2020-06-01` |
| `date:MM/DD/YYYY` | US date format → ISO | `06/01/2020` → `2020-06-01` |
| `date:YYYY-MM-DD` | ISO format (passthrough) | — |
| `number` | Parse with German decimal (`,` → `.`) | `1.234,56` → `1234.56` |
| `trim` | Remove whitespace | — |
| `replace:/pattern/replacement/flags` | Regex replacement | See below |
| `concat:Column:separator` | Combine with another column | See below |

Excel serial dates (numeric) are automatically converted when a date transform is specified.

### String Transform

The `string` transform forces a value to be stored as a string, preventing numeric interpretation:

```markdown
| Source | Target | Transform |
|--------|--------|-----------|
| Emp Nr | emp_code      | string |
```

**When to use:**
- Serial numbers that look numeric but should remain strings (`424114` not `424114.0`)
- Codes with leading zeros that must be preserved (`00123`)
- Any field where Excel might interpret the value as a number

### Regex Replace

The `replace:/pattern/replacement/flags` transform applies a JavaScript regex replacement:

```markdown
| Source      | Target      | Transform                      |
|-------------|-------------|--------------------------------|
| Dept Code   | department  | replace:/^(DEP)(\d)/$1-$2/     |
| Code        | code        | replace:/[^A-Z0-9]//g          |
| Name        | name        | replace:/\s+/ /g               |
```

- **pattern**: JavaScript regex pattern
- **replacement**: Replacement string (supports `$1`, `$2` for capture groups)
- **flags**: Optional flags (`g` = global, `i` = case-insensitive, etc.)

Examples:
- `replace:/^(DEP)(\d)/$1-$2/` — "DEP100" → "DEP-100"
- `replace:/[^A-Z0-9]//g` — Remove non-alphanumeric
- `replace:/\s+/ /g` — Collapse multiple spaces

### Concat Transform

The `concat:OtherColumn:separator` transform combines the current column value with another source column:

```markdown
| Source       | Target     | Transform              |
|--------------|------------|------------------------|
| Manufacturer | identifier | concat:SerialNumber:-  |
| SerialNumber |            |                        |
```

This produces `"Acme-PRJ001"` from `Manufacturer="Acme"` and `SerialNumber="PRJ001"`.

**Syntax:** `concat:ColumnName:separator`
- **ColumnName**: The other XLSX column to append
- **separator**: Character(s) between the values (use `-` or `_` or ` `)

**Use case:** Creating composite identifiers for FK resolution when the target entity uses `[LABEL=concat(...)]`.

---

## Source Edit

The `## Source Edit` section applies regex replacements to XLSX source data **before** filtering and mapping. This is useful when source data has inconsistent formatting (varying capitalization, extra spaces, inconsistent naming).

```markdown
## Source Edit

Department Code: /^(DEP)([0-9])/DEP-$2/
Department Code: /^(HR)([0-9])/HR-$2/
Employee ID: /^#.*//
Level: /^UNASSIGNED$/0/
```

### Syntax

Each line specifies a column and a regex replacement:
```
ColumnName: /pattern/replacement/flags
```

- **ColumnName**: Exact XLSX column name
- **/pattern/replacement/flags**: JavaScript regex replacement (same syntax as `String.replace()`)
- Multiple expressions per column are allowed and applied in order
- Regex objects are pre-compiled once before the row loop for performance

### Pipeline Position

```
XLSX read → Limit → Source Edit → Source Filter → First → Mapping → Filter
```

Source Edit runs **before** Source Filter, so filtered rows already contain cleaned data. This ensures filters match consistently regardless of source data variations.

### Extensibility

Lines starting with `/` are regex replacements. Future operations (e.g., `lowercase`, `trim`) would use different syntax without leading `/` and be handled by a separate parser branch.

---

## Source Filter

The `## Source Filter` section filters XLSX rows **before** mapping, using regex patterns on source columns:

```markdown
## Source Filter

Employee Status: /^(Active|On Leave)$/
Department: /^(Engineering|Marketing)/
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

**NULL Handling:** Rows where the `First` column is NULL or empty are **not deduplicated** — all such rows are kept. This is by design: if you want to filter out empty values, use a Source Filter:

```markdown
First: Lessor

## Source Filter
Lessor: /.+/
```

---

## Quality Acceptance (AcceptQL)

The `AcceptQL:` directive controls how records with data quality deficits are handled during load. Without AcceptQL, records that fail FK resolution or validation are skipped. With AcceptQL, they are stored with quality metadata for later repair.

```markdown
Source: extern/data.xlsx
AcceptQL: 8
```

The value is a bitmask matching the [quality level bits](data-quality.md#quality-level-bitmask):

| Value | Accepts |
|-------|---------|
| 1 | Validation failures |
| 2 | Required fields empty |
| 4 | Required FK fields empty |
| 8 | FK labels unresolvable |
| 15 | All of the above |

**Accept logic:** `(computedQL & ~acceptQL) === 0` — all deficit bits must be within the mask.

**Example:** `AcceptQL: 8` accepts records with unresolvable FK labels but rejects records with validation failures or empty required fields.

When a record is accepted with deficits:
1. Defective fields are replaced with [neutral values](data-quality.md#neutral-values)
2. Unresolvable FKs point to the null reference record (id=1)
3. Original values and error details are preserved in `_qd`
4. The record is stored with `_ql` = computed deficit bitmask
5. The record is hidden from normal API queries (`WHERE _ql = 0`)

The AcceptQL value is stored in a `.meta.json` file alongside the import JSON, so the seed pipeline picks it up automatically during load.

---

## Filter Clause

The `## Filter` section supports SQL-like WHERE syntax:

```markdown
## Filter

WHERE status IN ('Active', 'On Leave')
  AND department != 'Temporary'
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

FK columns (e.g., `department_id`) are considered "covered" when the displayName (e.g., `department`) is mapped.

---

## Data Flow & FK Validation

The import pipeline has distinct stages, each with different validation responsibilities:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Stage 1: XLSX → JSON (Run Tab)                                         │
│  ImportManager.runImport()                                              │
│                                                                         │
│  ✓ Parse XLSX file                                                      │
│  ✓ Apply limit (truncate early for testing)                             │
│  ✓ Apply source edit (regex replacements on XLSX columns)               │
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
│    - "Marketing" → department_id: 1                                      │
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

### Fuzzy FK Resolution

When an exact label match fails, the system tries **fuzzy matching** for entities with `concat`-based labels. This handles cases where the import provides abbreviated references.

**Example:** Project has `[LABEL=concat(client, '-', code)]` which resolves to `"Acme-Corp-PRJ001"`, but the import provides `"Acme-PRJ001"` (shortened client name).

**Algorithm:** The import value and each label are split by the concat separator (e.g., `-`). If the import segments are a **subsequence** of the label segments, it's a match. A match is accepted only if **exactly one** candidate is found (unambiguous).

```
Import:  "Acme-PRJ001"      → ["Acme", "PRJ001"]
Label:   "Acme-Corp-PRJ001" → ["Acme", "Corp", "PRJ001"]
→ ["Acme", "PRJ001"] is a subsequence → Match!
```

Fuzzy matches are **cached** in the lookup map, so subsequent records with the same value resolve in O(1). The load result includes a `fuzzyMatches` array with all resolved mappings and counts.

---

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
    { row: 1, field: "department", value: "Mktg",
      targetEntity: "Department", message: "Row 1: \"Mktg\" not found in Department" },
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
│   │   └── Employee.md
│   ├── classes/           ← Entity class definitions
│   ├── views/             ← View definitions (one file per view)
│   └── Crud.md            ← Entity visibility configuration
├── data/
│   ├── extern/            ← External XLSX files (gitignored)
│   │   └── Staff Export 2025-12-31.xlsx
│   ├── import/            ← Generated JSON from import
│   │   └── Employee.json
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

## API Refresh — Live Updates from External APIs

API Refresh is a mechanism for periodically pulling data from external REST APIs into existing entity records. Unlike the XLSX import pipeline (which creates new records), a refresh **updates** existing records by matching on a key field.

### Use Case

An entity has some fields that are managed locally (e.g., `serial_number`, `type`) and others that come from an external system (e.g., GPS coordinates, sensor readings from a tracking API). API Refresh fetches the external data and writes it into the matching records.

```
External API  →  docs/imports/Entity.refreshName.md  →  UPDATE existing records
  (JSON)              (Mapping + Match Rule)                  (SQLite)
```

### Entity Annotations

Two entity-level annotations and one column-level annotation control API Refresh:

**Entity level** (in the header area of the entity `.md` file):

| Annotation | Description |
|------------|-------------|
| `[API_REFRESH: name]` | Declares that this entity can be refreshed from an external API. `name` identifies the refresh definition (e.g., `tracker`). Multiple annotations allowed. |
| `[API_REFRESH_ON_LOAD: name]` | (Reserved) Auto-refresh when the CRUD dialog opens. Implies `[API_REFRESH: name]`. Not yet implemented in UI. |

**Column level** (in the Description column of the attribute table):

| Annotation | Description |
|------------|-------------|
| `[API: name]` | Marks this column as populated by API refresh. Used for visual styling in the table header (dashed underline). |

### Example Entity

```markdown
# EngineStand

[API_REFRESH: tracker]

Engine transport stand. Location data refreshed via tracking API.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Stand identifier [LABEL] [UNIQUE] | Stand-A1 |
| kirsen_id | int [OPTIONAL] | Tracking device ID | 4711 |
| latitude | number [OPTIONAL] | GPS latitude [READONLY] [API: tracker] | |
| longitude | number [OPTIONAL] | GPS longitude [READONLY] [API: tracker] | |
| battery_pct | number [OPTIONAL] | Battery level [READONLY] [API: tracker] | |
```

### Refresh Import Definition

Refresh definitions follow the same format as regular import definitions but live in files named `{Entity}.{refreshName}.md` and include a `Match:` directive:

```markdown
# EngineStand Refresh: tracker

Source: https://control.example.com/api/v2/locations/
AuthKey: exampleApi
Match: kirsen_id = id

## Mapping

| Source | Target | Transform |
|--------|--------|-----------|
| latitude | latitude | |
| longitude | longitude | |
| temperature | temperature_c | |
| battery | battery_pct | |
| datetime_coords | last_position_at | timestamp |
```

**Directives specific to refresh:**

| Directive | Required | Description |
|-----------|----------|-------------|
| `Match:` | Yes | Match rule: `entityField = apiField`. Links entity records to API records. |
| `AuthKey:` | No | Key in `config.json` containing `login` and `password` for HTTP Basic Auth. |
| `Source:` | Yes | API URL (must return JSON array or object with data path). |

The `Match:` directive defines how entity records are joined to API records:
- **entityField**: Column in the entity table (e.g., `kirsen_id`)
- **apiField**: Field in the API response (e.g., `id`)

Only records where the entity field matches an API record's field are updated. Records without a match value (NULL) are skipped.

### Timestamp Transform

The `timestamp` transform converts Unix timestamps (seconds since epoch) to ISO datetime strings:

| Transform | Input | Output |
|-----------|-------|--------|
| `timestamp` | `1770799075` | `2026-02-11 08:37:55` |

### How It Works

```
1. Fetch all records from external API (GET Source URL)
2. Apply mapping + transforms to each API record
3. Build match index: entityField value → database record ID
4. For each API record with a matching entity record: UPDATE mapped fields
5. Return statistics: { matched, updated, skipped, notFound }
```

Updates are executed as direct SQL within a transaction. They do **not** go through the GenericService event pipeline and therefore:
- Do **not** trigger AuditTrail entries
- Do **not** emit `entity:update:before/after` events
- Do **not** increment the `_version` field

This is intentional — API refreshes are high-frequency, automated data updates that would create noise in the audit trail.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/refresh/:entity/:refreshName` | POST | Bulk refresh — updates all matching records |
| `/api/import/refresh/:entity/:refreshName/:id` | POST | Single record refresh — updates only the specified record |

Both endpoints require admin authentication.

### UI Integration

When an entity has `[API_REFRESH]` configured:

- **Entity Explorer toolbar**: A refresh button appears when the entity is selected. Clicking it triggers a bulk refresh for all configured refresh names and reloads the table.
- **Context menu**: Right-clicking a record shows "Refresh *name*" items. Clicking triggers a single-record refresh for that record.
- **Table headers**: Columns with `[API: name]` get a dashed underline (CSS class `api-source-col`) to visually distinguish API-populated fields.

### Config: API Credentials

API credentials referenced by `AuthKey:` are stored in `config.json`:

```json
{
    "exampleApi": {
        "login": "user",
        "password": "secret"
    }
}
```

The system uses HTTP Basic Auth with these credentials when fetching the API.

---

## Files

| File | Role |
|------|------|
| `app/server/utils/ImportManager.js` | Core: parse definitions, read XLSX, apply mapping, filter, write JSON, run API refresh |
| `app/server/utils/SeedManager.js` | Seed loading, FK resolution, refresh entity updates |
| `app/server/routers/import.router.js` | REST API for import and refresh operations |
| `app/static/rap/components/seed-import-dialog.js` | UI: unified import dialog with tabs |
| `app/systems/*/docs/imports/*.md` | Import definition files |
| `app/systems/*/docs/imports/*.*.md` | Refresh definition files (Entity.refreshName.md) |
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
