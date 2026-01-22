# Engine

Individual engine identified by serial number.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Engine serial number [LABEL] | ESN 738456 |
| type | EngineType | Reference | 10 |
| current_aircraft | Aircraft | [READONLY] [DAILY=EngineMount[removed_date=null OR removed_date>TODAY].aircraft] | 1001 |
| manufacture_date | date | Date of manufacture [LABEL2] | 2014-08-20 |
| total_flight_hours | int | Accumulated flight hours | 32000 |
| total_cycles | int | Accumulated cycles | 15000 |

## Data Generator

Generate 6 engines per each engine type you find in the list below: Use realisitic data for toal cacles and flight hours.
