# Data Model

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

## Entity Descriptions

### Aircraft
Individual aircraft identified by registration and serial number.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1001 |
| registration | string | Aircraft registration [LABEL] | D-AIUA |
| serial_number | string | Manufacturer serial number [LABEL2] | MSN 4711 |
| type_id | int | Reference to AircraftType | 5 |
| manufacture_date | date | Date of manufacture | 2015-03-15 |
| total_flight_hours | int | Accumulated flight hours [HOVER] | 45230 |
| total_cycles | int | Accumulated cycles [HOVER] | 18500 |

### AircraftManufacturer
Manufacturers of aircraft types (e.g., Airbus, Boeing, Embraer).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | Company name [LABEL] | Airbus |
| country | string | Country of origin [LABEL2] | France |
| icao_code | string | ICAO identifier [HOVER] | AIB |

### AircraftType
Specific aircraft models (e.g., A320-200, B737-800, E190).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 5 |
| designation | string | Type designation [LABEL] | A320-200 |
| name | string | Full name [LABEL2] | Airbus A320-200 |
| manufacturer_id | int | Reference to AircraftManufacturer | 1 |
| max_passengers | int | Maximum passenger capacity [HOVER] | 180 |
| max_range_nm | int | Maximum range in nautical miles [HOVER] | 3300 |

### Engine
Individual engine identified by serial number.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 2001 |
| serial_number | string | Engine serial number [LABEL] | ESN 738456 |
| type_id | int | Reference to EngineType | 10 |
| manufacture_date | date | Date of manufacture [LABEL2] | 2014-08-20 |
| total_flight_hours | int | Accumulated flight hours [HOVER] | 32000 |
| total_cycles | int | Accumulated cycles [HOVER] | 15000 |

### EngineAssignment
Tracks which engine is installed on which aircraft at which position over time.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 5001 |
| engine_id | int | Reference to Engine | 2001 |
| aircraft_id | int | Reference to Aircraft | 1001 |
| position | int | Engine position (1, 2, 3, 4) | 1 |
| installed_date | date | Installation date | 2020-06-01 |
| removed_date | date | Removal date (null if current) | null |

### EngineManufacturer
Manufacturers of engines (e.g., CFM, Pratt & Whitney, Rolls-Royce).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | Company name [LABEL] | CFM International |
| country | string | Country of origin [LABEL2] | USA/France |
| icao_code | string | ICAO identifier [HOVER] | CFM |

### EngineType
Specific engine models (e.g., CFM56-5B, PW1100G).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 10 |
| designation | string | Type designation [LABEL] | CFM56-5B4 |
| name | string | Full name [LABEL2] | CFM56-5B4/3 |
| manufacturer_id | int | Reference to EngineManufacturer | 1 |
| thrust_lbs | int | Thrust in pounds [HOVER] | 27000 |

### Finding
Discrepancy or defect discovered during task execution, requiring disposition.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 9001 |
| task_id | int | Reference to Task | 8001 |
| finding_number | string | Finding number | F-2024-0042 |
| description | string | Finding description | Crack in HPT blade |
| severity | string | Severity level | Major |
| status | string | Finding status | Open |
| reported_date | date | Date reported | 2024-03-15 |
| resolved_date | date | Date resolved | null |

### Fleet
Logical grouping of aircraft belonging to an operator.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 100 |
| name | string | Fleet name | A320 Family |
| operator_id | int | Reference to Operator | 1 |
| aircraft_id | int | Reference to Aircraft | 1001 |
| base_location | string | Home base | FRA |

### InspectionType
Scheduled inspection intervals (e.g., A-Check, C-Check, D-Check) with time/cycle limits.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 20 |
| code | string | Inspection code | C-CHK |
| name | string | Inspection name | C-Check |
| description | string | Description | Heavy maintenance check |
| interval_hours | int | Interval in flight hours | 7500 |
| interval_cycles | int | Interval in cycles | 4000 |
| interval_days | int | Interval in calendar days | 730 |
| maintenance_plan_id | int | Reference to MaintenancePlan | 50 |

### MaintenancePlan
OEM-defined maintenance program for an engine type. Contains the scheduled maintenance tasks.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 50 |
| engine_type_id | int | Reference to EngineType | 10 |
| name | string | Plan name | CFM56-5B MPD Rev 72 |
| revision | string | Revision number | 72 |
| effective_date | date | Date plan becomes effective | 2023-01-01 |

### MaintenancePlanTask
Individual task defined in the OEM maintenance plan, referencing a TaskType with specific intervals.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 500 |
| maintenance_plan_id | int | Reference to MaintenancePlan | 50 |
| task_type_id | int | Reference to TaskType | 3 |
| task_code | string | OEM task code | 72-00-00-200-001 |
| description | string | Task description | Borescope inspection HPT |
| interval_hours | int | Interval in flight hours | 3000 |
| interval_cycles | int | Interval in cycles | 1500 |

### MRO
Maintenance, Repair and Overhaul organization.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | MRO name [LABEL] | Lufthansa Technik |
| location | string | Location [LABEL2] | Hamburg |
| country | string | Country [HOVER] | Germany |

### Operator
Airlines or aircraft operators (e.g., Lufthansa, Delta).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | Operator name [LABEL] | Lufthansa |
| icao_code | string | ICAO code [LABEL2] | DLH |
| iata_code | string | IATA code [HOVER] | LH |
| country | string | Country [HOVER] | Germany |

### RepairOrder
MRO's execution document corresponding 1:1 to a Workscope. Contains the actual tasks performed.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 7001 |
| workscope_id | int | Reference to Workscope | 6001 |
| mro_id | int | Reference to MRO | 1 |
| order_number | string | MRO order number | RO-2024-1234 |
| status | string | Order status | In Progress |
| start_date | date | Actual start date | 2024-03-01 |
| end_date | date | Actual end date | null |

### RepairShop
Specialized workshop within an MRO (e.g., engine shop, avionics shop).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 101 |
| mro_id | int | Reference to MRO | 1 |
| name | string | Shop name | Engine Shop 1 |
| specialization | string | Area of specialization | CFM56 Overhaul |

### Task
Individual maintenance task within a repair order.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 8001 |
| repair_order_id | int | Reference to RepairOrder | 7001 |
| task_type_id | int | Reference to TaskType | 3 |
| task_number | string | Task number | T-001 |
| description | string | Task description | HPT Borescope |
| status | string | Task status | Completed |

### TaskType
Classification of tasks (e.g., inspection, repair, replacement, modification).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 3 |
| code | string | Task type code | INSP |
| name | string | Task type name | Inspection |
| description | string | Description | Visual or instrumental inspection |

### Workscope
Planning document defining maintenance work to be performed on an engine. Created by Engine Management.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 6001 |
| name | string | Workscope name | WS-2024-ESN738456 |
| description | string | Description | C-Check Workscope |
| engine_id | int | Reference to Engine | 2001 |
| inspection_type_id | int | Reference to InspectionType | 20 |
| planned_start | date | Planned start date | 2024-03-01 |
| planned_end | date | Planned end date | 2024-04-15 |
