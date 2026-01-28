# Data Model

![Data Model Diagram](/docs-assets/requirements/DataModel-diagram.svg)

## Entity Descriptions

Entity definitions are stored in separate files under [classes/](classes/).

### Metering
<div style="background-color: #D6E4F0; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Meter](classes/Meter.md) | Metering device at a location |
| [Reading](classes/Reading.md) | Meter reading value |
</div>

### Static Data
<div style="background-color: #D9EAD3; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Building](classes/Building.md) | Building location |
| [ResourceType](classes/ResourceType.md) | Type of resource (water, gas, electricity) |
</div>

## Class Diagram

![Data Model Diagram (Detailed)](/docs-assets/requirements/DataModel-diagram-detailed.svg)

<a href="/layout-editor?doc=DataModel" target="_blank"><button type="button">Edit Layout</button></a>

---

*Model generated with [Model Builder](/#model-builder). See [Design Brief](../design.md) for original requirements.*
