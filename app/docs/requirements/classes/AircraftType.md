# AircraftType

Specific aircraft models (e.g., A320-200, B737-800, E190).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| designation | string | Type designation [LABEL] | A320-200 |
| name | string | Full name [LABEL2] | Airbus A320-200 |
| manufacturer | AircraftManufacturer | Reference | 1 |
| max_passengers | int | Maximum passenger capacity | 180 |
| max_range_nm | int | Maximum range in nautical miles | 3300 |
| number_of_engines | int [DEFAULT=2] | Number of engines (2 or 4) | 2 |

## Data Generator

Look at web resources describing the fleet of each Lufthansa subsidiary. Find out which exact types of aircraft are known to be used by at least one of the Lufthansa Group subsidiaries. Exclude Bombardier and Embraer. List all aircaft types.
