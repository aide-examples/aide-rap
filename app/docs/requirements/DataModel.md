# IRMA Data Model

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

- <a href="/docs-assets/requirements/diagram.svg" target="_blank">Compact Diagram (diagram.svg)</a> - Only class names
- <a href="/docs-assets/requirements/diagram-detailed.svg" target="_blank">Detailed Diagram (diagram-detailed.svg)</a> - With attributes

**Source of Truth:** This Markdown file.

<button onclick="fetch('/api/regenerate-diagrams', {method: 'POST'}).then(r => r.json()).then(d => alert(d.success ? 'Diagrams regenerated!' : 'Error: ' + d.error)).catch(e => alert('Error: ' + e))">🔄 Regenerate Diagrams</button>

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

### AircraftManufacturer
Manufacturers of aircraft types (e.g., Airbus, Boeing, Embraer).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Company name |
| country | string | Country of origin |
| icao_code | string | ICAO identifier |

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

### Engine
Individual engine identified by serial number.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| serial_number | string | Engine serial number |
| type_id | int | Reference to EngineType |
| manufacture_date | date | Date of manufacture |
| total_flight_hours | int | Accumulated flight hours |
| total_cycles | int | Accumulated cycles |

### EngineAssignment
Tracks which engine is installed on which aircraft at which position over time.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| engine_id | int | Reference to Engine |
| aircraft_id | int | Reference to Aircraft |
| position | int | Engine position (1, 2, 3, 4) |
| installed_date | date | Installation date |
| removed_date | date | Removal date (null if current) |

### EngineManufacturer
Manufacturers of engines (e.g., CFM, Pratt & Whitney, Rolls-Royce).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Company name |
| country | string | Country of origin |
| icao_code | string | ICAO identifier |

### EngineType
Specific engine models (e.g., CFM56-5B, PW1100G).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| designation | string | Type designation |
| name | string | Full name |
| manufacturer_id | int | Reference to EngineManufacturer |
| thrust_lbs | int | Thrust in pounds |

### Finding
Discrepancy or defect discovered during task execution, requiring disposition.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| task_id | int | Reference to Task |
| finding_number | string | Finding number |
| description | string | Finding description |
| severity | string | Severity level |
| status | string | Finding status |
| reported_date | date | Date reported |
| resolved_date | date | Date resolved |

### Fleet
Logical grouping of aircraft belonging to an operator.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Fleet name |
| operator_id | int | Reference to Operator |
| aircraft_id | int | Reference to Aircraft |
| base_location | string | Home base |

### InspectionType
Scheduled inspection intervals (e.g., A-Check, C-Check, D-Check) with time/cycle limits.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| code | string | Inspection code |
| name | string | Inspection name |
| description | string | Description |
| interval_hours | int | Interval in flight hours |
| interval_cycles | int | Interval in cycles |
| interval_days | int | Interval in calendar days |
| maintenance_plan_id | int | Reference to MaintenancePlan |

### MaintenancePlan
OEM-defined maintenance program for an engine type. Contains the scheduled maintenance tasks.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| engine_type_id | int | Reference to EngineType |
| name | string | Plan name |
| revision | string | Revision number |
| effective_date | date | Date plan becomes effective |

### MaintenancePlanTask
Individual task defined in the OEM maintenance plan, referencing a TaskType with specific intervals.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| maintenance_plan_id | int | Reference to MaintenancePlan |
| task_type_id | int | Reference to TaskType |
| task_code | string | OEM task code |
| description | string | Task description |
| interval_hours | int | Interval in flight hours |
| interval_cycles | int | Interval in cycles |

### MRO
Maintenance, Repair and Overhaul organization.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | MRO name |
| location | string | Location |
| country | string | Country |

### Operator
Airlines or aircraft operators (e.g., Lufthansa, Delta).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Operator name |
| icao_code | string | ICAO code (e.g., "DLH") |
| iata_code | string | IATA code (e.g., "LH") |
| country | string | Country |

### RepairOrder
MRO's execution document corresponding 1:1 to a Workscope. Contains the actual tasks performed.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| workscope_id | int | Reference to Workscope |
| mro_id | int | Reference to MRO |
| order_number | string | MRO order number |
| status | string | Order status |
| start_date | date | Actual start date |
| end_date | date | Actual end date |

### RepairShop
Specialized workshop within an MRO (e.g., engine shop, avionics shop).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| mro_id | int | Reference to MRO |
| name | string | Shop name |
| specialization | string | Area of specialization |

### Task
Individual maintenance task within a repair order.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| repair_order_id | int | Reference to RepairOrder |
| task_type_id | int | Reference to TaskType |
| task_number | string | Task number |
| description | string | Task description |
| status | string | Task status |

### TaskType
Classification of tasks (e.g., inspection, repair, replacement, modification).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| code | string | Task type code |
| name | string | Task type name |
| description | string | Description |

### Workscope
Planning document defining maintenance work to be performed on an engine. Created by Engine Management.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | int | Primary key |
| name | string | Workscope name |
| description | string | Description |
| engine_id | int | Reference to Engine |
| inspection_type_id | int | Reference to InspectionType |
| planned_start | date | Planned start date |
| planned_end | date | Planned end date |
