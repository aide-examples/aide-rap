# AircraftType

Specific aircraft models (e.g., A320-200, B737-800, E190).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 5 |
| designation | string | Type designation [LABEL] | A320-200 |
| name | string | Full name [LABEL2] | Airbus A320-200 |
| manufacturer_id | int | Reference to AircraftManufacturer [DETAIL] | 1 |
| max_passengers | int | Maximum passenger capacity | 180 |
| max_range_nm | int | Maximum range in nautical miles | 3300 |

## Data Generator

All types of aircraft which are known to be used by at least one of the Lufthansa Group subsidiaries. Exclude Bombardier and Embraer.
