# Data Model MINI

## Areas of Competence

<table>
  <tr>
    <th>Area</th>
    <th>Classes</th>
  </tr>
  <tr style="background-color: #D6E4F0;">
    <td><strong>OEM</strong></td>
    <td>AircraftManufacturer, AircraftType, EngineManufacturer, EngineType, MaintenancePlan, MaintenancePlanTask</td>
  </tr>
  <tr style="background-color: #D9EAD3;">
    <td><strong>Operations</strong></td>
    <td>Operator, Fleet, Aircraft</td>
  </tr>
  <tr style="background-color: #FCE5CD;">
    <td><strong>Engine Management</strong></td>
    <td>Engine, EngineAssignment, Workscope, InspectionType</td>
  </tr>
  <tr style="background-color: #E6D9F2;">
    <td><strong>Maintenance &amp; Repair</strong></td>
    <td>MRO, RepairShop, RepairOrder, Task, TaskType, Finding</td>
  </tr>
</table>

## Class Diagram

**Reading the diagram:** Arrows point from a class to its referenced type (read as "is of type" or "references"). The label shows the attribute name on the class where the arrow originates. Example: `AircraftType --manufacturer--> AircraftManufacturer` means AircraftType has an attribute `manufacturer` referencing AircraftManufacturer.

### Generated SVG Diagrams

- <a href="/docs-assets/requirements/MiniModel-diagram.svg" target="_blank">Compact Diagram</a> - Only class names
- <a href="/docs-assets/requirements/MiniModel-diagram-detailed.svg" target="_blank">Detailed Diagram</a> - With attributes

**Source of Truth:** This Markdown file.

<a href="/layout-editor?doc=MiniModel" target="_blank"><button type="button">📐 Edit Layout</button></a>

## Entity Descriptions

### Aircraft
Individual aircraft identified by registration and serial number.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| registration | string | Aircraft registration (e.g., "D-AIUA") |
| serial_number | string | Manufacturer serial number |
| type_id | int | Reference to AircraftType |
| manufacture_datex | date | Date of manufacture |
| total_flight_hours | int | Accumulated flight hours |
| total_cycles | int | Accumulated cycles |

### AircraftType
Specific aircraft models (e.g., A320-200, B737-800, E190).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| designation | string | Type designation (e.g., "A320-200") |
| name | string | Full name |
| manufacturer_id | int | Reference to AircraftManufacturer |
| max_passengers | int | Maximum passenger capacity |
| max_range_nm | int | Maximum range in nautical miles |

### AircraftManufacturer
Manufacturers of aircraft types (e.g., Airbus, Boeing, Embraer).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Company name |
| country | string | Country of origin |
| icao_code | string | ICAO identifier |

