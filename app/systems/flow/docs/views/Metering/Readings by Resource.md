# Readings by Resource

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
