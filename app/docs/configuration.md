# Configuration

### System Configuration

Each system has its own `config.json` in `app/systems/<name>/`.
Use `app/config_sample.json` as template for new systems.

```json
{
  "port": 18354,
  "log_level": "INFO",
  "titleHtml": "<img src='/icons/logo.png'>My System",
  "auth": {
    "enabled": true,
    "passwords": { "admin": "<sha256-hash>", "user": "" },
    "sessionSecret": "change-in-production",
    "sessionTimeout": 86400
  },
  "pagination": { "threshold": 100, "pageSize": 100, "filterDebounceMs": 2000 },
  "tree": { "backRefPreviewLimit": 10 },
  "pwa": {
    "enabled": true,
    "name": "My System",
    "short_name": "SYS",
    "theme_color": "#2563eb"
  },
  "layout": { "default": "page-fill", "allow_toggle": false },
  "docsEditable": true,
  "helpEditable": false
}
```

### Pagination Settings

| Parameter | Default | Description |
|-----------|---------|-------------|
| `threshold` | 500 | Show filter dialog and use pagination when record count exceeds this |
| `pageSize` | 200 | Number of records per page (infinite scroll) |
| `filterDebounceMs` | 2000 | Delay before server-side filter query (ms) |

**Server-Side Filtering**: When not all records are loaded (pagination active), column filters trigger a server query after `filterDebounceMs` of inactivity. The status bar shows "X of Y records" to indicate partial loading.

### UI Configuration (Markdown)

Entity visibility and views are defined in `docs/`:

**Crud.md** — Which entities appear in the UI:
```markdown
# CRUD

## Engine Management
- Engine
- EngineEvent

---

## Operations
- Aircraft
- Operator
```

`## Area` groups entities into named sections. A horizontal rule (`---`) inserts a **column break** in the selector dropdown — areas before the first `---` appear in column 1, areas after it in column 2, and so on. Without any `---`, each area becomes its own column (default).

**Views.md** (optional) — Area ordering and column layout for the view selector:
```markdown
## Engine Management
---
## Operations
---
## Finance
```

Only `##` headers and `---` separators. Views within each area are still loaded from `docs/views/{Area}/*.md`. Areas not listed in Views.md are appended alphabetically. Without Views.md, areas appear alphabetically with one column per area.

**Processes.md** (optional) — Area ordering and column layout for the process selector:
```markdown
## Engine Management
---
## Operations
```

Same syntax as Views.md. Processes are loaded from `docs/processes/{Area}/*.md`.

**processes/{Area}/{ProcessName}.md** — Business process guides (one file per process):
```markdown
# Engine Shop Visit

Required: Engine:select

This process guides you through handling an engine shop visit.

## Review Engine Usage
Check the engine's flight hours and cycles.
- Open the **Engine Usage** view
- Review total FH and FC since last overhaul

View: Engine Usage

## Create Workscope
Create a workscope document for the maintenance work.

Entity: Workscope
```

Each `##` becomes a tab. `View:` and `Entity:` directives become action buttons.

**views/{Area}/{ViewName}.md** — Cross-entity join views (one file per view):
```
docs/views/
├── Engine Management/
│   ├── Engine Status.md
│   └── Engine Overview.md
└── Finance/
    └── Exchange Rates.md
```

Each view file contains a JSON block with the view definition:
```markdown
# Engine Status

```json
{ "base": "EngineAllocation", "columns": ["engine.serial_number AS ESN", "aircraft.registration"] }
```
```

See [Views Configuration](procedures/views-config.md) for the full syntax.

### Authentication

Enable authentication in `config.json`:

```json
{
  "auth": {
    "enabled": true,
    "passwords": {
      "admin": "<sha256-hash>",
      "user": "",
      "guest": ""
    },
    "sessionSecret": "change-in-production",
    "sessionTimeout": 86400
  }
}
```

**Generate password hash:**
```bash
node app/tools/generate-password-hash.js mypassword
# Output: 5e884898da28047d1650f25e4ca478eb...
```

**Roles:**
- `admin` – Full access, always requires password
- `user` – Standard access, password optional (empty = no password required)
- `guest` – Read-only access, password optional

**URL-Login for Bookmarks:**
```
http://server/?user=admin&password=mypassword
http://server/?user=admin&pwh=5e884898da28047d...
```

Passwords are hashed client-side (SHA-256) before transmission. URL is cleaned after login to prevent credentials in browser history.

**Disable auth:** Start server with `--noauth` flag or set `"enabled": false`.
