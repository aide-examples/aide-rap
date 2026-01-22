# InspectionType

Scheduled inspection intervals (e.g., A-Check, C-Check, D-Check) with time/cycle limits.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| code | string | Inspection code [LABEL] | C-CHK |
| name | string | Inspection name [LABEL2] | C-Check |
| description | string | Description | Heavy maintenance check |
| interval_hours | int | Interval in flight hours | 7500 |
| interval_cycles | int | Interval in cycles | 4000 |
| interval_days | int | Interval in calendar days | 730 |
| maintenance_plan | MaintenancePlan | Reference | 50 |
