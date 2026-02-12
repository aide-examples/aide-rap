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

### Settings Dropdown

The settings dropdown (⚙ in the header) controls display preferences. All settings are persisted to `localStorage`.

**Tree View Settings:**

| Setting | Default | Effect |
|---------|---------|--------|
| **Reference position** | End | Where back-references appear: End, First, or Inline |
| **Show IDs** | Off | Display raw `_id` columns in table and tree views |
| **Show Cycles** ↻ | Off | Show cycle markers in tree views (instead of hiding cycled nodes) |
| **Show empty FK** | Off | Show FK fields with NULL values as empty lines in tree views |
| **Show System Attributes** | Off | Show `_created_at`, `_updated_at`, `_version` columns |

**Show empty FK** is useful for Detail Views where you want to see all FK fields regardless of whether they have a value — it makes the tree structure consistent even for incomplete records.

**Breadcrumb Display:**

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

### Hierarchical Entities and Lineage

Entities with a **self-referencing foreign key** (e.g., `parent_type` pointing to the same entity) form a hierarchy. The framework supports these hierarchies in several ways:

**Hierarchy View:** The Entity Explorer provides a tree-view toggle for hierarchical entities (detected via `selfRefFK` in the schema). Records where the self-ref FK is NULL are root nodes; children are loaded on expand.

**Lineage Endpoint:** For any record in a hierarchical entity, the lineage API returns the ancestor chain — the record's own ID plus all parent IDs up to the root:

```
GET /api/entities/EngineType/47/lineage
→ { "ids": [47, 15, 3] }   // self → parent → grandparent
```

This is used by **view context filtering** (see below) to automatically expand filters across the hierarchy. For non-hierarchical entities, it returns just the single ID.

### View Context Filtering in Processes

Process steps can reference views with a **context key** that filters the view based on accumulated process context:

```markdown
View: Stand Tracking(EngineType)
```

**Syntax:** `View: ViewName(ContextKey)` — the context key names an entity type whose value was selected in a previous step.

**How filtering works:**

1. The process panel reads `viewContext: "EngineType"` from the step definition
2. It passes the context (e.g., `{ EngineType: "CFM56-5B4/3", _ids: { EngineType: 47 } }`) to the Entity Explorer
3. The explorer fetches the view schema and finds the column whose `fkEntity` matches the context key
4. It calls the **lineage endpoint** to get the ancestor chain: `[47, 15, 3]`
5. If the lineage has multiple IDs (hierarchical entity), it builds an **IN-filter** on the FK ID column: `_fk_Engine Type:47,15,3`
6. If only one ID (flat entity), it uses a simple **exact-match** filter on the label: `=Engine Type:CFM56-5B4/3`

This means a stand typed as "CFM56" (a parent type) will correctly appear when filtering for the specific subtype "CFM56-5B4/3", because the lineage includes all ancestors.

**Non-hierarchical example:** `View: Fleet Overview(Operator)` — filters the view to show only records matching the selected operator (exact match, no lineage expansion).
