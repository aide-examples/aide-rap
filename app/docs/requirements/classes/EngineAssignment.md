# EngineAssignment

Tracks which engine is installed on which aircraft at which position over time.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key | 5001 |
| engine_id | int | Reference to Engine | 2001 |
| aircraft_id | int | Reference to Aircraft | 1001 |
| position | int | Engine position (1, 2, 3, 4) | 1 |
| installed_date | date | Installation date | 2020-06-01 |
| removed_date | date | Removal date (null if current) | null |
