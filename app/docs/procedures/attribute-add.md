# Procedure: Add Attribute

> Reusable guide for adding a new attribute to an existing entity.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
ATTR_NAME   = <attribute_name>   # Attribute name (snake_case)
ATTR_TYPE   = <type>             # Data type (string, int, date, bool, or FK entity)
```

---

## Step 1: Add Attribute to Markdown Table

In `app/systems/<system>/docs/requirements/classes/ENTITY_NAME.md`, add a new row to the attribute table:

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... existing attributes ... |
| ATTR_NAME | ATTR_TYPE | Description [MARKER] | Example value |
```

### Optional Markers

| Marker | Meaning | Example |
|--------|---------|---------|
| `[DEFAULT=x]` | Default value for new/existing rows | `[DEFAULT=100]` |
| `[LABEL]` | Primary label for TreeView | |
| `[LABEL2]` | Secondary label | |
| `[READONLY]` | Not editable in UI | |
| `[HIDDEN]` | Not displayed in UI | |
| `[UK1]` | Part of a unique key | |

**Example with default:**
```markdown
| severity_factor | int | Effect of flight profile on degradation in % [DEFAULT=100] | 90 |
```

---

## Step 2: Restart Server

```bash
./run -s <system>
```

The SchemaGenerator will:
1. Detect the new attribute in the schema
2. Execute `ALTER TABLE ... ADD COLUMN`
3. Set the DEFAULT value (if specified) for new rows
4. Recreate the view with the new column

---

## Step 4: Update Existing Data (Optional)

If a `[DEFAULT=x]` was specified, existing rows will initially have `NULL`. To set the default retroactively:

```sql
UPDATE ENTITY_TABLE SET ATTR_NAME = DEFAULT_VALUE WHERE ATTR_NAME IS NULL;
```

**Example:**
```sql
UPDATE engine SET severity_factor = 100 WHERE severity_factor IS NULL;
```

---

## Step 5: Verification

- [ ] Server starts without errors
- [ ] New attribute appears in entity table (UI)
- [ ] New attribute is editable (unless READONLY)
- [ ] Default value is set for new records
- [ ] Existing records have correct value (after UPDATE)

---

## Notes

### Foreign Key Attributes

If the new attribute is a reference to another entity:

```markdown
| operator | Operator | Reference to operator [LABEL2] | 5 |
```

The SchemaGenerator automatically creates:
- The FK column (`operator_id INTEGER`)
- The foreign key constraint
- The view with label resolution (`operator_label`)

### Computed Fields

Computed fields are not stored in the database:

```markdown
| current_aircraft | Aircraft | [READONLY] [DAILY=EngineMount[removed_date=null].aircraft] | 1001 |
```

These don't require `ALTER TABLE` - they are calculated at runtime.

### Seed Data

If `app/systems/<system>/data/seed/ENTITY_NAME.json` exists and the new attribute is missing:
- Seed data can remain as-is (NULL will be inserted)
- Or update seed data manually/via LLM

---

## Example: severity_factor for Engine

**Change in Engine.md:**
```markdown
| severity_factor | int | Effect of flight profile on degradation in % [DEFAULT=100] | 90 |
```

**After server restart:**
```sql
UPDATE engine SET severity_factor = 100 WHERE severity_factor IS NULL;
```

**Note:** `DataModel.yaml` is auto-generated from the markdown files - no manual editing needed.
