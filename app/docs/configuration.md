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

## Projects
- Project
- Milestone

---

## People
- Employee
- Manager
```

`## Area` groups entities into named sections. A horizontal rule (`---`) inserts a **column break** in the selector dropdown — areas before the first `---` appear in column 1, areas after it in column 2, and so on. Without any `---`, each area becomes its own column (default).

**Views.md** (optional) — Area ordering and column layout for the view selector:
```markdown
## Projects
---
## People
---
## Finance
```

Only `##` headers and `---` separators. Views within each area are still loaded from `docs/views/{Area}/*.md`. Areas not listed in Views.md are appended alphabetically. Without Views.md, areas appear alphabetically with one column per area.

**Processes.md** (optional) — Area ordering and column layout for the process selector:
```markdown
## Projects
---
## People
```

Same syntax as Views.md. Processes are loaded from `docs/processes/{Area}/*.md`.

**processes/{Area}/{ProcessName}.md** — Business process guides (one file per process):
```markdown
# Employee Onboarding

Required: Employee:select

This process guides you through onboarding a new employee.

## Review Employee Profile
Check the employee's details and department assignment.
- Open the **Staff Overview** view
- Verify contact information and start date

View: Staff Overview

## Assign Equipment
Assign required equipment (laptop, phone, access card) to the employee.

Entity: Equipment
```

Each `##` becomes a tab. `View:`, `Entity:`, and `Call:` directives become action buttons.

`Call:` triggers an external API query dialog (see [External Queries](#external-queries)):
```markdown
## Verify Compliance
Check external databases for relevant regulations.

Call: Search Regulations(ProductType)
```
The syntax is `Call: Label(ContextKey)` — `Label` is the button text, `ContextKey` references a process context entity whose value becomes the search term. The provider is resolved from the `externalQueries` config for that entity type.

**views/{Area}/{ViewName}.md** — Cross-entity join views (one file per view):
```
docs/views/
├── Projects/
│   ├── Project Status.md
│   └── Project Overview.md
└── Finance/
    └── Exchange Rates.md
```

Each view file contains a JSON block with the view definition:
```markdown
# Project Status

```json
{ "base": "Deployment", "columns": ["employee.emp_code AS Employee", "project.name AS Project"] }
```
```

See [Views Configuration](procedures/views-config.md) for the full syntax.

### External Queries

Query external REST APIs at runtime from context menus and process steps. Two configuration layers:

**1. Provider Definitions** (`app/api_providers.json`) — which APIs are available:

```json
{
  "my-provider": {
    "name": "Human-readable name",
    "description": "What this provider searches",
    "baseUrl": "https://api.example.com/search.json",
    "params": {
      "q": "\"${term}\"",
      "per_page": "25",
      "fields[]": ["title", "date", "url"]
    },
    "resultMapping": {
      "title": "title",
      "date": "publication_date",
      "number": "document_number",
      "abstract": "abstract",
      "url": "html_url"
    },
    "pagination": {
      "pageParam": "page",
      "totalCountField": "total_count",
      "hasMoreField": "next_page_url"
    }
  }
}
```

`${term}` in param values is replaced with the user's search term at runtime. The `resultMapping` maps API response fields to the standard dialog columns (title, date, number, abstract, url).

**2. System Configuration** (`config.json`) — which entities offer external lookups:

```json
{
  "externalQueries": {
    "MyEntity": {
      "provider": "my-provider",
      "searchField": "name",
      "label": "Search External DB"
    }
  }
}
```

| Parameter | Description |
|-----------|-------------|
| `provider` | Provider ID from `api_providers.json` |
| `searchField` | Entity field whose value is used as search term |
| `label` | Display label for context menu item and dialog title |

**Trigger Locations:**
- **Context Menu** — Right-click on an entity row or FK cell of a configured type
- **Process Steps** — `Call: Label(EntityType)` directive in process definitions

**Built-in Demo Provider** (shipped with RAP in `api_providers.json`):

| Provider | Source | Description |
|----------|--------|-------------|
| `federal-register-ad` | US Federal Register API | Searches the US Federal Register (free, no API key). Included as a working demo of the external query feature. |

**API Endpoint:** `GET /api/admin/external-query?provider=...&term=...&page=1` (admin role required)

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
