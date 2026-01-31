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
| `[DEFAULT=x]` | Explicit default value | Used for migration (ALTER TABLE) and NEW forms |

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

- [Procedures: Add Attribute](procedures/attribute-add.md) — Step-by-step guide
- [Procedures: Add Entity](procedures/entity-add.md) — Complete entity checklist
- [Database Features](procedures/database-features.md) — System columns, audit trail
