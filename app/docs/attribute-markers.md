# Attribute Markers Reference

> Comprehensive reference for attribute annotations in entity Markdown files.

Attribute descriptions can include special tags in square brackets `[TAG]` to control database constraints and UI behavior.

---

## Database Constraints

| Tag | Description | SQL Effect |
|-----|-------------|------------|
| `[UNIQUE]` | Single field uniqueness constraint | `UNIQUE` constraint on column |
| `[UK1]`, `[UK2]`, ... | Composite unique key | Fields with same UKn form a composite unique constraint |
| `[INDEX]` | Single field index | Creates index on column |
| `[IX1]`, `[IX2]`, ... | Composite index | Fields with same IXn form a composite index |

---

## Type Annotations

Type annotations are placed in the **Type column** after the type name.

| Tag | Description | Effect |
|-----|-------------|--------|
| `[OPTIONAL]` | Nullable field | Column allows NULL values |
| `[DEFAULT=x]` | Explicit default value | SQL DEFAULT clause, **implies OPTIONAL** |

> **Note:** `[DEFAULT=x]` automatically makes the field optional. If there's a default value, the field doesn't need to be provided during INSERT.

### Hierarchical Default System

1. **Explicit default** `[DEFAULT=x]` - highest priority
2. **Type-specific default** - Enum: first value, Pattern: example from Types.md
3. **Built-in type default** - `int`: 0, `string`: '', `date`: CURRENT_DATE, `boolean`: false

**When to use `[DEFAULT=x]`:**

Only specify `[DEFAULT=x]` if you need a value **different** from the automatic type default. For example:
- An enum field where the default should NOT be the first value
- A string field that should have a specific non-empty default

**For Enum types, use the EXTERNAL representation:**

```markdown
| maintenance_category | MaintenanceCategory [DEFAULT=Line] | Current category | B |
| status | FindingStatus [DEFAULT=Open] | Finding status | 2 |
```

The external value (e.g., "Line", "Open") is automatically mapped to the internal value (e.g., "A", 1) during processing.

---

## UI Display Annotations

| Tag | Description | Usage |
|-----|-------------|-------|
| `[LABEL]` | Primary display label | Node title in tree view, dropdown labels |
| `[LABEL2]` | Secondary display label | Node subtitle, shown in parentheses |
| `[READONLY]` | Non-editable field | Displayed but cannot be modified in forms |
| `[HIDDEN]` | Never displayed | Field exists in DB but not shown in UI |
| `[TRUNCATE=n]` | Truncate display to n characters | Full text shown in tooltip on hover |
| `[NOWRAP]` | Prevent text wrapping | Short values stay on single line |

### Entity-Level Computed LABEL

Instead of marking a column with `[LABEL]`, you can define a **computed label expression** at the entity level. This is useful when the display label should combine multiple fields without creating a redundant database column.

**Syntax** (placed before `## Attributes`):

```markdown
# Project

[LABEL=concat(client, ' - ', project_ref)]
[LABEL2=start_date]

## Attributes
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| project_ref | string | [UK1] | PRJ-2024-001 |
| client | string | [UK1] | Acme Corp |
| start_date | date | | 2024-01-15 |
```

**Supported expressions:**

| Expression | Example | Result |
|------------|---------|--------|
| `concat(a, 'sep', b)` | `concat(client, ' - ', ref)` | `Acme Corp - PRJ-2024-001` |
| Single field | `project_ref` | `PRJ-2024-001` |

**How it works:**

1. **SQL View**: A computed `_label` column is added to the entity's view:
   ```sql
   CREATE VIEW project_view AS
   SELECT *, (client || ' - ' || project_ref) AS _label
   FROM project;
   ```

2. **FK Dropdowns**: Use the computed `_label` for display instead of a column value

3. **FK Resolution**: During import/seed, label values are matched against the computed expression

4. **No DB Column**: The label exists only in the view — no redundant storage

**When to use:**

| Scenario | Use |
|----------|-----|
| Single column is naturally unique | Column-level `[LABEL]` |
| Label should combine multiple fields | Entity-level `[LABEL=concat(...)]` |
| LABEL column would duplicate unique key | Entity-level expression |

**Precedence:** Entity-level `[LABEL=...]` overrides any column-level `[LABEL]` annotation.

### Computed Entity (PAIRS)

Define an entity whose data is **automatically derived** from existing relationships. The `[PAIRS=...]` annotation creates an M:N mapping table by extracting distinct FK chain combinations from a source entity.

**Syntax** (placed before `## Attributes`):

```markdown
# EngineTypeCompatibility

[PAIRS=EngineAllocation(engine.type, aircraft.type)]

Maps engine types to compatible aircraft types, derived from allocation history.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| engine_type | EngineType | Engine type [UK1] | 1 |
| aircraft_type | AircraftType | Compatible aircraft type [UK1] | 1 |
```

**Annotation format:** `[PAIRS=SourceEntity(chain1, chain2)]`

| Part | Meaning | Example |
|------|---------|---------|
| `SourceEntity` | Table to scan | `EngineAllocation` |
| `chain1` | FK chain for first attribute | `engine.type` → Allocation.engine → Engine.type → EngineType |
| `chain2` | FK chain for second attribute | `aircraft.type` → Allocation.aircraft → Aircraft.type → AircraftType |

Each chain follows foreign key columns through intermediate entities using dot notation. The final entity of each chain must match the type of the corresponding attribute in the computed entity.

**How it works:**

1. **SQL generation**: The framework resolves the FK chains and generates:
   ```sql
   INSERT OR IGNORE INTO engine_type_compatibility (engine_type_id, aircraft_type_id)
   SELECT DISTINCT e.type_id, a.type_id
   FROM engine_allocation src
   JOIN engine j0 ON j0.id = src.engine_id
   JOIN aircraft j1 ON j1.id = src.aircraft_id
   WHERE src.engine_id IS NOT NULL AND j0.type_id IS NOT NULL
     AND src.aircraft_id IS NOT NULL AND j1.type_id IS NOT NULL
   ```

2. **Population**: Table is cleared and repopulated at server startup, after seed/import operations, and on the daily schedule.

3. **Bridge filtering**: When a process step references `Entity: Aircraft(EngineType)` and Aircraft has no direct FK to EngineType, the system automatically detects the computed bridge entity and filters through it. This enables indirect FK filtering across M:N relationships.

4. **Read-only**: Computed entities are implicitly read-only — data cannot be edited manually.

**When to use:**

| Scenario | Approach |
|----------|----------|
| Direct FK exists | Use `Entity: Target(ContextKey)` directly |
| Relationship is indirect (via intermediate entities) | Define a PAIRS entity as a bridge |
| M:N mapping needed | PAIRS with `[UK1]` on both attributes |

### Visual Styling in Diagrams

| Marker | Diagram Effect |
|--------|----------------|
| `[READONLY]` | Attribute text in **red**, FK lines drawn as dotted |
| `[LABEL]` | Attribute text **underlined** (solid) |
| `[LABEL2]` | Attribute text **underlined** (dashed) |

### Example

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| name | string | Company name [LABEL] | Acme Corp |
| country | string | Country [LABEL2] | USA |
| internal_code | string | Internal system code [HIDDEN] | ABC123 |
| created_at | datetime | Creation timestamp [READONLY] | 2024-01-15 |
```

In this example:
- `name` is the primary label (tree node title, dropdown display)
- `country` is the secondary label (shown in parentheses)
- `internal_code` exists in DB but is never shown in UI
- `created_at` is displayed but cannot be edited

### Truncating Long Text

For fields that may contain long text (comments, descriptions), use `[TRUNCATE=n]` to limit the display width:

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| comment | string [OPTIONAL] | [TRUNCATE=30] | Long text here... |
| notes | string [OPTIONAL] | User notes [TRUNCATE=50] | |
```

The full text is always stored in the database. Only the display is truncated, with the complete value shown in a tooltip on hover.

---

## Media Field Annotations

For `media` type fields, additional constraints can be specified:

| Annotation | Description | Example |
|------------|-------------|---------|
| `[SIZE=50MB]` | Max file size (B, KB, MB, GB) | `[SIZE=10MB]` |
| `[DIMENSION=800x600]` | Max image dimensions | `[DIMENSION=1920x1080]` |
| `[MAXWIDTH=800]` | Max image width only | `[MAXWIDTH=1200]` |
| `[MAXHEIGHT=600]` | Max image height only | `[MAXHEIGHT=800]` |
| `[DURATION=5min]` | Max audio/video duration (sec, min, h) | `[DURATION=30sec]` |

### Example

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| photo | media | Profile picture [DIMENSION=400x400] [SIZE=2MB] | |
| contract | media | Employment contract [SIZE=10MB] | |
| intro_video | media | Introduction video [DURATION=2min] | |
```

Images exceeding dimension constraints are automatically scaled down, preserving aspect ratio.

---

## Computed Fields

Computed fields are stored in the database but calculated automatically. They combine `[READONLY]` with a computation rule.

### Syntax

```markdown
| current_department | Department | [READONLY] [DAILY=Assignment[end_date=null OR end_date>TODAY].department] | 5 |
```

### Computation Types

| Tag | Trigger | Use Case |
|-----|---------|----------|
| `[DAILY=rule]` | Daily CRON job | Time-dependent rules |
| `[IMMEDIATE=rule]` | On source table change | Non-time-dependent rules |

### Aggregate Functions

```markdown
| latest_project | Project | [READONLY] [DAILY=Deployment[MAX(end_date)].project] | 1 |
| first_milestone | Milestone | [READONLY] [DAILY=Milestone[MIN(due_date)]] | 3 |
```

See [Computed References](computed-references.md) for full syntax.

---

## Where to Place Markers

| Marker Type | Column |
|-------------|--------|
| `[OPTIONAL]`, `[DEFAULT=x]` | **Type** column |
| `[LABEL]`, `[LABEL2]`, `[READONLY]`, `[HIDDEN]`, `[TRUNCATE=n]`, `[NOWRAP]` | **Description** column |
| `[UNIQUE]`, `[UK1]`, `[INDEX]`, `[IX1]` | **Description** column |
| `[SIZE=]`, `[DIMENSION=]`, etc. | **Description** column |
| `[DAILY=]`, `[IMMEDIATE=]` | **Description** column |

---

## See Also

- [Scalar Types](scalar-types.md) — `int`, `number`, `string`, `date`, `bool`
- [Aggregate Types](aggregate-types.md) — Composite types like `geo`
- [Procedures: Add Attribute](procedures/attribute-add.md) — Step-by-step guide
- [Procedures: Add Entity](procedures/entity-add.md) — Complete entity checklist
- [Database Features](procedures/database-features.md) — System columns, audit trail
