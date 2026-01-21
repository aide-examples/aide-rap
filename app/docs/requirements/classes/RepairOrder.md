# RepairOrder

MRO's execution document corresponding 1:1 to a Workscope. Contains the actual tasks performed.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 7001 |
| workscope_id | int | Reference to Workscope | 6001 |
| mro_id | int | Reference to MRO | 1 |
| order_number | string | MRO order number | RO-2024-1234 |
| status | string | Order status | In Progress |
| start_date | date | Actual start date | 2024-03-01 |
| end_date | date | Actual end date | null |
