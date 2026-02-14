# Procedure: Rename Attribute

> Reusable guide for renaming an attribute on an existing entity without data loss.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
TABLE_NAME  = <table_name>       # Table name (snake_case)
OLD_NAME    = <old_attribute>    # Current attribute name (snake_case)
NEW_NAME    = <new_attribute>    # New attribute name (snake_case)
```

---

## Step 1: Rename Column in Database

Rename the column **before** changing the schema, so the auto-backup captures data under the new name.

```javascript
node -e "
const db = require('better-sqlite3')('app/systems/<system>/data/rap.sqlite');
db.exec('ALTER TABLE TABLE_NAME RENAME COLUMN OLD_NAME TO NEW_NAME');
db.close();
console.log('Column renamed');
"
```

---

## Step 2: Update Entity Markdown

In `app/systems/<system>/docs/classes/ENTITY_NAME.md`, change the attribute name in the table:

```markdown
| OLD_NAME | type | Description | Example |    <- Before
| NEW_NAME | type | Description | Example |    <- After
```

---

## Step 3: Update Import Mapping (if exists)

If `app/systems/<system>/docs/imports/ENTITY_NAME.md` exists:
- Update the **Target** column from `OLD_NAME` to `NEW_NAME`
- Check if **Source Edit** or **Source Filter** references need updating

---

## Step 4: Update Seed Data (if exists)

If `app/systems/<system>/data/seed/ENTITY_NAME.json` exists:
- Rename the key in all records from `OLD_NAME` to `NEW_NAME`

---

## Step 5: Update Views (if referenced)

Check `app/systems/<system>/docs/views/` for any view definitions that reference `OLD_NAME`:
- Update column references to `NEW_NAME`

---

## Step 6: Restart Server

```bash
./run -s <system>
```

The server will:
1. Detect the schema change (hash mismatch)
2. Auto-backup all data (with the **new** column name from Step 1)
3. Drop and recreate all tables
4. You must then **Restore** from backup (Admin UI or API)

```bash
curl -X POST http://localhost:<port>/api/seed/restore-backup
```

---

## Step 7: Verification

- [ ] Server starts without errors
- [ ] Attribute appears with new name in UI
- [ ] All data preserved after restore
- [ ] Import mapping updated (if import exists)
- [ ] Seed data updated (if seed exists)
- [ ] Views updated (if views reference the attribute)

---

## Why Rename Before Schema Change?

The auto-backup exports data using **current database column names**. If you change the Markdown first and restart:
1. Backup exports with OLD_NAME (still in DB)
2. Schema rebuilds expecting NEW_NAME
3. Restore fails to map OLD_NAME data to NEW_NAME column

By renaming the DB column first, the backup already uses NEW_NAME, and the restore maps correctly.
