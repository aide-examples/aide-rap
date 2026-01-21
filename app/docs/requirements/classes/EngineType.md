# EngineType

Specific engine models (e.g., CFM56-5B, PW1100G).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 10 |
| designation | string | Type designation [LABEL] | CFM56-5B4 |
| name | string | Full name [LABEL2] | CFM56-5B4/3 |
| manufacturer_id | int | Reference to EngineManufacturer [DETAIL] | 1 |
| thrust_lbs | int | Thrust in pounds | 27000 |
