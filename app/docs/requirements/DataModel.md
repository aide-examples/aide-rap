# Data Model

## Entity Descriptions

Entity definitions are stored in separate files under [classes/](classes/).

### OEM
<div style="background-color: #D6E4F0; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [AircraftManufacturer](classes/AircraftManufacturer.md) | Manufacturers of aircraft types |
| [AircraftType](classes/AircraftType.md) | Specific aircraft models |
| [EngineManufacturer](classes/EngineManufacturer.md) | Manufacturers of engines |
| [EngineType](classes/EngineType.md) | Specific engine models |
| [MaintenancePlan](classes/MaintenancePlan.md) | OEM-defined maintenance program |
| [MaintenancePlanTask](classes/MaintenancePlanTask.md) | Task in maintenance plan |
</div>

### Operations
<div style="background-color: #D9EAD3; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Operator](classes/Operator.md) | Airlines or aircraft operators |
| [Fleet](classes/Fleet.md) | Operator's fleet of a specific aircraft type |
| [FleetMember](classes/FleetMember.md) | Aircraft assignment to fleet with dates |
| [Aircraft](classes/Aircraft.md) | Individual aircraft |
</div>

### Engine Management
<div style="background-color: #FCE5CD; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Engine](classes/Engine.md) | Individual engine |
| [EngineAssignment](classes/EngineAssignment.md) | Engine-aircraft assignment history |
| [Workscope](classes/Workscope.md) | Maintenance planning document |
| [InspectionType](classes/InspectionType.md) | Scheduled inspection intervals |
</div>

### Maintenance & Repair
<div style="background-color: #E6D9F2; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [MRO](classes/MRO.md) | Maintenance organization |
| [RepairShop](classes/RepairShop.md) | Specialized workshop |
| [RepairOrder](classes/RepairOrder.md) | MRO execution document |
| [Task](classes/Task.md) | Individual maintenance task |
| [TaskType](classes/TaskType.md) | Task classification |
| [Finding](classes/Finding.md) | Discrepancy or defect |
</div>

## Class Diagram

**Reading the diagram:** Arrows point from a class to its referenced type (read as "is of type" or "references"). The label shows the attribute name on the class where the arrow originates. Example: `AircraftType --manufacturer--> AircraftManufacturer` means AircraftType has an attribute `manufacturer` referencing AircraftManufacturer.

### Generated SVG Diagrams

- <a href="/docs-assets/requirements/DataModel-diagram.svg" target="_blank">Compact Diagram</a> - Only class names
- <a href="/docs-assets/requirements/DataModel-diagram-detailed.svg" target="_blank">Detailed Diagram</a> - With attributes

**Source of Truth:** This Markdown file.

<a href="/layout-editor?doc=DataModel" target="_blank"><button type="button">📐 Edit Layout</button></a>

### Workflow: Creating and Editing Data Model Diagrams

1. **Edit this Markdown file** - Add/modify entity descriptions in the tables below. Each `### EntityName` section with an attribute table defines a class.

2. **Open the Layout Editor** - Click the "Edit Layout" button above. The editor loads all classes from this document.

3. **Arrange the diagram**:
   - Drag class boxes to position them
   - Toggle between Compact (names only) and Detailed (with attributes) view
   - Adjust canvas size if needed (width × height inputs)
   - Boxes snap to a 10px grid

4. **Save and regenerate** - Click "Save Layout" to store positions, then "Regenerate Diagrams" to update the SVG files.

5. **View results** - Use the Compact/Detailed links in the editor toolbar to see the generated diagrams.

**Files involved:**
- `DataModel.md` - Source of truth (entity definitions)
- `DataModel-layout.json` - Box positions and canvas size
- `DataModel-layout.drawio` - Draw.io compatible layout file
- `DataModel-diagram.svg` - Generated compact diagram
- `DataModel-diagram-detailed.svg` - Generated detailed diagram

## Attribute Annotations

Attribute descriptions can include special tags in square brackets `[TAG]` to control database constraints and UI behavior.

### Database Constraints

| Tag | Description | SQL Effect |
|-----|-------------|------------|
| `[UNIQUE]` | Single field uniqueness constraint | `UNIQUE` constraint on column |
| `[UK1]`, `[UK2]`, ... | Composite unique key | Fields with same UKn form a composite unique constraint |
| `[INDEX]` | Single field index | Creates index on column |
| `[IX1]`, `[IX2]`, ... | Composite index | Fields with same IXn form a composite index |

### Type Annotations

Type annotations are placed in the **Type column** after the type name.

| Tag | Description | Effect |
|-----|-------------|--------|
| `[DEFAULT=x]` | Explicit default value | Used for migration (ALTER TABLE) and NEW forms |

**Hierarchical Default System:**

1. **Explicit default** `[DEFAULT=x]` - highest priority
2. **Type-specific default** - Enum: first value, Pattern: example from Types.md
3. **Built-in type default** - `int`: 0, `string`: '', `date`: CURRENT_DATE, `boolean`: false

**When to use `[DEFAULT=x]`:**

Only specify `[DEFAULT=x]` if you need a value **different** from the automatic type default. For example:
- An enum field where the default should NOT be the first value
- A string field that should have a specific non-empty default

**For Enum types, use the EXTERNAL representation:**

```
| maintenance_category | MaintenanceCategory [DEFAULT=Line] | Current category | B |
| status | FindingStatus [DEFAULT=Open] | Finding status | 2 |
```

The external value (e.g., "Line", "Open") is automatically mapped to the internal value (e.g., "A", 1) during processing. This makes the markdown more readable.

### UI Display Annotations

| Tag | Description | Tree View Behavior |
|-----|-------------|-------------------|
| `[LABEL]` | Primary display label | Used as node title, **always visible** in expanded view |
| `[LABEL2]` | Secondary display label | Used as node subtitle, **always visible** in expanded view |
| `[DETAIL]` | Basic view field | **Always visible** when node is expanded ("Grundansicht") |
| `[READONLY]` | Non-editable field | Displayed but cannot be modified in forms |
| `[HIDDEN]` | Never displayed | Field exists in DB but not shown in UI |

**Visibility Logic:**
- Fields marked with `[LABEL]`, `[LABEL2]`, or `[DETAIL]` are always visible when a tree node is expanded
- All other fields are **hover-only** - they appear only when the cursor hovers over the node
- `[HIDDEN]` fields are never displayed in the UI

**Example:**
```
| name | string | Company name [LABEL] | Airbus |
| country | string | Country [LABEL2] | France |
| type_id | int | Reference to AircraftType [DETAIL] | 5 |
| internal_code | string | Internal system code | ABC123 |
```
In this example: `name` and `country` are always visible (and used as title/subtitle), `type_id` is always visible (basic view), and `internal_code` only appears on hover.
