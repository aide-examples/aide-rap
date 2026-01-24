# WetLease

Wet lease agreement between an airline and an operator. The operator provides aircraft with crew to fly under the airline's brand.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| airline | Airline | Marketing airline [LABEL] | 1 |
| operator | Operator | Operating carrier [LABEL2] | 2 |
| start_date | date | Lease start date | 2024-01-01 |
| end_date | date | Lease end date (null if ongoing) | 2024-12-31 |

## Data Generator

Create wet lease agreements for Lufthansa Group (e.g., Eurowings Discover operated by Eurowings).
