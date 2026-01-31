# Computed Foreign Keys

Algorithmically computed FK relationships that:
- Are defined by a **calculation rule**
- Are stored as **actual columns** in the table (redundant/materialized)
- Are updated **time-triggered** (CRON) or **immediately**
- Are READONLY (not manually editable)
- Are displayed like normal FKs in the UI

## Motivation

**Example: Aircraft.current_operator_id**
- Find Registration where `aircraft_id = Aircraft.id` AND `exit_date IS NULL OR exit_date > TODAY`
- From there: `operator_id` -> Operator
- There should only be one active Registration

**Important:** The change is often entered **in advance** (exit_date in the future).
This means: The update must NOT happen when saving, but must be executed **daily**!

---

## Markdown Syntax

### Annotation on Target Attribute

The computed attribute is defined **in the attribute table** with an annotation:

```markdown
## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... | ... | ... | ... |
| current_operator_id | int | Reference to Operator [READONLY] [DAILY=Registration[exit_date=null OR exit_date>TODAY].operator] | 5 |
```

### Annotation Syntax

| Annotation | Meaning | Use Case |
|------------|---------|----------|
| `[DAILY=rule]` | Recalculate daily at midnight (CRON) | Time-dependent rules (exit_date) |
| `[IMMEDIATE=rule]` | Immediately on change of source table | Non-time-dependent rules |
| `[HOURLY=rule]` | Hourly (CRON) | More time-critical cases |
| `[ON_DEMAND=rule]` | Manually via API/CLI | Rarely needed calculations |

**Why on the attribute instead of separate section?**
- The attribute is a real column -> belongs in the attribute table
- `[READONLY]` shows: not manually editable
- `[DAILY=...]` shows: when and how calculated
- Consistent with other annotations like `[DEFAULT=...]`

---

## Rule Syntax

```
Registration[exit_date=null OR exit_date>TODAY].operator
│          │                                  └── FK: operator_id -> Operator
│          └── Filter: WHERE exit_date IS NULL OR exit_date > CURRENT_DATE
└── Start Entity: WHERE aircraft_id = self.id (convention)
```

### Condition Syntax

Two modes are supported:

#### 1. Boolean Filter (WHERE clause)

| Syntax | Meaning |
|--------|---------|
| `[field=value]` | Equality (value=null → IS NULL) |
| `[field>value]` | Comparison |
| `[field<value]` | Comparison |
| `[cond1 OR cond2]` | Logical OR |
| `[cond1 AND cond2]` | Logical AND |
| `TODAY` | CURRENT_DATE (evaluated daily) |

**Example:** `[exit_date=null OR exit_date>TODAY]` → finds currently active record

#### 2. Aggregate Function (ORDER BY clause)

| Syntax | Meaning |
|--------|---------|
| `[MAX(field)]` | Record with highest value (NULL = highest priority) |
| `[MIN(field)]` | Record with lowest value (NULL = lowest priority) |

**Example:** `[MAX(end_date)]` → finds most recent record (current if end_date=null, else latest ended)

**Implicit NOT NULL filtering:** When the target field is a FK type (e.g., `latest_aircraft: Aircraft`), records where that FK is NULL are automatically excluded.

### Path Navigation

After the filter, a path through FK relationships follows:
- `.operator` -> navigates via `operator_id` to the Operator entity

The FK column is automatically derived from the entity name (`operator` -> `operator_id`).

---

## Redundant Display Label

In addition to the ID, the **display label** of the target record can also be stored:

```markdown
| current_operator_id | int | Reference to Operator [READONLY] [DAILY=...] | 5 |
| current_operator_name | string | Display label [READONLY] [DERIVED=current_operator_id] | Lufthansa |
```

`[DERIVED=column]` means: Automatically updated with the ID.

**Benefits:**
- No JOIN needed for display
- Immediate readability in queries
- Performance for listings

---

## Error Handling

| Situation | Behavior |
|-----------|----------|
| No match (no active Registration) | `current_operator_id = null` |
| Multiple matches (data inconsistency!) | `current_operator_id = null` + warning log |
| Target entity deleted | FK constraint prevents or CASCADE |

---

## Example: Process for Pre-dated Operator Change

```
Scenario: Aircraft D-AIUA changes on 2024-02-01 from Lufthansa to Eurowings

Day 1 (2024-01-15): User enters change
  └── Registration for Lufthansa: exit_date = '2024-02-01' (future!)
  └── Registration for Eurowings: entry_date = '2024-02-01'
  └── Aircraft.current_operator_id remains Lufthansa (exit_date > TODAY)

Days 2-16: No change
  └── DAILY job runs, but exit_date > TODAY -> Lufthansa remains

Day 17 (2024-02-01): CRON job at 00:05
  └── For Aircraft D-AIUA:
      └── Query: Registration WHERE aircraft_id=1001 AND (exit_date IS NULL OR exit_date > '2024-02-01')
      └── Result: Eurowings Registration (exit_date=null)
      └── UPDATE aircraft SET current_operator_id = (Eurowings ID) WHERE id = 1001

Result: Aircraft now shows Eurowings as current_operator
```

---

## Example: Engine.latest_aircraft with MAX()

**Scenario:** Find the aircraft where an engine was most recently mounted

```markdown
| latest_aircraft | Aircraft | [READONLY] [DAILY=EngineAllocation[MAX(end_date)].aircraft] | 1 |
```

**Generated SQL:**
```sql
UPDATE engine
SET latest_aircraft_id = (
    SELECT src.aircraft_id
    FROM engine_allocation src
    WHERE src.engine_id = engine.id
      AND src.aircraft_id IS NOT NULL    -- implicit: target type is Aircraft
    ORDER BY
      CASE WHEN src.end_date IS NULL THEN 1 ELSE 0 END DESC,  -- NULL = current = highest
      src.end_date DESC                                        -- then by date descending
    LIMIT 1
)
WHERE latest_aircraft_id IS NOT (...)
```

**Logic:**
1. Find all EngineAllocation records for this engine
2. Filter: only where aircraft IS NOT NULL (engine was on an aircraft, not in event/storage)
3. Priority: end_date=NULL first (currently mounted)
4. Then: highest end_date (most recently dismounted)
5. If no allocation exists → NULL

---

## Implementation

The technical implementation includes:

1. **SchemaGenerator.js** - Parse logic for `[DAILY=...]`, `[IMMEDIATE=...]`, `[MAX(...)]`, `[MIN(...)]`
2. **database.js** - Migration for new columns (ALTER TABLE ADD COLUMN)
3. **ComputedFieldService.js** - Calculation engine with SQL generation
4. **Scheduler** - Internal timer for DAILY updates at midnight
5. **UI Integration** - READONLY rendering for computed FKs

Status: **DAILY schedule implemented**, ONCHANGE triggers pending

---

## Supported Schedules

| Schedule | Status | Trigger |
|----------|--------|---------|
| `DAILY` | Implemented | Midnight + server startup |
| `IMMEDIATE` | Planned | On source table change |
| `HOURLY` | Planned | Every hour |
| `ON_DEMAND` | Planned | Manual API call |
| `ONCHANGE` | Planned | Database trigger on source table |

---

## Seed Generation

Computed columns are automatically excluded from seed generation:

- **prompt-builder.js**: Filters columns with `col.computed` from AI prompts
- **SeedManager.js**: Skips computed columns when loading seed data
- Values are calculated by ComputedFieldService after data is loaded
