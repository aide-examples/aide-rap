# Calculations

AIDE RAP supports two types of calculated fields:

| Type | Section | Execution | Persistence | Use Case |
|------|---------|-----------|-------------|----------|
| **Client** | `## Client Calculations` | Browser | No (display only) | Formatting, derived display values |
| **Server** | `## Server Calculations` | Node.js | Yes (stored in DB) | Business logic, aggregations, queryable values |

---

## Server Calculations

Server calculations run on the backend after every **create**, **update**, or **delete** operation. Values are persisted to the database and available for queries, exports, and reports.

### Syntax

```markdown
## Server Calculations

### field_name

**Depends on:** field1, field2
**Sort:** field1, field2

```js
// JavaScript code that modifies the `data` array in place
for (const row of data) {
  row.field_name = row.field1 + row.field2;
}
```
```

### Directives

| Directive | Required | Description |
|-----------|----------|-------------|
| `**Depends on:**` | Yes | Fields needed for calculation (used in SELECT) |
| `**Sort:**` | Yes | Sort order for processing (important for cumulative calculations) |
| `**Trigger:**` | No | Default: `ONCHANGE`. Options: `ONCHANGE`, `ON_DEMAND`, `DAILY` |

### Behavior

- **Trigger**: Runs automatically after POST, PUT, DELETE
- **READONLY**: Server-calculated fields are automatically read-only in the UI
- **Partitioning**: If `Sort` contains a FK field (e.g., `meter_id`), only records in that partition are recalculated

### Example: Cumulative Usage

```markdown
# Reading

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| meter | Meter | Reference to Meter | 1 |
| reading_at | date | Date of measurement | 2024-01-15 |
| value | int | Meter reading value | 42000 |
| usage | int | Consumption since last reading [CALCULATED] | 565 |

## Server Calculations

### usage

**Depends on:** value, meter_id
**Sort:** meter_id, reading_at

```js
let prev = null, prevVal = null;
for (const row of data) {
  if (row.meter_id !== prev) {
    prev = row.meter_id;
    prevVal = row.value;
    row.usage = null;  // First reading has no usage
  } else {
    row.usage = row.value - prevVal;
    prevVal = row.value;
  }
}
```
```

**Result**: When a Reading is saved, `usage` is automatically calculated as the difference to the previous reading for that meter.

---

## Client Calculations

Client calculations run in the browser after data is loaded. Values are NOT persisted - they are recalculated on every page load.

### Syntax

```markdown
## Client Calculations

### display_field

**Depends on:** field1, field2

```js
for (const row of data) {
  row.display_field = row.field1.toLocaleString() + ' kWh';
}
```
```

### Behavior

- Runs after every data fetch (initial load, pagination, filter change)
- Values exist only in browser memory
- NOT included in exports or SQL queries
- NOT automatically READONLY (can be overwritten by user input, but changes are lost)

### Use Cases

- Formatting (e.g., `1234` → `"1,234 kWh"`)
- Client-only derived values
- Temporary display transformations

---

## Comparison

| Aspect | Client Calculation | Server Calculation |
|--------|-------------------|-------------------|
| Execution | Browser | Node.js server |
| Persistence | No | Yes (in database) |
| Trigger | Every data load | After save (ONCHANGE) |
| READONLY | Optional | Automatic |
| In Exports | No | Yes |
| SQL Queryable | No | Yes |
| Performance | Runs on every load | Runs once on save |

---

## Migration from Legacy `## Calculations`

The old `## Calculations` section is deprecated but still supported:

- Without `**Trigger:**` → treated as **Client Calculation**
- With `**Trigger: ONCHANGE**` → treated as **Server Calculation**

**Recommendation**: Migrate to explicit `## Client Calculations` or `## Server Calculations` sections for clarity.

---

## Technical Details

### Files

| File | Purpose |
|------|---------|
| `app/server/services/CalculationService.js` | Server calculation execution |
| `app/server/utils/SchemaGenerator.js` | Parsing of calculation sections |
| `app/server/routers/GenericCrudRouter.js` | ONCHANGE trigger after CRUD |
| `app/static/rap/components/entity-explorer.js` | Client calculation execution |

### Calculation Code Environment

The JavaScript code runs with:

```javascript
// Available variable:
data  // Array of records to process, modify in place

// Example:
for (const row of data) {
  row.calculated_field = row.field_a + row.field_b;
}
```

- No `return` statement needed
- Modify `data` array in place
- Each `row` is a plain object with column values
- For server calculations: FK fields use `_id` suffix (e.g., `meter_id`)
