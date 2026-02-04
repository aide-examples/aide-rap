# Views

## Metering

### Readings by Resource

```json
{
  "base": "Reading",
  "prefilter": ["meter.resource_type:select"],
  "columns": [
    "meter.resource_type.name as resource",
    "meter.resource_type.color as color",
    "meter.resource_type.unit_of_measure as unit",
    "meter.serial_number as meter",
    "meter.building.name as building",
    "value",
    "reading_at",
    "source",
    "usage"
  ]
}
```

```js
// apply resource color styling
for (const row of data) {
  row._cellStyles = { resource: { backgroundColor: row.color } };
}
schema.columns.find(c => c.key === 'color').hidden = true;
```

### Readings SHORT

```json
{
  "base": "Reading",
  "columns": [
    "meter.building.name as building",
    "meter.resource_type.name as resource",
    "meter.resource_type.color as color",
    "reading_at",
    "usage",
    "meter.resource_type.unit_of_measure as unit"
  ]
}
```

```js
// apply resource color styling
for (const row of data) {
  row._cellStyles = { resource: { backgroundColor: row.color } };
  if (row.usage > 4000) {
    row._cellStyles.usage = { backgroundColor: "#fcc" };
  }
}
schema.columns.find(c => c.key === 'color').hidden = true;
```

### Usage by year

```json
{
  "base": "Reading",
  "prefilter": ["meter.building:select","reading_at:year"],
  "columns": [
    "meter.resource_type.name as resource",
    "meter.resource_type.color as color",
    "meter.resource_type.unit_of_measure as unit",
    "meter.serial_number as meter",
    "meter.building.name as building",
    "value",
    "reading_at",
    "source",
    "usage"
  ]
}
```

## Static Data

### Buildings and Meters

```json
{
  "base": "Meter",
  "columns": [
    "building.address as building",
    "location_description",
    "resource_type.name as resource",
    "serial_number"
  ]
}
```