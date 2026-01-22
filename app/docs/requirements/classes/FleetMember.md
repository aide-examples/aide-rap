# FleetMember

Assignment of an aircraft to an operator with entry and exit dates.
An aircraft can move between operators over time (e.g., wet lease, operator change).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| operator | Operator | Reference | 1 |
| aircraft | Aircraft | Reference | 1001 |
| entry_date | date | Date aircraft joined operator [LABEL2] | 2020-01-15 |
| exit_date | date | Date aircraft left operator (null if active) | null |

## Data Generator

You see a list of operators belonging to Lufthansa Group. And you see a list of aircraft. Find web resources about the aircraft types each of the operators is using. Ignore aircraft types which are not in the list given. Then assign each aircraft arbitrarily to an operator known to operate aircraft of that type. Entry dates should be between 2015 and 2025. exit_date should be null/empty in the vast majority of cases. If there is an exit_date it must be larger than the entry_date.
