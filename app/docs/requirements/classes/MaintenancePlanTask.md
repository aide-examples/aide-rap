# MaintenancePlanTask

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
