# AIDE RAP - Claude Code Context

> Instructions for Claude Code when working on this project.
>
> For general project information, see [README.md](README.md).

## Development Ports

User and Claude use separate ports to avoid conflicts:

| Who | Port | Command |
|-----|------|---------|
| User | 18354 | `./run -s <system>` |
| Claude | 18355 | `./run -s <system> -p 18355` |

When Claude says "Server restart required", the user restarts their server on 18354.

## Creating a New System

**Recommended:** Use the Model Builder UI (see `app/docs/procedures/system-create.md`)

1. Open Seed Data Manager (toolbar or `/` key)
2. Click **+ New System**
3. Follow the wizard tabs

**Alternative (manual):**

```bash
cp -r app/systems/book app/systems/myapp
```

Then edit:
- `app/systems/myapp/config.json` - App name, PWA settings
- `app/systems/myapp/docs/requirements/DataModel.md` - Entity definitions

## Entity Definition Format

In `DataModel.md`, define entities like this:

```markdown
### MyEntity
Description of what this entity represents.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| name | string | Display name [LABEL] | "Example" |
| count | int | Number of items [DEFAULT=0] | 42 |
| parent | OtherEntity | Reference to parent [LABEL2] | 1 |
| status | bool | Is active | true |
```

**Markers:**
- `[LABEL]` / `[LABEL2]` - Used in tree view and dropdowns
- `[DEFAULT=x]` - Default value for new records
- `[READONLY]` - Not editable in UI
- `[HIDDEN]` - Not displayed in UI
- `[UK1]` - Part of unique key constraint

**Types:** `string`, `int`, `date`, `bool`, `text`, or any EntityName (creates FK)

## Key Files

| File | Purpose |
|------|---------|
| `app/systems/<system>/docs/requirements/DataModel.md` | **Source of Truth** - Entity definitions |
| `app/systems/<system>/docs/requirements/classes/*.md` | Individual entity details + seed context |
| `app/systems/<system>/config.json` | System configuration |

## Procedures

Standard procedures are documented in `app/docs/procedures/`:

**System Management:**
- `system-create.md` - How to create a new system via Model Builder
- `system-delete.md` - How to delete a system completely

**Entity Operations:**
- `entity-rename.md` - How to rename an entity
- `attribute-add.md` - How to add a new attribute
- `attribute-delete.md` - How to remove an attribute
- `attribute-reorder.md` - How to change column order
- `schema-migration.md` - How to handle schema changes

## Important Notes

- **Single Source of Truth:** Always edit `DataModel.md` first, then restart server
- **Generated files:** `DataModel.yaml`, `layout.json`, `*.svg` are auto-generated
- **Database:** SQLite files are created/updated automatically on server start
- **All documentation in English** (except i18n locale files)
