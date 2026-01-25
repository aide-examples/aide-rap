# Procedure: Reorder Attributes

> Reusable guide for changing the order of attributes within an entity.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
```

---

## Background

Attribute order is used in multiple places:

| Source | Usage |
|--------|-------|
| `classes/ENTITY_NAME.md` (Markdown table) | **Source of Truth** - defines the order |
| `DataModel.yaml` | Schema definition (parsed at startup) |
| SchemaGenerator | Creates views with the order from schema |
| UI (entity-table.js) | Reads `schema.columns` for column order |

**Important:** SQLite doesn't support `ALTER TABLE ... REORDER COLUMNS`. The physical column order in the table doesn't change, but:
- The **View** is created with the new order
- The **UI** displays columns in schema order

---

## Step 1: Reorder Markdown Table

In `app/systems/<system>/docs/requirements/classes/ENTITY_NAME.md`, arrange the rows of the attribute table in the desired order.

**Example before:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| engine | Engine | Reference [LABEL] | 2001 |
| aircraft | Aircraft | Reference [LABEL2] | 1001 |
| position | int | Engine position | 1 |
```

**Example after:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| aircraft | Aircraft | Reference [LABEL2] | 1001 |
| engine | Engine | Reference [LABEL] | 2001 |
| position | int | Engine position | 1 |
```

---

## Step 2: Update DataModel.yaml

In `app/systems/<system>/docs/requirements/DataModel.yaml`, arrange the attributes of the entity in the same order.

**Example:**
```yaml
EngineMount:
  attributes:
    aircraft:        # now first
      type: Aircraft
      ...
    engine:          # now second
      type: Engine
      ...
    position:
      type: int
      ...
```

---

## Step 3: Restart Server

```bash
./run -s <system>
```

The server will:
1. Parse the updated schema
2. Recreate views with the new column order
3. The UI displays columns in the new order

---

## Step 4: Verification

- [ ] Entity table in UI shows columns in new order
- [ ] Tree view shows correct labels
- [ ] CRUD operations continue to work

---

## Notes

### Seed Data

If `app/systems/<system>/data/seed/ENTITY_NAME.json` exists, the order of keys in JSON objects is not relevant - JSON objects are unordered by definition.

### Physical Table Structure

The physical column order in SQLite remains unchanged. This has no practical impact because:
- All queries go through views
- The UI uses schema order
- INSERT statements use explicit column names

### Computed Fields

Computed fields (e.g., `[COMPUTED:...]`) can be at any position - they are not stored in the database.

---

## Example: EngineMount (aircraft before engine)

**Affected files:**
1. `app/systems/<system>/docs/requirements/classes/EngineMount.md` - Swap table rows
2. `app/systems/<system>/docs/requirements/DataModel.yaml` - Adjust attribute order

**Change:** `engine, aircraft, position, ...` -> `aircraft, engine, position, ...`
