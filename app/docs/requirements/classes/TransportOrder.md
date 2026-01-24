# TransportOrder

Order to transport an engine stand from one location to another.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| stand | EngineStand | Engine stand to transport [LABEL] | 1 |
| from_location | string | Origin location [LABEL2] | Hangar 3 |
| to_location | string | Destination location | MRO Frankfurt |
| requested_date | date | Requested transport date | 2024-02-01 |
| completed_date | date | Actual completion date (null if pending) | null |

## Data Generator

Create transport orders for moving engine stands between hangars, MRO facilities, and storage areas.
