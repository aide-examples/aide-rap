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
| `DataModel.yaml` | Auto-generated from markdown (parsed at startup) |
| SchemaGenerator | Creates views with the order from schema |
| UI (entity-table.js) | Reads `schema.columns` for column order |

**Important:** SQLite doesn't support `ALTER TABLE ... REORDER COLUMNS`. The physical column order in the table doesn't change, but:
- The **View** is created with the new order
- The **UI** displays columns in schema order

---

## Step 1: Reorder Markdown Table

In `app/systems/<system>/docs/classes/ENTITY_NAME.md`, arrange the rows of the attribute table in the desired order.

**Example before:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| project | Project | Reference [LABEL] | 2001 |
| employee | Employee | Reference [LABEL2] | 1001 |
| role | string | Deployment role | Lead |
```

**Example after:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| employee | Employee | Reference [LABEL2] | 1001 |
| project | Project | Reference [LABEL] | 2001 |
| role | string | Deployment role | Lead |
```

---

## Step 2: Restart Server

```bash
./run -s <system>
```

The server will:
1. Parse the updated schema (DataModel.yaml is auto-generated)
2. Recreate views with the new column order
3. The UI displays columns in the new order

---

## Step 3: Verification

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

## Example: Deployment (employee before project)

**Affected file:**
`app/systems/<system>/docs/classes/Deployment.md` - Swap table rows

**Change:** `project, employee, role, ...` -> `employee, project, role, ...`

**Note:** `DataModel.yaml` is auto-generated from the markdown files - no manual editing needed.
