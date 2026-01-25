# Procedure: Delete System

> Guide for completely removing an AIDE RAP system.

## Variables

```
SYSTEM_NAME = <system_name>   # System directory name (snake_case)
```

---

## Method 1: Via Model Builder UI (Recommended)

1. Open the AIDE RAP main application
2. Click **Seed Data** in the toolbar (or press `/`)
3. Click **+ New System** to open the Model Builder
4. Select the system from the dropdown
5. Click the red **Delete System** button
6. Confirm the deletion in the popup dialog

**Note:** This method removes the entire `app/systems/<SYSTEM_NAME>/` directory.

---

## Method 2: Via Command Line

### Step 1: Stop the Server

If the system is currently running:

```bash
# Find and stop the server process
pkill -f "node.*-s SYSTEM_NAME" || true
```

### Step 2: Remove System Directory

```bash
rm -rf app/systems/SYSTEM_NAME/
```

### Step 3: Verify

```bash
# Should return "No such file or directory"
ls app/systems/SYSTEM_NAME/
```

---

## What Gets Deleted

| Path | Contents |
|------|----------|
| `app/systems/SYSTEM_NAME/config.json` | Port, PWA settings, entity list |
| `app/systems/SYSTEM_NAME/design.md` | Design brief (if created via Model Builder) |
| `app/systems/SYSTEM_NAME/docs/` | Documentation and entity definitions |
| `app/systems/SYSTEM_NAME/data/` | SQLite database and seed files |
| `app/systems/SYSTEM_NAME/help/` | User guide |

---

## Recovery

**There is no automatic recovery.** If you accidentally delete a system:

1. Check if you have a git backup: `git checkout -- app/systems/SYSTEM_NAME/`
2. Check your file system backups
3. Recreate the system using Model Builder

---

## Notes

- Deletion is immediate and permanent
- The UI requires explicit confirmation before deletion
- The API endpoint is `DELETE /api/model-builder/systems/:name`
- Port numbers are not recycled (next system gets next available port)
