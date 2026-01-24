# EngineStand

Assembled engine transport stand combining a base and a cradle. Used for engines not mounted on aircraft.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| designation | string | Stand identifier [LABEL] | Stand-A1 |
| base | EngineStandBase | Wheeled base frame | 1 |
| cradle | EngineStandCradle | Engine-specific cradle | 1 |
| engine_type | EngineType | Compatible engine type (includes subtypes) [LABEL2] | 1 |
| location | string | Current location | Hangar 3 |

## Data Generator

Create combinations of bases and cradles representing assembled engine stands at various locations.
