# MeterType

[LABEL=concat(manufacturer, ' ', name)]

Meter product type from a manufacturer.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| manufacturer | MeterManufacturer | Reference to manufacturer [UK1] | 1 |
| name | string | Product model name [UK1] | S450 |
| description | string [OPTIONAL] | Technical description | 3-phase smart meter |

## Data Generator

For each MeterManufacturer, create 2-3 meter types with realistic product names (e.g., Siemens: S450, PAC3200; Landis+Gyr: E350, E450).
