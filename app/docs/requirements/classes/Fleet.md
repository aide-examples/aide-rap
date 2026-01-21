# Fleet

Logical grouping of aircraft belonging to an operator.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 100 |
| name | string | Fleet name | A320 Family |
| operator_id | int | Reference to Operator | 1 |
| aircraft_id | int | Reference to Aircraft | 1001 |
| base_location | string | Home base | FRA |
