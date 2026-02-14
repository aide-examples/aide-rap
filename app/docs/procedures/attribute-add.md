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

In `app/systems/<system>/docs/classes/ENTITY_NAME.md`, add a new row to the attribute table:

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
| priority_level | int | Task priority from 1 (low) to 100 (critical) [DEFAULT=50] | 90 |
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

## Step 3: Update Import Mapping (if exists)

Check if an import definition exists for this entity:

```
app/systems/<system>/docs/imports/ENTITY_NAME.md
```

If it exists, add a row for the new attribute in the **Mapping** table:

- If the attribute **has a source column** in the Excel: map source → target with optional transform
- If the attribute **has no source column** (manually managed): add with empty source

```markdown
| Source Column Name                      | ATTR_NAME | transform |
|                                         | ATTR_NAME | |
```

This ensures the import definition stays in sync with the entity schema.

---

## Step 4: Update Existing Data (Optional)

If a `[DEFAULT=x]` was specified, existing rows will initially have `NULL`. To set the default retroactively:

```sql
UPDATE ENTITY_TABLE SET ATTR_NAME = DEFAULT_VALUE WHERE ATTR_NAME IS NULL;
```

**Example:**
```sql
UPDATE project SET priority_level = 50 WHERE priority_level IS NULL;
```

---

## Step 5: Verification

- [ ] Server starts without errors
- [ ] New attribute appears in entity table (UI)
- [ ] New attribute is editable (unless READONLY)
- [ ] Default value is set for new records
- [ ] Existing records have correct value (after UPDATE)
- [ ] Import mapping updated (if import exists)

---

## Notes

### Foreign Key Attributes

If the new attribute is a reference to another entity:

```markdown
| manager | Manager | Reference to manager [LABEL2] | 5 |
```

The SchemaGenerator automatically creates:
- The FK column (`manager_id INTEGER`)
- The foreign key constraint
- The view with label resolution (`manager_label`)

### Computed Fields

Computed fields are stored in the database but calculated automatically:

```markdown
# Boolean filter: find record matching condition
| current_department | Department | [READONLY] [DAILY=Assignment[end_date=null OR end_date>TODAY].department] | 5 |

# Aggregate function: find record with MAX/MIN value
| latest_project | Project | [READONLY] [DAILY=Deployment[MAX(end_date)].project] | 1 |
```

These require `ALTER TABLE ADD COLUMN` but values are computed by ComputedFieldService.

See [Computed References](../computed-references.md) for full syntax.

### Seed Data

If `app/systems/<system>/data/seed/ENTITY_NAME.json` exists and the new attribute is missing:
- Seed data can remain as-is (NULL will be inserted)
- Or update seed data manually/via LLM

---

## Example: priority_level for Project

**Change in Project.md:**
```markdown
| priority_level | int | Task priority from 1 (low) to 100 (critical) [DEFAULT=50] | 90 |
```

**After server restart:**
```sql
UPDATE project SET priority_level = 50 WHERE priority_level IS NULL;
```

**Note:** `DataModel.yaml` is auto-generated from the markdown files - no manual editing needed.
