# Finding

Discrepancy or defect discovered during task execution, requiring disposition.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 9001 |
| task_id | int | Reference to Task | 8001 |
| finding_number | string | Finding number | F-2024-0042 |
| description | string | Finding description | Crack in HPT blade |
| severity | string | Severity level | Major |
| status | string | Finding status | Open |
| reported_date | date | Date reported | 2024-03-15 |
| resolved_date | date | Date resolved | null |
