# AIDE RAP - Claude Code Context

> Instructions for Claude Code when working on this project.

## Architecture

```
aide-frame (framework)     → Generic web app foundation
    ↓
AIDE RAP (this repo)       → Rapid Application Prototyping engine
    ↓
Systems (irma, book, ...)  → Domain-specific applications
```

## Creating a New System

To create a new system (e.g., "myapp"):

1. **Copy the book template:**
   ```bash
   cp -r app/systems/book app/systems/myapp
   ```

2. **Edit the configuration:**
   - `app/systems/myapp/config.json` - App name, PWA settings
   - `app/systems/myapp/docs/requirements/DataModel.md` - Define your entities

3. **Start the server:**
   ```bash
   ./run -s myapp
   ```

4. **Use the Layout Editor** to position entities in the diagram:
   - http://localhost:18354/layout-editor

## Key Files

| File | Purpose |
|------|---------|
| `app/systems/<system>/docs/requirements/DataModel.md` | **Source of Truth** - Entity definitions |
| `app/systems/<system>/docs/requirements/classes/*.md` | Individual entity details + seed context |
| `app/systems/<system>/config.json` | System configuration |
| `app/systems/<system>/data/*.sqlite` | Generated database |

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

## Procedures

Standard procedures are documented in `app/docs/procedures/`:
- `entity-rename.md` - How to rename an entity
- `attribute-add.md` - How to add a new attribute
- `attribute-delete.md` - How to remove an attribute
- `attribute-reorder.md` - How to change column order
- `schema-migration.md` - How to handle schema changes

## Development Ports

| Who | Port | Command |
|-----|------|---------|
| User | 18354 | `./run -s <system>` |
| Claude | 18355 | `./run -s <system> -p 18355` |

## Project Structure

```
app/
├── server/          # Node.js backend
├── shared/          # Isomorphic code (browser + Node.js)
├── static/rap/      # Frontend (vanilla JS)
├── docs/            # RAP platform documentation
└── systems/         # Domain-specific systems
    ├── irma/        # Aircraft maintenance demo
    └── book/        # Simple library demo (template)
tools/               # Build and generation scripts
aide-frame/          # Framework submodule
```

## Important Notes

- **Single Source of Truth:** Always edit `DataModel.md` first, then restart server
- **Generated files:** `DataModel.yaml`, `layout.json`, `*.svg` are auto-generated
- **Database:** SQLite files are created/updated automatically on server start
- **All documentation in English** (except i18n locale files)
