# RepairOrder

MRO's execution document corresponding 1:1 to a Workscope. Contains the actual tasks performed.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| workscope | Workscope | Reference | 6001 |
| mro | MRO | Reference | 1 |
| order_number | string | MRO order number [LABEL] | RO-2024-1234 |
| status | string | Order status | In Progress |
| start_date | date | Actual start date | 2024-03-01 |
| end_date | date | Actual end date | null |
