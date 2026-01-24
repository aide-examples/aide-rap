# EngineEvent

Maintenance event for an engine (shop visit, overhaul, etc.). Details to be defined later.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| designation | string | Event identifier [LABEL] | SV-2024-001 |
| event_type | string | Type of event [LABEL2] | Shop Visit |
| start_date | date | Event start date | 2024-01-15 |
| end_date | date | Event end date (null if ongoing) | null |

## Data Generator

Create sample maintenance events like shop visits, overhauls, and inspections.
