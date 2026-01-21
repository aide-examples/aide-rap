# Finding

Discrepancy or defect discovered during task execution, requiring disposition.

## Types

### FindingSeverity

| Internal | External | Description |
|----------|----------|-------------|
| 1 | Minor | Minor defect, no immediate action |
| 2 | Major | Significant defect, action required |
| 3 | Critical | Safety-critical, immediate action |

### FindingStatus

| Internal | External | Description |
|----------|----------|-------------|
| 1 | Open | Finding reported, not addressed |
| 2 | In Review | Under evaluation |
| 3 | Deferred | Action postponed |
| 4 | Resolved | Finding addressed |
| 5 | Closed | Verified and closed |

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 9001 |
| task_id | int | Reference to Task | 8001 |
| finding_number | string | Finding number [LABEL] | F-2024-0042 |
| description | string | Finding description [LABEL2] | Crack in HPT blade |
| severity | FindingSeverity | Severity level [DETAIL] | 2 |
| status | FindingStatus | Finding status [DETAIL] | 1 |
| reported_date | date | Date reported | 2024-03-15 |
| resolved_date | date | Date resolved | null |
