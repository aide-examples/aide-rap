# Readings SHORT

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
