# Workscope

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
