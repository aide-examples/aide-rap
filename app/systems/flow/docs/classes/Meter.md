# Meter

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| serial_number | string | Unique hardware ID [LABEL] [UK1] | Example |
| location_description | string | Where the meter is located (e.g. Basement) | Example |
| installation_date | date | Date installed | 2024-01-15 |
| is_active | bool | Status of the meter [DEFAULT=true] | true |
| building | Building | Reference to Building | 1 |
| resource_type | ResourceType | Reference to ResourceType | 1 |

## Data Generator

Generate a metering device for each combination of building and ResourceType in the attached list. Use realistic identifiers
