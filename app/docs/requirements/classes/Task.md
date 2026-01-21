# Task

Individual maintenance task within a repair order.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 8001 |
| repair_order_id | int | Reference to RepairOrder | 7001 |
| task_type_id | int | Reference to TaskType | 3 |
| task_number | string | Task number | T-001 |
| description | string | Task description | HPT Borescope |
| status | string | Task status | Completed |
