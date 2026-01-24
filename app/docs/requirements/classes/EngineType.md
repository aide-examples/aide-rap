# EngineType

Specific engine models (e.g., CFM56-5B, PW1100G).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| designation | string | Type designation [LABEL] | CFM56-5B4 |
| name | string | Full name [LABEL2] | CFM56-5B4/3 |
| manufacturer | EngineOEM | Reference | 1 |
| super_type | EngineType | Parent type in hierarchy (e.g., CFM56 for CFM56-5B4) | null |
| thrust_lbs | int | Thrust in pounds | 27000 |

## Data Generator

List the most popular engine types of the engine manufacturers mentioned.
