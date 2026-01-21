# InspectionType

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
