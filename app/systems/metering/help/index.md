# AIDE RAP [metering] - User Guide

metering your flow of gas, water and electricity

## Entities

### Building
- **name**: Name of the building (display label)
- **address**: Physical address (secondary label)
- **building_type**: Type e.g. Residential, Commercial

### ResourceType
- **name**: e.g. Electricity, Water, Gas (display label)
- **unit_of_measure**: e.g. kWh, m3, liters

### Meter
- **serial_number**: Unique hardware ID (display label)
- **location_description**: Where the meter is located (e.g. Basement)
- **installation_date**: Date installed
- **is_active**: Status of the meter
- **building**: Reference to Building
- **resource_type**: Reference to ResourceType

### Reading
- **value**: The numeric value on the meter (display label)
- **reading_at**: Timestamp of the measurement (secondary label)
- **source**: Manual, Automated, Estimated
- **meter**: Reference to Meter

## Quick Start

1. Create Building, ResourceType records first (no dependencies)
2. Create Meter, Reading records and link to existing records
3. Use the Tree View to explore relationships
