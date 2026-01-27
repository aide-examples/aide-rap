# Schema Migration (Development Mode)

> Schema changes trigger a full table rebuild. Data is automatically backed up before tables are dropped.

## How Schema Changes Work

The server computes an MD5 hash over all entity structures (column names, types, FK relationships, defaults) and type definitions. When the hash changes, **all tables are dropped and recreated**.

This applies to:
- Adding, removing, or renaming attributes
- Changing attribute types or constraints
- Adding or removing entities
- Changing type definitions (enums, patterns)

## Data Safety: Auto-Backup

When the server detects a schema change (hash mismatch), it **automatically backs up all data** before dropping tables:

```
Schema changed - recreating all tables
Auto-backup: saved 439 records from 15 entities before schema drop
Dropped table finding
Dropped table shop_task
...
```

Backup files are written to `app/systems/<system>/data/backup/` as JSON, with FK values stored as **label strings** (not numeric IDs) for portability across schema rebuilds.

This auto-backup runs in both cases:
- **Server restart** (process restart via terminal or status bar button)
- **Reinitialize** (in-app button in Admin Seed Manager)

## Workflows

### Option A: Reinitialize (Recommended)

Use the in-app Reinitialize button for the safest workflow:

1. **Modify DataModel** (entity Markdown files, Types.md)
2. **Open Admin** (hamburger menu → Admin)
3. **Click "Reinitialize"**
   - Step 1: Confirm dialog warns about potential data loss
   - Step 2: Offers manual backup before proceeding
4. Server re-reads DataModel.md, detects hash change, auto-backs up data, rebuilds schema
5. **Click "Restore"** to reload from backup, or **"Load All"** to reload from seed files

### Option B: Server Restart

Restarting the server (terminal or status bar button) triggers the same `initDatabase()` logic:

1. **Modify DataModel**
2. **Restart server** (Ctrl+C + restart, or status bar restart button)
3. Server detects schema change → **auto-backup** → drop + recreate tables
4. Open Admin → **"Restore"** or **"Load All"**

Both options auto-backup. Reinitialize additionally offers a manual backup prompt.

### No Schema Change

If nothing in the DataModel changed:
- **Server restart**: Hash matches → tables are NOT dropped → data is preserved
- **Reinitialize**: Same — hash matches → no drop → data stays. Views are recreated (they may depend on label columns that changed).

## Backup vs. Seed Files

| Source | Location | Content | Best For |
|--------|----------|---------|----------|
| **Seed files** | `data/seed/*.json` | Hand-crafted or AI-generated reference data | Clean start, known-good data |
| **Backup files** | `data/backup/*.json` | Auto-export of current DB state | Preserving user edits, runtime data |

Both use the same JSON format with FK label resolution. Both can be loaded via the Admin UI.

## Restore After Schema Change

After a schema rebuild, FK IDs may have changed (e.g., entity loaded in different order → different auto-increment IDs). This is why backup/seed files store FK values as **labels** — the system resolves them to the correct new IDs during load.

**Caveat**: If a required attribute was added and backup/seed data doesn't include it, those records will fail to load (NOT NULL constraint). Update seed files to include the new attribute before loading.

## Manual Reset

```bash
# Delete database completely and rebuild from scratch
rm app/systems/<system>/data/rap.sqlite
node app/rap.js -s <system>
```
