# Registration

Assignment of an aircraft to an operator with entry and exit dates.
An aircraft can move between operators over time (e.g., wet lease, operator change).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| operator | Operator | Reference | 1 |
| aircraft | Aircraft | Reference | 1001 |
| entry_date | date | Date aircraft joined operator [LABEL2] | 2020-01-15 |
| exit_date | date | Date aircraft left operator (null if active) | null |

## Data Generator

You see a list of operators belonging to Lufthansa Group. And you see a list of aircraft associated with one of the operators. We want to create a record for each combination of aircraft and operator telling us when the aircraft entered the fleet . The exit_date must be open for those records. Furthermore create a handful of additional records which show that some aircraft had EARLIER been part of a different operator's fleet before they entered the fleet of their current operator.  All entry and exit dates should be logical, leaving a gap of two months between exit from the first fleet and entry into the current fleet in thos cases where you generate the additional record. Generally, all dates should be between 2013 an 2025.
