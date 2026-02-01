# Scalar Types Reference

> Built-in attribute types for entity definitions.

Scalar types are the basic building blocks for entity attributes. Each type maps to a specific SQLite column type and JavaScript type.

---

## Type Overview

| Type | SQL Type | JS Type | Default Value | Description |
|------|----------|---------|---------------|-------------|
| `int` | INTEGER | number | `0` | Whole numbers |
| `number` | REAL | number | `0` | Floating point numbers |
| `real` | REAL | number | `0` | Alias for `number` |
| `string` | TEXT | string | `''` | Text strings |
| `date` | TEXT | string | `CURRENT_DATE` | ISO date (YYYY-MM-DD) |
| `bool` | INTEGER | boolean | `false` | Boolean (0/1) |
| `boolean` | INTEGER | boolean | `false` | Alias for `bool` |

---

## Numeric Types

### `int` — Integer

Whole numbers without decimal places. Stored as SQLite INTEGER.

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| total_cycles | int | Engine cycle count | 15000 |
| quantity | int | Item quantity | 42 |
```

**UI**: Number input without decimal places.

### `number` / `real` — Floating Point

Numbers with decimal places. Stored as SQLite REAL.

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| total_flight_hours | number | Total flight hours | 12500.5 |
| thrust | number | Engine thrust in kN | 142.3 |
| battery_soc | number | Battery state of charge (0-100) | 95 |
```

**UI**: Number input with decimal places allowed.

> **Note**: `real` is an alias for `number`. Both behave identically.

---

## Text Types

### `string` — Text

Variable-length text. Stored as SQLite TEXT.

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Engine serial number | ESN-12345 |
| name | string | Company name | Lufthansa |
```

**UI**: Single-line text input.

### `date` — Date

ISO 8601 date format (YYYY-MM-DD). Stored as SQLite TEXT.

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| start_date | date | Contract start date | 2024-01-15 |
| mounted_date | date | Installation date | 2024-06-20 |
```

**UI**: Date picker.

---

## Boolean Types

### `bool` / `boolean` — Boolean

True/false values. Stored as SQLite INTEGER (0 = false, 1 = true).

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| is_active | bool | Active status | true |
| is_moving | boolean | Movement indicator | false |
```

**UI**: Checkbox or toggle switch.

> **Note**: `boolean` is an alias for `bool`. Both behave identically.

---

## Aggregate Types

Aggregate types expand to multiple database columns. See [Aggregate Types](aggregate-types.md) for details.

| Type | Expands to | Description |
|------|------------|-------------|
| `geo` | `{name}_latitude`, `{name}_longitude` | GPS coordinates |

---

## Type Aliases Summary

| Alias | Canonical Type |
|-------|----------------|
| `real` | `number` |
| `boolean` | `bool` |

Both forms are accepted in entity definitions and behave identically.

---

## Sorting Behavior

| Type | Sort Order |
|------|------------|
| `int`, `number`, `real` | Numeric (ascending/descending) |
| `string` | Alphabetic (case-insensitive) |
| `date` | Chronological (ISO string comparison) |
| `bool`, `boolean` | Numeric (false < true) |

---

## Example Entity

```markdown
# Engine

An aircraft engine with operational data.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Engine serial number [LABEL] | ESN-12345 |
| total_cycles | int | Total engine cycles | 15000 |
| total_flight_hours | number | Total flight hours | 12500.5 |
| manufacture_date | date | Manufacturing date | 2020-03-15 |
| is_serviceable | bool | Serviceable status | true |
```

---

## See Also

- [Aggregate Types](aggregate-types.md) — Composite types like `geo`
- [Attribute Markers](attribute-markers.md) — `[OPTIONAL]`, `[DEFAULT=x]`, etc.
- [Entity Procedures](procedures/entity-add.md) — Creating entities
