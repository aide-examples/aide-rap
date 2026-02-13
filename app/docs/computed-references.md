# Computed Foreign Keys

Algorithmically computed FK relationships that:
- Are defined by a **calculation rule**
- Are stored as **actual columns** in the table (redundant/materialized)
- Are updated **time-triggered** (CRON) or **immediately**
- Are READONLY (not manually editable)
- Are displayed like normal FKs in the UI

## Motivation

**Example: Employee.current_department_id**
- Find Assignment where `employee_id = Employee.id` AND `end_date IS NULL OR end_date > TODAY`
- From there: `department_id` -> Department
- There should only be one active Assignment

**Important:** The change is often entered **in advance** (end_date in the future).
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
| current_department_id | int | Reference to Department [READONLY] [DAILY=Assignment[end_date=null OR end_date>TODAY].department] | 5 |
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
Assignment[end_date=null OR end_date>TODAY].department
│         │                                └── FK: department_id -> Department
│         └── Filter: WHERE end_date IS NULL OR end_date > CURRENT_DATE
└── Start Entity: WHERE employee_id = self.id (convention)
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

**Example:** `[end_date=null OR end_date>TODAY]` → finds currently active record

#### 2. Aggregate Function (ORDER BY clause)

| Syntax | Meaning |
|--------|---------|
| `[MAX(field)]` | Record with highest value (NULL = highest priority) |
| `[MIN(field)]` | Record with lowest value (NULL = lowest priority) |

**Example:** `[MAX(end_date)]` → finds most recent record (current if end_date=null, else latest ended)

**Implicit NOT NULL filtering:** When the target field is a FK type (e.g., `latest_project: Project`), records where that FK is NULL are automatically excluded.

#### 3. Tree Leaf Detection (IS_LEAF)

| Syntax | Meaning |
|--------|---------|
| `IS_LEAF(fk_column)` | True when no record in the same table references this record via the self-FK |

**Example:** `[DAILY=IS_LEAF(parent_type)]` → true for engine types with no sub-types

```markdown
| is_leaf | bool [DEFAULT=true] | Leaf node [READONLY] [DAILY=IS_LEAF(parent_type)] | true |
```

**Generated SQL:**
```sql
UPDATE engine_type
SET is_leaf = (
  CASE WHEN id NOT IN (
    SELECT parent_type_id FROM engine_type WHERE parent_type_id IS NOT NULL
  ) THEN 1 ELSE 0 END
)
WHERE is_leaf IS NOT (...)
```

**Use case:** Expose only leaf nodes via API filter (`?filter=is_leaf:1`) for external integrations that need concrete types, not category nodes.

### Path Navigation

After the filter, a path through FK relationships follows:
- `.department` -> navigates via `department_id` to the Department entity

The FK column is automatically derived from the entity name (`department` -> `department_id`).

---

## Redundant Display Label

In addition to the ID, the **display label** of the target record can also be stored:

```markdown
| current_department_id | int | Reference to Department [READONLY] [DAILY=...] | 5 |
| current_department_name | string | Display label [READONLY] [DERIVED=current_department_id] | Marketing |
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
| No match (no active Assignment) | `current_department_id = null` |
| Multiple matches (data inconsistency!) | `current_department_id = null` + warning log |
| Target entity deleted | FK constraint prevents or CASCADE |

---

## Example: Process for Pre-dated Department Transfer

```
Scenario: Employee EMP-1042 transfers on 2024-02-01 from Marketing to Engineering

Day 1 (2024-01-15): User enters transfer
  └── Assignment for Marketing: end_date = '2024-02-01' (future!)
  └── Assignment for Engineering: start_date = '2024-02-01'
  └── Employee.current_department_id remains Marketing (end_date > TODAY)

Days 2-16: No change
  └── DAILY job runs, but end_date > TODAY -> Marketing remains

Day 17 (2024-02-01): CRON job at 00:05
  └── For Employee EMP-1042:
      └── Query: Assignment WHERE employee_id=1001 AND (end_date IS NULL OR end_date > '2024-02-01')
      └── Result: Engineering Assignment (end_date=null)
      └── UPDATE employee SET current_department_id = (Engineering ID) WHERE id = 1001

Result: Employee now shows Engineering as current_department
```

---

## Example: Employee.latest_project with MAX()

**Scenario:** Find the project where an employee was most recently deployed

```markdown
| latest_project | Project | [READONLY] [DAILY=Deployment[MAX(end_date)].project] | 1 |
```

**Generated SQL:**
```sql
UPDATE employee
SET latest_project_id = (
    SELECT src.project_id
    FROM deployment src
    WHERE src.employee_id = employee.id
      AND src.project_id IS NOT NULL    -- implicit: target type is Project
    ORDER BY
      CASE WHEN src.end_date IS NULL THEN 1 ELSE 0 END DESC,  -- NULL = current = highest
      src.end_date DESC                                        -- then by date descending
    LIMIT 1
)
WHERE latest_project_id IS NOT (...)
```

**Logic:**
1. Find all Deployment records for this employee
2. Filter: only where project IS NOT NULL (employee was on a project, not on leave/bench)
3. Priority: end_date=NULL first (currently deployed)
4. Then: highest end_date (most recently completed)
5. If no deployment exists → NULL

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
