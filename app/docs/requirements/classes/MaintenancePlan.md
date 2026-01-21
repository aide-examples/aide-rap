# MaintenancePlan

OEM-defined maintenance program for an engine type. Contains the scheduled maintenance tasks.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 50 |
| engine_type_id | int | Reference to EngineType | 10 |
| name | string | Plan name | CFM56-5B MPD Rev 72 |
| revision | string | Revision number | 72 |
| effective_date | date | Date plan becomes effective | 2023-01-01 |
