# Integration API

REST API for external workflow tools (HCL Leap, Power Automate, etc.).

## Authentication

All requests require an API key via `X-API-Key` header. Keys are configured in `config.json` with SHA-256 hashes, role, and entity scope.

```json
{
  "apiKeys": [{
    "name": "leap-integration",
    "key": "<sha256-hash>",
    "role": "user",
    "entities": ["Engine", "EngineType"]
  }]
}
```

## Simple Filter Syntax: `?field=&value=`

All read endpoints support `?field=<column>&value=<value>` as an alternative to the `?filter=` syntax. This is designed for tools like HCL Leap that can only substitute values in standard `?param=value` URL parameters.

```
?field=serial_number&value=424114     → exact match on column
?field=is_leaf&value=1                → exact match on boolean
?field=type_label&value=CF34-10       → exact match on view column
```

Works on: `/api/entities`, `/api/views`, `/api/integrate/.../lookup`

## Endpoints

### Options — Picklist for dropdowns

```
GET /api/integrate/:entity/options[?field=X&value=Y]
```

Returns a compact array `[{ id, label, label2? }]` for dropdown/picklist binding. Automatically uses the entity's LABEL system:

- **`[LABEL]` column** → returned as `label`
- **`[LABEL=concat(...)]`** → computed `_label` returned as `label`
- **`[LABEL2]` column** → returned as `label2` (if present)

Results are sorted alphabetically by label.

| Example | Result |
|---------|--------|
| `EngineType/options` | All engine types with labels |
| `EngineType/options?field=is_leaf&value=1` | Only leaf types (no parent categories) |
| `Engine/options` | All engines with computed labels (ESN-Type) |

**Response:**
```json
[
  { "id": 11, "label": "CF34-10" },
  { "id": 12, "label": "CF-34-8" },
  { "id": 30, "label": "CF34-10E5A1" }
]
```

### Lookup — Find records by field value (with FK resolution)

```
GET /api/integrate/:entity/lookup?field=<column>&value=<value>
```

**FK label resolution:** If `field` is a foreign key name (without `_id`), the value is automatically resolved via label lookup against the referenced entity.

| Example | Behavior |
|---------|----------|
| `?field=serial_number&value=424114` | Direct column match |
| `?field=type&value=CF34-10` | Resolves "CF34-10" → EngineType id, filters by `type_id` |
| `?field=type&value=UNKNOWN` | Returns 404 with `FK_NOT_FOUND` error |

### Entity List — Standard CRUD with simple filter

```
GET /api/entities/:entity?field=<column>&value=<value>
```

No FK resolution — uses entity column names directly (e.g., `type_id`, `is_leaf`, `state`).

### View Query — Curated projection with simple filter

```
GET /api/views/:viewName?field=<column>&value=<value>
```

Uses view column aliases (e.g., `type_label`, `ESN`). Views include resolved FK labels, so FK resolution is not needed.

### Create — Insert with FK label resolution

```
POST /api/integrate/:entity
Content-Type: application/json

{ "type": "CF34-10", "serial_number": "ESN-999" }
```

FK fields can use human-readable labels instead of IDs. The system resolves `"type": "CF34-10"` → `type_id: 42`.

### Update — Modify with FK label resolution

```
PUT /api/integrate/:entity/:id
Content-Type: application/json

{ "state": "IN_MAINTENANCE" }
```

Supports Optimistic Concurrency Control via `If-Match` header or `_version` in body.

## Endpoint Comparison

| Feature | `/api/entities` | `/api/views` | `/api/integrate` |
|---------|----------------|-------------|-----------------|
| FK label resolution | No | N/A (labels in view) | Yes (auto) |
| `?field=&value=` | Yes | Yes | Yes |
| `?filter=` (advanced) | Yes | Yes | No |
| Options/Picklist | No | No | Yes (`/options`) |
| Target audience | Internal UI | Both | External tools |
| Scope check | Entity scope | No | Entity scope |
