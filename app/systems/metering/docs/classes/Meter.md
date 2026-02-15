# Meter

[LABEL=concat(type, ' #', serial_number)]

Physical metering device installed at a location.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| type | MeterType | Meter product type | 1 |
| serial_number | string | Hardware serial number [UK1] | 12345678 |
| location_description | string [OPTIONAL] | Where the meter is located (e.g. Basement) | Basement |
| installation_date | date | Date installed | 2024-01-15 |
| is_active | bool | Status of the meter [DEFAULT=true] | true |
| building | Building | Reference to Building | 1 |
| resource_type | ResourceType | Reference to ResourceType | 1 |

## Data Generator

Generate a metering device for each combination of building and ResourceType in the attached list. Assign random MeterTypes. Use realistic 8-digit serial numbers.
