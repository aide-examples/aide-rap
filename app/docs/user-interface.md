# User Interface

### Three-View Entity Explorer

Switch seamlessly between viewing modes:

| View | Best For |
|------|----------|
| **Table** | Quick scanning, sorting, filtering |
| **Tree (Vertical)** | Deep relationship exploration |
| **Tree (Horizontal)** | Compact attribute display |

**Deep Relationship Traversal:** The tree view doesn't stop at one level. Click any foreign key to expand it, then expand *its* foreign keys, and so on – as deep as you want to go:

```
Employee EMP-1042
  └─ department: Marketing
       └─ company: Acme Corp
            └─ Employee [5] ← back-references!
                 └─ EMP-1043
                      └─ manager: Sarah Chen
                           └─ ...
```

**Cycle Detection** prevents infinite loops – if you'd circle back to an already-visited record, you'll see a ↻ marker instead of an expand arrow.

**Focused Navigation** keeps the tree manageable – opening a new branch automatically closes sibling branches.

### Breadcrumb Navigation

Navigate through your exploration history with a visual breadcrumb trail:

```
[Employee] › [Employee EMP-1042] › [Department Marketing]
     ↑              ↑                      ↑
  Base crumb    Record crumb         Current position
```

**How it works:**
- **Dropdown selection** sets the base crumb (entity or view) and clears the navigation stack
- **FK link clicks** push new crumbs onto the stack (record navigation)
- **Back-reference counts** push filtered crumbs (e.g., "5 Deployments" → Deployments filtered by employee)
- **Crumb clicks** truncate the stack and restore that state
- **Browser back/forward** buttons navigate through the history

**State Preservation:**
When navigating back, the system restores:
- **View mode** (table, tree-v, tree-h, map, chart)
- **Selected row** – highlights the row you navigated from in table view

**Display Options** (Settings → Breadcrumb display):
| Option | Display | Tooltip |
|--------|---------|---------|
| **Full** | Entity + Label | – |
| **Label only** | Just the label | Entity type |
| **Entity only** | Just the entity | Label |

**Deep Linking & Sharing:**
Right-click any breadcrumb to share the navigation state:
- **Share Dialog** shows a URL with the current breadcrumb stack encoded as base64 JSON
- **QR Code** (300×300px) for quick mobile access
- **Guest Auth Option** – include `?user=guest` for anonymous access
- **URL Parameter** `?crumbs=...` – open directly to a specific navigation state

Example URL:
```
https://myapp.com/rap?user=guest&crumbs=W3sidCI6ImUiLCJlIjoiQWlyY3JhZnQifV0=
```

**FK Label Resolution:** Instead of showing raw IDs, the system creates database views that join display labels:

```sql
-- Auto-generated view
CREATE VIEW employee_view AS
SELECT a.*,
       t.name AS department_label,
       o.name AS manager_label
FROM employee a
LEFT JOIN department t ON a.department_id = t.id
LEFT JOIN manager o ON a.manager_id = o.id
```

One query returns everything the UI needs – no N+1 problems.

### User Views (Cross-Entity Join Tables)

Define read-only views in `config.json` that join data across entities via FK chains:

```json
{
    "name": "Project Status",
    "base": "Deployment",
    "columns": [
        "employee.emp_code AS Employee",
        "project.type.name AS Project Type",
        "role AS Role OMIT 0"
    ]
}
```

- **Dot-notation paths** follow FK relationships: `project.type.name` → Deployment → Project → ProjectType
- **AS alias** for custom column headers
- **OMIT** suppresses specific values from display (FK columns default to `OMIT null`)
- Materialized as SQL views (`uv_*`) at startup — no runtime overhead
- Separate **Views dropdown** (blue) left of the entity selector
- Full column filtering and sorting, same as entity tables
- Row click jumps to the base entity's edit form

**Back-Reference Columns** pull data from child entities that point *to* the base entity via FK — implemented as correlated SQL subqueries:

```json
{
    "name": "Employee Overview",
    "base": "Employee",
    "columns": [
        "emp_code AS Code",
        "department.name AS Department",
        "Deployment<employee(COUNT) AS Deployments",
        "Milestone<employee(COUNT) AS Milestones OMIT 0",
        "Deployment<employee(WHERE end_date=null, LIMIT 1).project.name AS Current Project"
    ]
}
```

Syntax: `Entity<fk_field(params).column`

| Part | Description | Example |
|------|-------------|---------|
| `Entity` | Child entity with FK to base | `Deployment` |
| `<fk_field` | FK column pointing to base (without `_id`) | `<employee` |
| `(params)` | Comma-separated: `COUNT`, `LIST`, `WHERE col=val`, `ORDER BY col`, `LIMIT n` | `(WHERE end_date=null, LIMIT 1)` |
| `.column` | Target column, supports FK-chain dot-paths | `.project.name` |

See [Views Configuration](procedures/views-config.md) for the full syntax reference.

### Context Menu

Right-click any record (in table or tree) for quick actions:
- **New** – Create a new record of this entity type
- **Details** – Read-only view in side panel
- **Edit** – Open form for modification
- **Delete** – With confirmation and FK constraint checking
- **Export CSV** – Download current table view as CSV (semicolon-separated, UTF-8)
- **Export PDF** – Download current table view as PDF

### Export (PDF, CSV)

Export the current table view to a professionally formatted PDF:

- **A4 Landscape** layout for maximum column space
- **Entity color** in title bar and column headers
- **FK column colors** match their target entity's area color
- **Dynamic column widths** based on content
- **Filtered data** – exports only what's currently visible
- **FK labels** instead of raw IDs
- **Enum conversion** – shows external values, not internal codes
- **Automatic page breaks** with header repetition
- **Page numbers** on each page

**TreeView PDF Export:**

When in Tree View mode, PDF export captures the currently expanded structure:
- Exports only what's visible (expanded nodes)
- Uses indentation to show hierarchy depth
- Includes symbols for relationships: `▸` root, `→` FK, `←` back-reference, `↻` cycle
- Respects current sort settings (attribute order, reference position)
