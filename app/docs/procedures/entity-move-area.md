# Procedure: Move Entity to Different Area

> Reusable guide for moving an entity from one area to another.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
OLD_AREA    = <Old Area>         # Current area heading (e.g., "Engine Management")
NEW_AREA    = <New Area>         # Target area heading (e.g., "Operations")
```

---

## Step 1: Update DataModel.md

In `app/systems/<system>/docs/DataModel.md`:

1. Remove the entity row from the OLD_AREA table
2. Add it to the NEW_AREA table

```markdown
### NEW_AREA
<div style="background-color: #...;">

| Entity | Description |
|--------|-------------|
| ... existing entities ... |
| ENTITY_NAME | Description text |
</div>
```

---

## Step 2: Update Crud.md

In `app/systems/<system>/docs/Crud.md`:

1. Remove the `- ENTITY_NAME` line from the OLD_AREA section
2. Add it to the NEW_AREA section

```markdown
## NEW_AREA

- ... existing entities ...
- ENTITY_NAME
```

**Important:** Both files must be updated together. If only DataModel.md is changed, the entity appears in the CRUD menu under both the old area (from Crud.md) and the new area (from DataModel.md), causing duplicate entries.

---

## Step 3: Restart Server (Optional)

A server restart picks up the new area assignment. No schema rebuild is triggered because area changes don't affect the database structure (no column/type/constraint changes).

---

## Step 4: Verification

- [ ] Entity appears in the correct area in the CRUD menu
- [ ] Entity does NOT appear in the old area
- [ ] Entity color matches the new area
- [ ] No duplicate entries in the menu

---

## Notes

### No Schema Migration Needed

Moving an entity between areas is purely a UI grouping change. The database table, columns, and constraints remain identical. The schema hash does not change, so no table rebuild occurs.

### Area Colors

Each area has a background color defined in DataModel.md. The entity inherits the color of its area for UI elements (table headers, tree nodes, menu items).

### Views

If the entity appears in views (either as base or in columns), those views are unaffected by area changes.
