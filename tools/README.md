# RAP Tools

This directory contains tools for managing the data model and diagrams.

## Prerequisites

### draw.io VS Code Extension (optional)

```bash
code --install-extension hediet.vscode-drawio
```

After installation, `.drawio` files can be edited directly in VS Code.

**Alternative:** https://app.diagrams.net (Browser version)

---

## Architecture

**Single Source of Truth:** `DataModel.md`

```
DataModel.md          →  parse-datamodel.js  →  DataModel.yaml
(readable docs)                                  (generated)
     +
layout.drawio         →  extract-layout.js   →  layout.json
(visual layout)                                  (positions)
                                                     ↓
                                            Layout Editor (Browser)
                                                     ↓
                                            diagram.svg / diagram-detailed.svg
```

### Files

| File | Type | Purpose |
|------|------|---------|
| `app/docs/requirements/DataModel.md` | **Source** | Classes, attributes, areas (edit this!) |
| `app/docs/requirements/layout.drawio` | **Source** | Box positions (edit visually) |
| `app/docs/requirements/DataModel.yaml` | Generated | Machine-readable model |
| `app/docs/requirements/layout.json` | Generated | Positions as JSON |
| `app/docs/requirements/diagram.svg` | Generated | Compact diagram |
| `app/docs/requirements/diagram-detailed.svg` | Generated | Diagram with attributes |

---

## Workflows

### 1. Add/Modify a Class

1. **Edit DataModel.md:**

   a) Add class to the Areas table (HTML table at the top)

   b) Add entity description:
   ```markdown
   ### NewClass
   Description of the class.

   | Attribute | Type | Description |
   |-----------|------|-------------|
   | id | int | Primary key |
   | name | string | Name |
   | other_class_id | int | Reference to OtherClass |
   ```

2. **Open Layout Editor:**
   - http://localhost:18354/layout-editor
   - Select document
   - New class is automatically displayed

3. **Adjust position and save:**
   - Position box via drag & drop
   - Click "Save" → SVG diagrams are automatically generated

---

### 2. Add/Modify a Relationship

Relationships are automatically detected from attributes!

1. **In DataModel.md:** Add attribute with entity name as type:
   ```markdown
   | other | OtherClass | Reference to OtherClass |
   ```

2. **Open Layout Editor** → New connection line is automatically drawn

3. **Save** → SVG is updated

---

### 3. Adjust Layout Visually

#### Option A: Layout Editor (recommended)

1. **Open Layout Editor:** http://localhost:18354/layout-editor
2. **Select document**
3. **Move boxes via drag & drop**
4. **Click "Save"** → Saves layout.json + diagram.svg + diagram-detailed.svg

#### Option B: draw.io (for complex layouts)

1. **Open draw.io file:**
   - In VS Code: Open `app/docs/requirements/layout.drawio`
   - Or in browser: https://app.diagrams.net → Open file

2. **Move boxes:**
   - Position classes via drag & drop
   - Save (Ctrl+S)

3. **Extract positions:**
   ```bash
   node tools/extract-layout.js -i app/docs/requirements/layout.drawio
   ```

4. **Open Layout Editor** and click "Save" for SVG generation

---

### 4. Add/Modify an Area (Competence Area)

1. **In DataModel.md:** Edit HTML table "Areas of Competence":
   ```html
   <tr style="background-color: #E0E0E0;">
     <td><strong>New Area</strong></td>
     <td>Class1, Class2, Class3</td>
   </tr>
   ```

2. **Open Layout Editor and save** → Colors are updated

---

## Scripts

### parse-datamodel.js

Parses DataModel.md and generates DataModel.yaml.

```bash
node tools/parse-datamodel.js
```

### extract-layout.js

Reads positions from draw.io file and updates layout.json.

```bash
node tools/extract-layout.js -i app/docs/requirements/layout.drawio
```

### generate-drawio.js

Generates draw.io file from DataModel.yaml + layout.json (for new classes).

```bash
node tools/generate-drawio.js -o app/docs/requirements/layout.drawio
```

---

## Quick Reference

```bash
# From project root:

# After changes in DataModel.md:
# 1. Open Layout Editor: http://localhost:18354/layout-editor
# 2. Select document → Changes are automatically loaded
# 3. Click "Save" → SVG diagrams are generated

# After layout changes in draw.io:
node tools/extract-layout.js -i app/docs/requirements/layout.drawio
# Then open Layout Editor and click "Save"
```
