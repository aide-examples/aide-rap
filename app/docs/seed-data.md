# Seed Data System

Reference for the seed data pipeline — how data flows from AI generation through validation to database insertion.

---

## FK Label Resolution

Seed files use **conceptual field names** with **label values** instead of raw IDs:

```json
{ "type": "Airbus A320neo", "current_operator": "Lufthansa" }
```

The system resolves labels to IDs automatically during load:

1. `type: "Airbus A320neo"` → look up AircraftType by LABEL → `type_id: 3`
2. `current_operator: "Lufthansa"` → look up Operator by LABEL → `current_operator_id: 1`

### Lookup Keys

For each FK target entity, a lookup map is built from the database (or seed file fallback):

| Key Format | Example | Source |
|-----------|---------|--------|
| LABEL value | `Airbus A320neo` | Primary label column (`[LABEL]`) |
| LABEL2 value | `2015-03-12` | Secondary label column (`[LABEL2]`) |
| Combined | `GE-900101 (2015-03-12)` | `"LABEL (LABEL2)"` format |
| Index | `#1`, `#2`, ... | Row position (1-based) |

### Technical Name Fallback

AI models sometimes write `engine_id: "GE-900101"` instead of the instructed `engine: "GE-900101"`. The system handles both:

- **Conceptual name** (`engine`): Standard resolution path
- **Technical name** (`engine_id`) with non-numeric string: Treated as a label, resolved identically

This prevents silent data loss where a string label in an INTEGER column would result in NULL.

### Seed File Fallback

When the FK target table is empty (entity not loaded yet), the system falls back to reading the target entity's seed JSON file. These records get synthetic IDs (`1, 2, 3, ...`) for label lookup. This enables generating data for dependent entities before loading the full dependency chain.

---

## Load Modes

When loading seed data, three modes control how existing records are handled:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `replace` | `INSERT OR REPLACE` — may create duplicates if no ID in seed data | Fresh load into empty table |
| `merge` | `UPDATE` existing (by unique key), `INSERT` new | Re-loading after edits, **default for Load All** |
| `skip_conflicts` | Skip records matching existing unique keys, `INSERT` only new ones | Adding new records without touching existing |

### Duplicate Detection

Records are matched against existing data using:

1. Columns with explicit `[UNIQUE]` annotation
2. Composite unique keys (e.g., `UK1` groups)
3. **LABEL column fallback** — when no explicit unique constraints exist, the `[LABEL]` column serves as business key

This prevents the main pitfall: loading the same seed file twice creates duplicates when using `replace` mode (because seed files have no `id` field, so SQLite always inserts new rows).

### Load Preview

The "Load..." action opens a preview dialog showing:
- All records from the seed file
- Conflict count (how many already exist in DB)
- Mode selector (keep existing vs. overwrite)

**Load All** uses `merge` mode by default to prevent accidental duplicates.

---

## Computed FK Columns

Columns annotated with computed expressions like `[DAILY=Registration[...].operator]` are normally excluded from INSERT operations since their values are auto-calculated.

**Exception**: Computed columns that are foreign keys are **included** in both:
- **AI prompt schema** — provides relationship context for data generation
- **Seed INSERT/UPDATE** — allows initial values from seed data

This means `current_operator: "Lufthansa"` in an Aircraft seed file will be stored as `current_operator_id: 1`, even though the column is `[READONLY]` with a `[DAILY=...]` computation. The daily computation will maintain the value going forward based on Registration data.

---

## AI Prompt Construction

The prompt sent to the AI includes:

| Section | Content |
|---------|---------|
| Entity Schema | Column names, types, nullable flags (excluding non-FK computed columns) |
| Type Definitions | Pattern regexes, enum mappings |
| Instruction | From `## Data Generator` section in entity Markdown |
| FK References | All records from referenced entities (label + id) |
| Referencing Entities | Records from entities that have FK columns pointing here (back-references) |
| Seed Context | Validation/constraint data from `## Seed Context` section |

### Prompt Rules for AI

- Use **label values** for FK fields, not IDs
- Use **conceptual names** without `_id` suffix
- Return compact JSON array only
- Respect pattern/enum type constraints

---

## Generate & Complete Dialog

The Seed Generator Dialog supports two modes accessible via context menu:

| Mode | Menu Item | MD Section | Purpose |
|------|-----------|------------|---------|
| **Generate** | 🤖 Generate... | `## Data Generator` | Create new records from scratch |
| **Complete** | ✨ Complete... | `## Data Completer` | Fill missing attributes in existing records |

### Workflow (Both Modes)

1. **Instruction Tab** — Shows instruction from entity markdown (editable, saveable)
2. **Build AI Prompt** — Generates prompt including schema, FK references, context
3. **Copy to Clipboard** — User pastes into external AI (Claude, GPT, Gemini)
4. **Paste Response** — AI output is parsed and validated
5. **Review Tab** — Shows parsed records with validation status
6. **Save / Save & Load** — Writes to seed file and optionally loads to DB

### Complete Mode Differences

The Complete mode prompt includes:

- **Existing records** from the database (with their IDs)
- Instruction to **keep IDs unchanged** (critical for UPDATE operations)
- Instruction to only modify NULL/missing fields (unless stated otherwise)

Example `## Data Completer` section:

```markdown
## Data Completer

The values for number_of_engines may be wrong; max_passengers and max_range_nm
only contain dummy values. Fill in correct and plausible values based on your
knowledge and on additional research in the web. Keep all other values as they are.
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/entity/:name/generator-instruction` | GET/PUT | Read/write `## Data Generator` section |
| `/api/entity/:name/completer-instruction` | GET/PUT | Read/write `## Data Completer` section |
| `/api/seed/prompt/:entity` | POST | Build generate prompt (new records) |
| `/api/seed/complete-prompt/:entity` | POST | Build complete prompt (includes existing records) |
| `/api/seed/parse/:entity` | POST | Parse AI response, validate records |

---

## Validation Pipeline

When pasting AI output or importing data, validation checks:

| Check | Effect |
|-------|--------|
| FK label lookup | Warning + row marked invalid if label not found in target entity |
| FK technical name detection | Same check applied when AI uses `_id` suffix with label string |
| Unique key conflicts | Warning with back-reference count (how many related records exist) |
| Composite unique keys | Same, for multi-column unique constraints |

Invalid rows can be skipped during load (`skipInvalid: true`).

---

## Data Flow Summary

```
Entity Markdown          AI Assistant
  (## Data Generator)       (Claude, GPT, Gemini)
         │                        │
         ▼                        ▼
   Build Prompt ──── Copy ────► Generate
         │                        │
         │                   Paste Response
         │                        │
         ▼                        ▼
   FK References             Parse JSON/CSV
   Back-References                │
   Seed Context                   ▼
                             Validate
                            (FK lookup, uniqueness)
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
                     Save to          Save & Load
                    seed/*.json     (seed file + DB)
                                          │
                                          ▼
                                   resolveConceptualFKs
                                   (label → id)
                                          │
                                          ▼
                                   INSERT/UPDATE
                                   (merge/skip/replace)
```

---

## Backup & Restore

### Directory Structure

```
app/systems/<system>/data/
├── seed/              ← Hand-crafted or AI-generated seed files
│   ├── Aircraft.json
│   └── Engine.json
├── backup/            ← Auto or manual backup of current DB state
│   ├── Aircraft.json
│   └── Engine.json
└── rap.sqlite         ← SQLite database (gitignored)
```

### Backup Format

Backup files use the **same JSON format** as seed files — FK values stored as label strings for portability:

```json
[
  {
    "registration": "D-ABAA",
    "serial_number": "MSN1501",
    "type": "Airbus A319-112",
    "current_operator": "Lufthansa"
  }
]
```

Auto-increment `id` fields and computed columns are excluded.

### Auto-Backup

When `initDatabase()` detects a schema hash change, it **automatically backs up all entity data** before dropping tables. This runs on:

- **Server startup** (if DataModel.md changed since last run)
- **Reinitialize** (in-app button triggers `reinitialize()` → `initDatabase()`)

The auto-backup converts FK IDs to label values using the still-existing reference tables, ensuring labels resolve correctly even after schema rebuild.

### Manual Backup

The **Backup** button in the Admin Seed Manager exports all current DB data to `data/backup/`. This overwrites any existing backup files. Empty entities have their backup file removed.

### Restore

The **Restore** button clears all tables and reloads from `data/backup/` in dependency order. FK labels are resolved against the freshly loaded reference data.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/seed/backup` | POST | Export all DB data to backup directory |
| `/api/seed/restore-backup` | POST | Clear DB, reload from backup files |
| `/api/seed/reinitialize` | POST | Re-read DataModel.md, rebuild schema (auto-backup if changed) |

---

## Files

| File | Role |
|------|------|
| `app/server/utils/SeedManager.js` | Core: load, validate, resolve FKs, backup, restore |
| `app/server/config/database.js` | Schema init, hash comparison, auto-backup, reinitialize |
| `app/server/services/prompt-builder.js` | Build AI prompts, parse responses, load FK/context data |
| `app/server/routers/seed.router.js` | REST API for seed, backup, restore, reinitialize |
| `app/server/routers/prompt.router.js` | REST API for prompt building and response parsing |
| `app/static/rap/components/seed-manager.js` | UI: entity overview, context menu, bulk operations |
| `app/static/rap/components/seed-generator-dialog.js` | UI: instruction → prompt → paste → review workflow |
| `app/static/rap/components/seed-preview-dialog.js` | UI: load preview with conflict detection, export |
| `app/static/rap/components/seed-import-dialog.js` | UI: paste/drop JSON or CSV, validate, save |
| `app/systems/*/data/seed/*.json` | Seed data files (one per entity) |
| `app/systems/*/data/backup/*.json` | Backup data files (auto or manual, gitignored) |
