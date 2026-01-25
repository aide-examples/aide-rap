# Procedure: Delete Attribute

> Reusable guide for completely removing an attribute from an entity.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
ATTR_NAME   = <attribute_name>   # Attribute name (snake_case)
TABLE_NAME  = <table_name>       # Table name (snake_case)
```

---

## Step 1: Remove Attribute from Markdown Table

In `app/systems/<system>/docs/requirements/classes/ENTITY_NAME.md`, delete the row with the attribute:

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... |
| ATTR_NAME | ... | ... | ... |  <- Delete this row
| ... |
```

---

## Step 2: Remove Attribute from DataModel.yaml

In `app/systems/<system>/docs/requirements/DataModel.yaml`, delete the attribute block:

```yaml
ENTITY_NAME:
  attributes:
    # ...
    - name: ATTR_NAME        <- Delete this block
      type: ...
      description: ...
    # ...
```

---

## Step 3: Remove Database Column

**Option A: SQLite 3.35.0+ (ALTER TABLE DROP COLUMN)**

```sql
ALTER TABLE TABLE_NAME DROP COLUMN ATTR_NAME;
```

**Option B: Older SQLite versions (recreate table)**

```python
import sqlite3
conn = sqlite3.connect('app/systems/<system>/data/<system>.sqlite')
cursor = conn.cursor()

# 1. Get table columns (excluding the one to delete)
cursor.execute(f"PRAGMA table_info({TABLE_NAME})")
columns = [col[1] for col in cursor.fetchall() if col[1] != 'ATTR_NAME']
cols_str = ', '.join(columns)

# 2. Create temporary table
cursor.execute(f"CREATE TABLE {TABLE_NAME}_backup AS SELECT {cols_str} FROM {TABLE_NAME}")

# 3. Drop original table
cursor.execute(f"DROP TABLE {TABLE_NAME}")

# 4. Rename backup
cursor.execute(f"ALTER TABLE {TABLE_NAME}_backup RENAME TO {TABLE_NAME}")

conn.commit()
conn.close()
```

---

## Step 4: Restart Server

```bash
./run -s <system>
```

The SchemaGenerator will:
1. Detect the missing attribute in the schema
2. Recreate the view without the deleted column
3. Warn about "orphaned column" if column still exists in DB

---

## Step 5: Verification

- [ ] Server starts without errors
- [ ] Attribute no longer appears in UI
- [ ] No "orphaned column" warning at startup
- [ ] CRUD operations continue to work

---

## Notes

### Seed Data

If `app/systems/<system>/data/seed/ENTITY_NAME.json` contains the attribute:
- Can remain as-is (will be ignored on import)
- Or manually remove from JSON

### Foreign Key Attributes

If the attribute was a FK:
- Constraint is automatically removed when column is deleted
- Dependent views are recreated on server restart

### Computed Fields

Computed fields (e.g., `[DAILY=...]`) don't exist in the database:
- Only remove from Markdown and YAML
- No database step needed

---

## Example: Delete severity_factor from Engine

**Step 1:** Engine.md - Remove row:
```markdown
| severity_factor | int [DEFAULT=100] | ... | 90 |  <- delete
```

**Step 2:** DataModel.yaml - Remove block:
```yaml
      - name: severity_factor
        type: int
        description: ...
```

**Step 3:** Database:
```sql
ALTER TABLE engine DROP COLUMN severity_factor;
```

**Step 4:** Restart server
