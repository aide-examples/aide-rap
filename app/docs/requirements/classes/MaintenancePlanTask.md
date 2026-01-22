# MaintenancePlanTask

Individual task defined in the OEM maintenance plan, referencing a TaskType with specific intervals.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| maintenance_plan | MaintenancePlan | Reference | 50 |
| task_type | TaskType | Reference | 3 |
| task_code | string | OEM task code [LABEL] | 72-00-00-200-001 |
| description | string | Task description | Borescope inspection HPT |
| interval_hours | int | Interval in flight hours | 3000 |
| interval_cycles | int | Interval in cycles | 1500 |
