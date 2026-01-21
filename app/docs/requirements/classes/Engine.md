# Engine

Individual engine identified by serial number.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 2001 |
| serial_number | string | Engine serial number [LABEL] | ESN 738456 |
| type_id | int | Reference to EngineType [DETAIL] | 10 |
| manufacture_date | date | Date of manufacture [LABEL2] | 2014-08-20 |
| total_flight_hours | int | Accumulated flight hours | 32000 |
| total_cycles | int | Accumulated cycles | 15000 |
