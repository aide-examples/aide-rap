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

### Entity-Level Computed LABEL

Instead of marking a column with `[LABEL]`, you can define a **computed label expression** at the entity level. This is useful when the display label should combine multiple fields without creating a redundant database column.

**Syntax** (placed before `## Attributes`):

```markdown
# Aircraft

[LABEL=concat(manufacturer, ' - ', serial_number)]
[LABEL2=manufacture_date]

## Attributes
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | [UK1] | ABC123 |
| manufacturer | string | [UK1] | Boeing |
| manufacture_date | date | | 2020-01-15 |
```

**Supported expressions:**

| Expression | Example | Result |
|------------|---------|--------|
| `concat(a, 'sep', b)` | `concat(mfg, ' - ', serial)` | `Boeing - ABC123` |
| Single field | `serial_number` | `ABC123` |

**How it works:**

1. **SQL View**: A computed `_label` column is added to the entity's view:
   ```sql
   CREATE VIEW aircraft_view AS
   SELECT *, (manufacturer || ' - ' || serial_number) AS _label
   FROM aircraft;
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
| name | string | Company name [LABEL] | Airbus |
| country | string | Country [LABEL2] | France |
| internal_code | string | Internal system code [HIDDEN] | ABC123 |
| created_at | datetime | Creation timestamp [READONLY] | 2024-01-15 |
```

In this example:
- `name` is the primary label (tree node title, dropdown display)
- `country` is the secondary label (shown in parentheses)
- `internal_code` exists in DB but is never shown in UI
- `created_at` is displayed but cannot be edited

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
| current_operator | Operator | [READONLY] [DAILY=Registration[exit_date=null OR exit_date>TODAY].operator] | 5 |
```

### Computation Types

| Tag | Trigger | Use Case |
|-----|---------|----------|
| `[DAILY=rule]` | Daily CRON job | Time-dependent rules |
| `[IMMEDIATE=rule]` | On source table change | Non-time-dependent rules |

### Aggregate Functions

```markdown
| latest_aircraft | Aircraft | [READONLY] [DAILY=EngineAllocation[MAX(end_date)].aircraft] | 1 |
| first_event | EngineEvent | [READONLY] [DAILY=EngineEvent[MIN(event_date)]] | 3 |
```

See [Computed References](computed-references.md) for full syntax.

---

## Where to Place Markers

| Marker Type | Column |
|-------------|--------|
| `[OPTIONAL]`, `[DEFAULT=x]` | **Type** column |
| `[LABEL]`, `[LABEL2]`, `[READONLY]`, `[HIDDEN]` | **Description** column |
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
