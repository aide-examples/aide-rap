# Aggregate Types Reference

> Composite types that expand to multiple database columns.

Aggregate types allow you to define a single logical field in your data model that automatically expands to multiple database columns. This keeps your entity definitions clean while providing proper relational storage.

---

## Overview

| Aggregate Type | Expands to | Canonical Format |
|----------------|------------|------------------|
| `geo` | `{name}_latitude`, `{name}_longitude` | `"48.1371, 11.5754"` |
| `address` | `{name}_street`, `{name}_city`, `{name}_zip`, `{name}_country` | `"{zip} {city}"` |
| `contact` | `{name}_phone`, `{name}_email`, `{name}_fax` | `"{email} ({phone})"` |

---

## Built-in: `geo`

GPS coordinates stored as two REAL columns.

### Usage in Entity Markdown

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| position | geo | GPS coordinates from tracker | 48.1371, 11.5754 |
| headquarters | geo | Company headquarters | 53.63, 9.99 |
```

### Generated Database Columns

```sql
position_latitude REAL,
position_longitude REAL
```

### Field Specification

| Subfield | SQL Type | Range | Description |
|----------|----------|-------|-------------|
| `latitude` | REAL | -90 to 90 | North-south position |
| `longitude` | REAL | -180 to 180 | East-west position |

---

## Seed Data Format

Aggregate types accept **nested objects** in seed data for readability:

```json
[
  {
    "serial_number": "TRK-001-2024",
    "position": {
      "latitude": 48.1371,
      "longitude": 11.5754
    }
  }
]
```

The system automatically flattens nested fields to database columns during import:

| Seed Format | Database Columns |
|-------------|------------------|
| `"position": { "latitude": 48.1, "longitude": 11.5 }` | `position_latitude = 48.1`, `position_longitude = 11.5` |

**Flat format** is also accepted (but less readable):

```json
{
  "position_latitude": 48.1371,
  "position_longitude": 11.5754
}
```

---

## Backup & Restore

**Backup export** uses nested format for readability:

```json
{
  "serial_number": "TRK-001-2024",
  "position": {
    "latitude": 48.1371,
    "longitude": 11.5754
  }
}
```

**Restore** accepts both nested and flat formats.

---

## UI Behavior

### Table View

Aggregate columns display as a **single canonical column**:

| Serial Number | Position | Battery |
|---------------|----------|---------|
| TRK-001-2024 | 48.1371, 11.5754 | 95 |

The canonical format combines subfields: `"{latitude}, {longitude}"`

### Edit Form

Aggregate fields render as a **grouped fieldset**:

```
┌─ Position ──────────────────────────┐
│ Latitude:  [48.1371            ]    │
│ Longitude: [11.5754            ]    │
└─────────────────────────────────────┘
```

---

## Schema API

The extended schema API exposes aggregate metadata:

```json
{
  "columns": [
    {
      "name": "position_latitude",
      "type": "number",
      "sqlType": "REAL",
      "aggregateSource": "position",
      "aggregateField": "latitude",
      "aggregateType": "geo"
    },
    {
      "name": "position_longitude",
      "type": "number",
      "sqlType": "REAL",
      "aggregateSource": "position",
      "aggregateField": "longitude",
      "aggregateType": "geo"
    }
  ]
}
```

| Property | Description |
|----------|-------------|
| `aggregateSource` | Original field name from entity definition |
| `aggregateField` | Subfield name within the aggregate type |
| `aggregateType` | Aggregate type identifier (`geo`, `address`, etc.) |

---

## Example Entity

**EngineTracker.md:**

```markdown
# EngineTracker

A tracking device fixed at the cradle of an EngineStand.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Tracker serial number [LABEL] | TRK-001-2024 |
| stand | EngineStand | Associated engine stand | |
| position | geo | GPS coordinates from tracker | 48.1371, 11.5754 |
| mounted_date | date | When the tracker was placed | 2024-06-15 |
| battery_soc | number | Battery state of charge (0-100%) | 95 |
```

**Generated columns:**

| DB Column | Type | Source |
|-----------|------|--------|
| `id` | INTEGER | (system) |
| `serial_number` | TEXT | string |
| `stand_id` | INTEGER | FK to EngineStand |
| `position_latitude` | REAL | geo.latitude |
| `position_longitude` | REAL | geo.longitude |
| `mounted_date` | TEXT | date |
| `battery_soc` | REAL | number |

---

## Built-in: `address`

Postal address stored as four TEXT columns.

### Usage in Entity Markdown

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| headquarters | address | Main office location | 22335 Hamburg, Weg beim Jäger 193 |
| office | address | Branch office address | 80995 Munich |
```

### Generated Database Columns

```sql
headquarters_street TEXT,
headquarters_city TEXT,
headquarters_zip TEXT,
headquarters_country TEXT
```

### Field Specification

| Subfield | SQL Type | Description |
|----------|----------|-------------|
| `street` | TEXT | Street address |
| `city` | TEXT | City name |
| `zip` | TEXT | Postal/ZIP code |
| `country` | TEXT | Country name |

### Seed Data Format

```json
{
  "headquarters": {
    "street": "Weg beim Jäger 193",
    "city": "Hamburg",
    "zip": "22335",
    "country": "Germany"
  }
}
```

### Canonical Format

The canonical display format is: `"{zip} {city}"` (e.g., "22335 Hamburg")

---

## Built-in: `contact`

Contact information stored as three TEXT columns.

### Usage in Entity Markdown

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| contact | contact | Contact information | info@shop.de (+49 40 123) |
```

### Generated Database Columns

```sql
contact_phone TEXT,
contact_email TEXT,
contact_fax TEXT
```

### Field Specification

| Subfield | SQL Type | Description |
|----------|----------|-------------|
| `phone` | TEXT | Phone number |
| `email` | TEXT | Email address |
| `fax` | TEXT | Fax number (optional) |

### Seed Data Format

```json
{
  "contact": {
    "phone": "+49 40 12345",
    "email": "info@company.de",
    "fax": "+49 40 12346"
  }
}
```

### Canonical Format

The canonical display format is: `"{email} ({phone})"` (e.g., "info@shop.de (+49 40 123)")

---

## Future Aggregate Types

### Custom Aggregates (planned)

Define custom aggregate types in `Types.md`:

```markdown
### USAddress [AGGREGATE]

| Field | Type | Description |
|-------|------|-------------|
| line1 | string | Address line 1 |
| line2 | string | Address line 2 [OPTIONAL] |
| city | string | City |
| state | string | State (2-letter) |
| zip | string | ZIP code |

**Canonical:** `"{zip} {city}, {state}"`
```

---

## See Also

- [Scalar Types](scalar-types.md) — `int`, `number`, `string`, `date`, `bool`
- [Attribute Markers](attribute-markers.md) — `[LABEL]`, `[READONLY]`, etc.
- [Seed Data](seed-data.md) — Import/export formats
- [Database Features](procedures/database-features.md) — System columns, schema
