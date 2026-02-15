# Usage by year

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
