# Aircraft

Individual aircraft identified by registration and serial number.

## Types

### MaintenanceCategory

| Internal | External | Description |
|----------|----------|-------------|
| A | Line | Line maintenance (quick checks) |
| B | Base | Base maintenance (hangar required) |
| C | Heavy | Heavy maintenance (extended downtime) |

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1001 |
| registration | [TailSign](../Types.md#tailsign) | Aircraft registration [LABEL] | D-AIUA |
| serial_number | [MSN](../Types.md#msn) | Manufacturer serial number [LABEL2] | MSN 4711 |
| type_id | int | Reference to AircraftType [DETAIL] | 5 |
| manufacture_date | date | Date of manufacture | 2015-03-15 |
| total_flight_hours | int | Accumulated flight hours | 45230 |
| total_cycles | int | Accumulated cycles | 18500 |
| status | [OperationalStatus](../Types.md#operationalstatus) | Operational status | 1 |
| maintenance_category | MaintenanceCategory [DEFAULT=Line] | Current maintenance category | B |
| current_operator_id | int | Reference to Operator [READONLY] [DAILY=FleetMember[exit_date=null OR exit_date>TODAY].fleet.operator] | 5 |

## Data Generator

Generate 3 aircraft per AircraftType listed in the references.
Use realistic German registrations (D-AXXX pattern) and MSN numbers.
Manufacture dates should be between 2015 and 2023.
