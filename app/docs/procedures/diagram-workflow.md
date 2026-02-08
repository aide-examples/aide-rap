# Procedure: Data Model Diagram Workflow

> Guide for creating and editing data model diagrams using the Layout Editor.

---

## Understanding the Diagram

**Reading the arrows:** Arrows point from a class to its referenced type (read as "is of type" or "references"). The label shows the attribute name on the class where the arrow originates.

**Example:** `ProjectType --client--> Client` means ProjectType has an attribute `client` referencing Client.

**Source of Truth:** The Markdown file (`DataModel.md`) is the source of truth. Diagrams are generated from it.

---

## Workflow: Creating and Editing Diagrams

### Step 1: Edit the Markdown File

Add or modify entity descriptions in your system's `DataModel.md`. Each `### EntityName` section with an attribute table defines a class.

Entity definitions are stored in separate files under `classes/`:

```markdown
# EntityName

Description of the entity.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| name | string | Name field [LABEL] | Example |
```

### Step 2: Open the Layout Editor

Click the "Edit Layout" button in your DataModel.md, or navigate to:

```
/layout-editor?doc=DataModel
```

The editor loads all classes from the document.

### Step 3: Arrange the Diagram

- **Drag** class boxes to position them
- **Toggle** between Compact (names only) and Detailed (with attributes) view
- **Adjust** canvas size if needed (width × height inputs)
- Boxes snap to a 10px grid

### Step 4: Save and Regenerate

1. Click **"Save Layout"** to store positions
2. Click **"Regenerate Diagrams"** to update the SVG files

### Step 5: View Results

Use the Compact/Detailed links in the editor toolbar to see the generated diagrams.

---

## Files Involved

| File | Purpose |
|------|---------|
| `DataModel.md` | Source of truth (entity definitions) |
| `DataModel-layout.json` | Box positions and canvas size |
| `DataModel-layout.drawio` | Draw.io compatible layout file |
| `DataModel-diagram.svg` | Generated compact diagram |
| `DataModel-diagram-detailed.svg` | Generated detailed diagram |

---

## Visual Styling in Diagrams

Attribute markers affect how attributes are displayed:

| Marker | Diagram Effect |
|--------|----------------|
| `[READONLY]` | Text in **red**, FK lines drawn as dotted |
| `[LABEL]` | Text **underlined** (solid) |
| `[LABEL2]` | Text **underlined** (dashed) |
| `[OPTIONAL]` | FK lines drawn as dashed |

See [Attribute Markers Reference](../attribute-markers.md) for complete documentation.

---

## See Also

- [Add Entity](entity-add.md) — Complete checklist for adding entities
- [Attribute Markers](../attribute-markers.md) — All annotation tags
