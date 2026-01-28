# Views

### Readings by Resource

```json
{
  "base": "Reading",
  "columns": [
    "meter.resource_type.name as resource",
    "meter.resource_type.color as color",
    "meter.resource_type.unit_of_measure as unit",
    "meter.serial_number as meter",
    "meter.building.name as building",
    "value",
    "reading_at",
    "source"
  ]
}
```

```js
// Calculator: compute usage + apply resource color styling
schema.columns.push({ key: 'usage', label: 'Usage', type: 'number' });
let prevMeter = null, prevValue = null;
for (const row of data) {
  // Usage: delta between consecutive readings per meter
  if (row.meter !== prevMeter) {
    prevMeter = row.meter;
    prevValue = row.Value;
    row.usage = null;
  } else {
    row.usage = row.Value - prevValue;
    prevValue = row.Value;
  }
  // Cell styling: backgroundColor from color field
  row._cellStyles = { resource: { backgroundColor: row.color } };
}
// Hide the color column (data remains for styling)
schema.columns.find(c => c.key === 'color').hidden = true;
```
