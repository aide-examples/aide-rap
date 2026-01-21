# FleetMember

Assignment of an aircraft to a fleet with entry and exit dates.
An aircraft can move between fleets over time (e.g., wet lease, operator change).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| fleet_id | int | Reference to Fleet [DETAIL] | 1 |
| aircraft_id | int | Reference to Aircraft [DETAIL] | 1001 |
| entry_date | date | Date aircraft joined fleet [LABEL2] | 2020-01-15 |
| exit_date | date | Date aircraft left fleet (null if active) | null |

## Data Generator

Assign each aircraft to a matching fleet based on its type.
If multiple Fleets exist for that type (different operators), distribute aircraft evenly
Set entry_date to a realistic date (2015-2023), exit_date should be null for active assignments
