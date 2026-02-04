# Procedure: Add Entity

> Reusable guide for adding a new entity to an AIDE RAP project.

## Variables

```
ENTITY_NAME = <EntityName>       # Entity name (PascalCase)
SYSTEM      = <system>           # System name (e.g., irma)
AREA        = <AreaName>         # Area in DataModel.md (e.g., "Engine Management")
```

---

## Step 1: Create Entity Markdown File

Create `app/systems/SYSTEM/docs/classes/ENTITY_NAME.md`:

```markdown
# ENTITY_NAME

Brief description of the entity.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| name | string | Name field [LABEL] | Example |
| description | string [OPTIONAL] | Details [LABEL2] | |

## Data Generator

Instructions for generating seed data.
```

### Common Attribute Types

| Type | Description |
|------|-------------|
| `string` | Text field |
| `int` | Integer |
| `number` | Decimal |
| `bool` | Boolean |
| `date` | Date |
| `datetime` | Date and time |
| `EntityName` | Foreign key reference |
| `media [OPTIONAL]` | File/image upload |

### Common Markers

| Marker | Meaning |
|--------|---------|
| `[LABEL]` | Primary display label |
| `[LABEL2]` | Secondary display label |
| `[OPTIONAL]` | Nullable field |
| `[READONLY]` | Not editable in UI |
| `[UNIQUE]` | Unique constraint |

---

## Step 2: Add to DataModel.md

In `app/systems/SYSTEM/docs/DataModel.md`, add the entity to the appropriate area table:

```markdown
### AREA
<div style="background-color: #FCE5CD; padding: 10px;">

| Entity | Description |
|--------|-------------|
| ... existing entities ... |
| ENTITY_NAME | Brief description |
</div>
```

---

## Step 3: Add to Crud.md

In `app/systems/SYSTEM/docs/ui/Crud.md`, add the entity to the appropriate section:

```markdown
## AREA

- ... existing entities ...
- ENTITY_NAME
```

**Important:** Without this step, the entity will NOT appear in the Layout Editor or Admin UI!

---

## Step 4: Remove from Types.md (if converting enum)

If converting an existing enum type to an entity, remove the enum definition from `app/systems/SYSTEM/docs/Types.md`.

The type name in other entities remains the same — it will now be interpreted as a foreign key instead of an enum.

---

## Step 5: Restart Server

```bash
./run -s SYSTEM
```

The SchemaGenerator will:
1. Detect the new entity from the markdown file
2. Create the database table with all columns
3. Create the view with label resolution
4. Update DataModel.yaml

---

## Step 6: Position in Layout Editor

1. Open `/layout-editor?doc=DataModel`
2. Drag the new entity box to the desired position
3. Click "Save Layout" to store positions
4. Click "Regenerate Diagrams" to update SVG files

---

## Step 7: Generate Seed Data (Optional)

In Admin UI, use the Seed Manager:
1. Navigate to the entity
2. Click "Generate Seed Data"
3. Review and apply

Or create manually: `app/systems/SYSTEM/data/seed/ENTITY_NAME.json`

---

## Step 8: Verification

- [ ] Server starts without errors
- [ ] Entity appears in Layout Editor
- [ ] Entity appears in Admin UI navigation
- [ ] Table shows correct columns
- [ ] FK dropdowns work (if entity has references)
- [ ] Entities referencing this one show correct FK dropdowns

---

## Example: Converting EngineStandType enum to entity

**Step 1 - Create entity file:**
`app/systems/irma/docs/classes/EngineStandType.md`

```markdown
# EngineStandType

Engine stand type/model specification with manufacturer details.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| part_number | string | Part number [LABEL] | PW-1100-STD |
| name | string | Model name [LABEL2] | PW-1100 Engine Stand |
| manufacturer | string | Stand manufacturer | Dedienne Aerospace |
| image | media [OPTIONAL] | Photo of stand type | |
| description | string [OPTIONAL] | Additional details | |

## Data Generator

Create 3-5 engine stand types from manufacturers like Dedienne Aerospace, MTU.
```

**Step 2 - Add to DataModel.md (Engine Management area):**
```markdown
| EngineStandType | Engine stand type with manufacturer |
```

**Step 3 - Add to Crud.md:**
```markdown
## Engine Management
- EngineStandType
```

**Step 4 - Remove enum from Types.md**

**Result:** `EngineStand.type` and `EngineStandBase.stand_type` now reference the new entity instead of the enum.

---

## Notes

### Order of Operations

The order matters:
1. Entity file first (defines the schema)
2. DataModel.md (for documentation)
3. Crud.md (for UI visibility)
4. Types.md cleanup (if converting enum)
5. Server restart (applies changes)
6. Layout positioning (cosmetic)

### Foreign Key References

If the new entity is referenced by existing entities, those FK columns will be created automatically. Existing data will have NULL values until populated.

### DataModel.yaml

This file is auto-generated from the markdown files — never edit it manually.
