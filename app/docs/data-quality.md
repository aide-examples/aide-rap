# Data Quality Concept

Records with data quality deficits can be stored in the database alongside clean records. The system tracks the nature of each deficit and allows controlled data cleansing through the standard UI.

**Related documentation:**
- [Validation System](validation.md) — dual-layer validation, field/object rules
- [Import System](import-system.md) — import pipeline, transforms, FK resolution
- [Attribute Markers](attribute-markers.md) — constraint annotations ([UNIQUE], [OPTIONAL], etc.)

## System Fields

Two new internal fields are added to every entity (like `_version`, `_created_at`, `_updated_at`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `_ql` | INTEGER | 0 | Quality Level bitmask (0 = clean, indexed) |
| `_qd` | TEXT | NULL | Quality Deficit — JSON array of error details |

An INDEX is created on `_ql` for every table.

## Quality Level Bitmask

The `_ql` value is a bitmask. Multiple deficits combine via bitwise OR.

| Bit | Value | Meaning |
|-----|-------|---------|
| 0 | 1 | **Validation failure** — attribute violates a validation rule (regex, number range, etc.) |
| 1 | 2 | **Required field empty** — a non-OPTIONAL attribute has no value |
| 2 | 4 | **Required FK empty** — a non-OPTIONAL FK field has no value |
| 3 | 8 | **FK unresolvable** — FK field contains a label that cannot be resolved to an existing record |
| 4 | 16 | **Cross-field constraint** — an object-level constraint is violated |
| 8 | 256 | **System record** — null reference record (see below), never user-visible |

Examples:
- `_ql = 0` — clean record, appears in all normal queries
- `_ql = 3` — validation failure AND required field empty
- `_ql = 9` — validation failure AND unresolvable FK
- `_ql = 256` — null reference record (system)

## Quality Deficit Details (_qd)

When `_ql != 0`, the `_qd` field contains a JSON array documenting each deficit:

```json
[
  {"field": "isbn", "ql": 1, "value": "abc", "message": "Does not match pattern ^\\d{3}-\\d+$"},
  {"field": "title", "ql": 2, "value": null, "message": "Required field is empty"},
  {"field": "author_id", "ql": 8, "value": "Unknown Author", "message": "FK label not found in Author"}
]
```

Each entry records:
- `field` — the affected column name
- `ql` — the specific quality bit for this deficit
- `value` — the original value before neutralization
- `message` — human-readable description of the deficit

## Null Reference Records

Every table contains a **null reference record** at `id = 1` with `_ql = 256`. This record serves as the FK target for defective records whose FK values cannot be resolved.

### Properties

- **id**: Always 1
- **_ql**: 256 (system record marker)
- **_qd**: NULL
- **All attributes**: Filled with type-appropriate neutral values (see below)
- **All FK columns**: Point to id=1 of their respective target tables

### Lifecycle

- **Created automatically** when a table is created or after a schema change
- **Inserted in dependency order** (tables without FKs first, then tables referencing them)
- **Never exported** in seed/backup operations
- **Never visible** in normal UI or API queries (filtered by `WHERE _ql = 0`)
- **Never editable** or deletable through the API

## Neutral Values

When a record has quality deficits, the defective field values are replaced with **neutral values** — type-conformant substitutes that satisfy DB constraints (NOT NULL, UNIQUE excluded, FK references). The original values are preserved in `_qd`.

### Built-in Defaults

| Type | Neutral Value | Notes |
|------|---------------|-------|
| `string` | `"?"` | |
| `int` | `999999` | |
| `number` / `real` | `999999` | |
| `date` | `"1970-01-01"` | Unix epoch |
| `bool` / `boolean` | `0` (false) | |
| `url` | `"?"` | |
| `mail` | `"?"` | |
| `media` | `"?"` | |
| `json` | `"{}"` | Empty object |
| `geo` (latitude) | `0` | |
| `geo` (longitude) | `0` | |
| `address` (all sub-fields) | `"?"` (string) / `0` (number) | |
| `contact` (all sub-fields) | `"?"` | |
| FK reference | `1` | Points to null reference record |
| enum | *(first enum value)* | |
| pattern | `"?"` | |

### Override: [NULL=value]

Any attribute can override the built-in neutral value with the annotation `[NULL=value]` in the description column:

```markdown
| publishing_year | int | Year of publication [NULL=-1] |
```

This sets the neutral value for `publishing_year` to `-1` instead of the default `999999`.

## Query Filtering

**All regular queries** include `WHERE _ql = 0` (or `AND _ql = 0`). This applies to:

- Entity list queries (GET /api/entities/:entity)
- Detail queries (GET /api/entities/:entity/:id)
- Search / filter queries
- FK label lookups (dropdown population)
- Back-reference counts (tree view)
- View queries
- Seed/backup export

**Excluded from filtering** (see full data):

- Data cleansing mode queries (explicit `_ql` filter)
- Internal null record management

## Import with Quality Acceptance

Import definitions can specify which quality levels to accept:

```markdown
AcceptQL: 3
```

The value is a bitmask. `AcceptQL: 3` means accept records with bits 1 (validation) and/or 2 (required empty).

### Import Flow

1. Read source row and apply transforms
2. Attempt full validation (all rules)
3. If validation passes → insert with `_ql = 0`
4. If validation fails → compute `_ql` bitmask from failures
5. Check: are all set bits within the `AcceptQL` mask?
   - **Yes** → neutralize defective fields, record `_qd`, insert with computed `_ql`
   - **No** → reject record, write to error log (not stored in DB)
6. For FK resolution failures: unresolvable labels set the FK to id=1 (null reference)

### Neutralization Process

For each defective field:
1. Record original value in `_qd` entry
2. Replace field value with the neutral value for its type (or `[NULL=value]` override)
3. For unresolvable FKs: set column to `1` (null reference record)

## Data Cleansing UI

The standard CRUD interface supports a **cleansing mode** for repairing defective records.

### Activation

A new entry in the application settings allows the user to select which `_ql` bits to include:

| Setting | Description |
|---------|-------------|
| Quality Filter | Bitmask of _ql bits to show (e.g. 1, 3, 15, 31) |

When the quality filter is active (non-zero), the query changes from `WHERE _ql = 0` to `WHERE _ql = 0 OR (_ql & :mask) > 0` — showing clean records plus defective records matching the selected bits.

### Visual Indicators

- **Clean records** (`_ql = 0`): Normal appearance
- **Defective records** (`_ql > 0`): Yellow background highlight
- The `_ql` value and deficit count could be shown as a badge or tooltip

### Editing Defective Records

1. User opens a defective record in the edit dialog
2. The form shows current (neutralized) values — they are syntactically valid
3. The `_qd` information is displayed (original values, error messages)
4. User edits fields to fix some or all deficits
5. On save:
   - Full validation runs on the submitted data
   - New `_ql` is computed from remaining deficits
   - If `_ql = 0` → record becomes clean (normal save)
   - If `_ql > 0` → record is saved with updated `_ql` and `_qd`
   - The resulting `_ql` is displayed to the user after save

### Key Principle

It must be possible to save a record that still has deficits. The user might only fix one problem at a time. The system re-evaluates all rules on every save and updates `_ql` accordingly.

## Migration Strategy

For existing systems (e.g. IRMA) that already have data:

1. **Export** all entities via seed backup (LABEL-based, no raw IDs)
2. **Schema change** adds `_ql` and `_qd` columns, creates null reference records at id=1
3. **Restore** imports data — LABEL resolution assigns new IDs starting from 2
4. All restored records get `_ql = 0` (they were valid before)
5. From now on, defective records can be imported with `AcceptQL`

This works because seed export uses LABEL values for FK references, not raw IDs. The ID reassignment happens naturally.

## Implementation Phases

### Phase 1: Foundation
- Add `_ql` and `_qd` to system columns
- Define neutral values per type
- Create null reference records on table creation
- Add `WHERE _ql = 0` to all read queries in GenericRepository

### Phase 2: Import Support
- Parse `AcceptQL` directive in import definitions
- Modify validation to return quality info instead of throwing
- Implement neutralization and `_qd` recording
- Support defective FK resolution (→ id=1)

### Phase 3: Data Cleansing UI
- Quality filter setting
- Visual indicators for defective records
- Display `_qd` info in edit dialog
- Allow saving with remaining deficits
- Show resulting `_ql` after save

### Phase 4: Backup/Restore Integration
- Exclude null reference records from export
- Ensure null records exist before restore
- Handle `_ql` and `_qd` in export/import format
