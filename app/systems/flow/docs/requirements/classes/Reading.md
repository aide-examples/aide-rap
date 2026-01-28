# Reading

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| meter | Meter | Reference to Meter [UK1] | 1 |
| value | int | The numeric value on the meter [LABEL] | 42 |
| reading_at | date | Timestamp of the measurement [LABEL2] [UK1] | 2024-01-15 |
| source | string | Manual, Automated, Estimated [DEFAULT=Automated] | Example |
| usage | int | Consumption since last reading [CALCULATED] | null |

## Calculations

### usage

**Depends on:** value, meter_id
**Sort:** meter_id, reading_at

```js
let prev = null, prevVal = null;
for (const row of data) {
  if (row.meter_id !== prev) {
    prev = row.meter_id;
    prevVal = row.value;
    row.usage = null;
  } else {
    row.usage = row.value - prevVal;
    prevVal = row.value;
  }
}
```

## Data Generator

Generate for each Meter in the list Readings for the last day of the latest 5 years. The values should be logical, i.e. increase form year to year. Think of a household with 4 people when creating the readings
