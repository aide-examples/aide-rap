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

## Files

| File | Role |
|------|------|
| `app/server/utils/SeedManager.js` | Core: load, validate, resolve FKs, conflict detection |
| `app/server/services/prompt-builder.js` | Build AI prompts, parse responses, load FK/context data |
| `app/server/routers/seed.router.js` | REST API for seed operations |
| `app/server/routers/prompt.router.js` | REST API for prompt building and response parsing |
| `app/static/rap/components/seed-manager.js` | UI: entity overview, context menu, bulk operations |
| `app/static/rap/components/seed-generator-dialog.js` | UI: instruction → prompt → paste → review workflow |
| `app/static/rap/components/seed-preview-dialog.js` | UI: load preview with conflict detection, export |
| `app/static/rap/components/seed-import-dialog.js` | UI: paste/drop JSON or CSV, validate, save |
| `app/systems/*/data/seed/*.json` | Seed data files (one per entity) |
