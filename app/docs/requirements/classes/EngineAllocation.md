# EngineAllocation

Tracks responsibility for an engine during a time period. Exactly one of aircraft, airline, or event must be set.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| start_date | date | Allocation start [LABEL2] | 2024-01-15 |
| end_date | date | Allocation end (null if current) | null |
| aircraft | Aircraft | If mounted on aircraft | 1 |
| mount_position | int | Wing position (1-4), required if aircraft set | 1 |
| airline | Airline | If under airline CAMO responsibility | null |
| engine | Engine | Allocated engine [LABEL] | 1 |
| event | EngineEvent | If in maintenance event | null |

## Data Generator

Create allocation records showing engines moving between aircraft mounts, airline custody, and maintenance events.
