# Procedure: Rename Entity

> Reusable guide for renaming an entity in an AIDE RAP project.

## Variables

```
OLD_NAME = <OldName>             # Old entity name (PascalCase)
NEW_NAME = <NewName>             # New entity name (PascalCase)
OLD_TABLE = <old_name>           # Old table name (snake_case)
NEW_TABLE = <new_name>           # New table name (snake_case)
```

---

## Step 1: Find References

Before renaming, search for all references:

```bash
grep -r "OLD_NAME" app/systems/<system>/docs/
grep -r "OLD_NAME" app/systems/<system>/data/seed/
grep -r "OLD_NAME" app/server/
grep -r "OLD_NAME" app/systems/<system>/config.json
```

**Typical locations:**
- `app/systems/<system>/docs/classes/OLD_NAME.md` - Entity definition
- `app/systems/<system>/docs/DataModel.md` - List and links
- `app/systems/<system>/docs/DataModel-layout.json` - Diagram position
- `app/systems/<system>/docs/classes/*.md` - Seed context in other entities
- `app/systems/<system>/data/seed/OLD_NAME.json` - Generated seed data
- `app/systems/<system>/config.json` - enabledEntities list

**Note:** `DataModel.yaml` is auto-generated - no need to search there.

---

## Step 2: Rename Files

```bash
# Entity Markdown
mv app/systems/<system>/docs/classes/OLD_NAME.md app/systems/<system>/docs/classes/NEW_NAME.md

# Seed data (if exists)
mv app/systems/<system>/data/seed/OLD_NAME.json app/systems/<system>/data/seed/NEW_NAME.json
```

---

## Step 3: Update Contents

### 3.1 Entity File (NEW_NAME.md)
- Change title: `# OLD_NAME` -> `# NEW_NAME`

### 3.2 DataModel.md
- Update link: `[OLD_NAME](classes/OLD_NAME.md)` -> `[NEW_NAME](classes/NEW_NAME.md)`
- Adjust description text if needed

### 3.3 DataModel-layout.json
- Change key: `"OLD_NAME":` -> `"NEW_NAME":`

### 3.4 config.json
- Rename in `crud.enabledEntities` array

### 3.5 Other Entity Files (Seed Context, FK References, Prose)
- Replace all `OLD_NAME` references with `NEW_NAME`
- **Important:** Also check prose in `## Data Generator` sections!

---

## Step 4: Database Migration

**Important:** The SchemaGenerator automatically creates the new table on server start, but data must be migrated manually.

```python
import sqlite3
conn = sqlite3.connect('app/systems/<system>/data/<system>.sqlite')
cursor = conn.cursor()

# 1. Backup the data
cursor.execute('SELECT * FROM OLD_TABLE')
data = cursor.fetchall()

# 2. Create new table with correct constraints
cursor.execute('''
CREATE TABLE NEW_TABLE (
  id INTEGER PRIMARY KEY,
  -- ... columns analogous to old table ...
  -- ... foreign keys and constraints ...
)
''')

# 3. Insert data
for row in data:
    cursor.execute('INSERT INTO NEW_TABLE (...) VALUES (...)', row)

conn.commit()

# 4. Verify
cursor.execute('SELECT COUNT(*) FROM NEW_TABLE')
print(f'Migrated {cursor.fetchone()[0]} rows')

# 5. Drop old table (after verification)
cursor.execute('DROP TABLE OLD_TABLE')
conn.commit()
conn.close()
```

**Alternative:** Restart server, then views are automatically recreated.

---

## Step 5: Verification

- [ ] Server starts without errors
- [ ] Entity with new name appears in UI
- [ ] Data is complete
- [ ] FK references work
- [ ] Seed context in dependent entities is correct
- [ ] No "orphaned columns" warnings at startup

---

## Example: EngineTypePossible -> EngineMountPossible

**Affected files:**
1. `classes/EngineTypePossible.md` -> `classes/EngineMountPossible.md`
2. `DataModel.md` - Link update
3. `DataModel-layout.json` - Position key
4. `config.json` - enabledEntities
5. `classes/EngineMount.md` - Seed context
6. `seed/EngineTypePossible.json` -> `seed/EngineMountPossible.json`

**Note:** `DataModel.yaml` is auto-generated - will update on server restart.

**Database:**
- `engine_type_possible` -> `engine_mount_possible` (30 records)
