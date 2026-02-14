# Validation

AIDE RAP provides dual-layer validation: the same rules run on both **frontend** (instant feedback) and **backend** (integrity guarantee). Rules are defined once in entity Markdown and enforced everywhere.

## Architecture

```
Entity Markdown → SchemaGenerator → validationRules + objectRules → /api/meta
                                                                      ↓
                                    Browser: SchemaCache → ObjectValidator (pre-submit + on-blur)
                                    Server:  GenericRepository → ObjectValidator (create/update)
```

The isomorphic `ObjectValidator` (in `shared/validation/`) works identically in Node.js and the browser.

## Field Validation (Single-Field Rules)

Field validation rules are **auto-generated** from entity attribute definitions. No additional configuration needed.

### Auto-Generated Rules

| Source | Generated Rule | Example |
|--------|---------------|---------|
| Non-OPTIONAL field | `required: true` | `name` is required |
| `string` type | `type: 'string'` | Must be a string |
| `number` type | `type: 'number'` | Must be a number |
| `date` type | `pattern` (ISO date) | Must match YYYY-MM-DD |
| `mail` type | `pattern` (email regex) | Must be a valid email |
| `url` type | `pattern` (URL regex) | Must be a valid URL |
| `[MIN=x]` annotation | `min: x` | Must be at least x |
| `[MAX=x]` annotation | `max: x` | Must be at most x |
| Pattern type (e.g. IATACode) | `pattern` from TypeRegistry | Must match `^[A-Z]{2}$` |
| Enum type | `enum` with valid values | Must be one of the defined values |

### Client Behavior

- **On blur**: Each field is validated individually when the user leaves it. Errors appear inline below the field.
- **On input**: Clearing begins typing removes the error for that specific field.
- **Pre-submit**: All fields are validated before the API call. On create: `validate()` (all fields). On edit: `validatePartial()` (only submitted fields).

### Error Display

Each form field has a `<div class="field-error">` element below it. On validation failure:
- The input gets a red border (CSS class `.error`)
- The error message appears in the field-error div

## Object Validation (Cross-Field Constraints)

Object-level rules validate relationships **between** fields. They run only during **pre-submit** (not on blur, since they need multiple fields).

### Defining Constraints in Markdown

Add a `## Constraints` section to your entity Markdown:

```markdown
## Constraints

TimeRange(start_date, end_date)
NumericRange(min_value, max_value)

```js
if (obj.aircraft_id && !obj.installation_position) {
  error(['installation_position', 'aircraft_id'], 'POS_REQUIRED');
}
` ``

## Error Messages

| Code | en | de |
|------|----|----|
| POS_REQUIRED | Position required when mounted | Position erforderlich bei Montage |
```

### Built-in Constraint Functions

#### TimeRange(fieldA, fieldB)

Validates that `fieldA <= fieldB` (chronological order). Skips validation if either field is null/empty.

```markdown
TimeRange(start_date, end_date)
TimeRange(entry_date, exit_date)
TimeRange(planned_pickup_date, planned_delivery_date)
```

- Uses field names from the Attributes table (conceptual names, not `_id` suffixed)
- Default message (en): `"fieldA" must be on or before "fieldB"`
- Custom message: `TimeRange(start_date, end_date) : "Lease end must be after start"`

#### NumericRange(fieldA, fieldB)

Validates that `fieldA <= fieldB` (numeric order). Same semantics as TimeRange but for numeric fields.

```markdown
NumericRange(temp_min, temp_max)
```

- Default message (en): `"fieldA" must be less than or equal to "fieldB"`

### Custom JS Constraints

For complex validation logic, write JavaScript in a fenced code block:

```markdown
## Constraints

```js
if (obj.aircraft_id && obj.spare_at_camo_id) {
  error(['aircraft_id', 'spare_at_camo_id'], 'EXCLUSIVE');
}
` ``
```

The code receives:
- **`obj`** — The object being validated (uses DB column names, e.g. `aircraft_id`)
- **`error(fields, code)`** — Call this to report a validation error:
  - `fields`: Array of column names. First = primary (gets error message), rest = related (get red border only)
  - `code`: Error code, mapped to messages in `## Error Messages`
- **`lookup(entityName, id)`** — Load a record from another entity by ID (cross-entity constraint):
  - Server: synchronous DB query with per-batch cache (efficient for imports)
  - Browser: returns `null` (server acts as backstop — guard with `if (result)`)
- **`exists(entityName, conditions)`** — Check if a record matching the conditions exists (cross-entity constraint):
  - `conditions`: Object with column name → value pairs, e.g. `{ engine_type_id: 5, aircraft_type_id: 3 }`
  - Server: `SELECT 1 ... WHERE col1 = ? AND col2 = ?` with per-batch cache
  - Browser: returns `false` (server acts as backstop)

#### Cross-Entity Constraints with `lookup()`

Use `lookup()` to validate against data from related entities:

```markdown
```js
if (obj.aircraft_id && obj.installation_position) {
  const ac = lookup('Aircraft', obj.aircraft_id);
  if (ac) {
    const acType = lookup('AircraftType', ac.type_id);
    if (acType && obj.installation_position > acType.number_of_engines) {
      error(['installation_position'], 'POS_EXCEEDS_ENGINES');
    }
  }
}
` ``
```

#### Existence Checks with `exists()`

Use `exists()` to validate against junction/mapping tables:

```markdown
```js
if (obj.engine_id && obj.aircraft_id) {
  const engine = lookup('Engine', obj.engine_id);
  const aircraft = lookup('Aircraft', obj.aircraft_id);
  if (engine && aircraft) {
    if (!exists('EngineTypeCompatibility', {
      engine_type_id: engine.type_id,
      aircraft_type_id: aircraft.type_id
    })) {
      error(['engine_id', 'aircraft_id'], 'INCOMPATIBLE_ENGINE_TYPE');
    }
  }
}
` ``
```

- Both `lookup()` and `exists()` return fallback values in the browser (`null` / `false`) — constraints using them are **server-only**
- The cache is per validation batch: during imports, repeated lookups/exists checks for the same parameters are served from memory

### Error Messages Section

Define multilingual messages for custom constraint codes:

```markdown
## Error Messages

| Code | en | de |
|------|----|----|
| POS_REQUIRED | Position required when mounted on aircraft | Position erforderlich bei Montage |
| EXCLUSIVE | Cannot be both at the same time | Kann nicht beides gleichzeitig sein |
```

- Built-in rules (TimeRange, NumericRange) have built-in messages — no entry needed
- Custom JS codes without a message entry will show the raw code as fallback

### JSON Structure (via /api/meta)

Object rules are delivered as `objectRules` array alongside `validationRules`:

```json
// Built-in
{ "type": "builtin", "name": "TimeRange",
  "columnA": "start_date", "columnB": "end_date",
  "fieldA": "start_date", "fieldB": "end_date",
  "message": null }

// Custom
{ "type": "custom",
  "code": "if (obj.aircraft_id && ...) { error([...], 'CODE'); }",
  "messages": { "CODE": { "en": "...", "de": "..." } } }
```

### Error Object

Cross-field errors include a `relatedFields` property for multi-field highlighting:

```json
{
  "field": "start_date",
  "relatedFields": ["end_date"],
  "code": "OBJECT_TIMERANGE",
  "message": "\"start_date\" must be on or before \"end_date\""
}
```

## Validation During Import

Cross-field constraints (TimeRange, NumericRange, Custom JS) and optionally field-level rules are also enforced during data imports via the SeedManager. Two checkboxes in the import dialog control which validation layers are active:

| Checkbox | Default | What it checks |
|----------|---------|----------------|
| **Fields** | off | Type, pattern, required, enum |
| **Constraints** | on | TimeRange, NumericRange, Custom JS |

Records that violate active rules are **skipped** and reported as warnings in the import result. The same ObjectValidator methods are used as for the REST API — no redundant validation code.

### API Parameters

When calling `POST /api/seed/load/:entity` directly:

```json
{
  "mode": "merge",
  "skipInvalid": true,
  "validateFields": false,
  "validateConstraints": true
}
```

## Key Files

| File | Role |
|------|------|
| `shared/validation/ObjectValidator.js` | Isomorphic validator (browser + Node.js) |
| `shared/validation/ValidationError.js` | Structured validation error |
| `shared/types/TypeRegistry.js` | Type definitions → validation rules |
| `server/utils/SchemaGenerator.js` | Markdown → schema + rules |
| `server/repositories/GenericRepository.js` | Server-side validation calls |
| `server/utils/SeedManager.js` | Import validation (field + constraint checks) |
| `static/rap/services/api-client.js` | SchemaCache + validator init |
| `static/rap/components/entity-form.js` | Client-side on-blur + pre-submit |
| `static/rap/components/seed-import-dialog.js` | Import dialog with validation checkboxes |
