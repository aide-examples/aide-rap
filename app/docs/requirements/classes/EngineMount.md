# EngineMount

Tracks which engine is installed on which aircraft at which position over time.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| engine | Engine | Reference [LABEL] | 2001 |
| aircraft | Aircraft | Reference [LABEL2] | 1001 |
| position | int | Engine position (1, 2, 3, 4) | 1 |
| installed_date | date | Installation date | 2020-06-01 |
| removed_date | date | Removal date (null if current) | null |

## Seed Context
- EngineMountPossible: aircraft_type_label, engine_type_label
- AircraftType: designation, number_of_engines

## Data Generator

Generate EngineMount records assigning each Engine to a compatible Aircraft.

IMPORTANT RULES:
1. **Check compatibility**: An engine type may only be mounted on an aircraft type if that combination exists in EngineMountPossible (Seed Context). For each Engine, check its type and find Aircraft whose type appears as a valid pair in EngineMountPossible.

2. **Respect engine count**: The position must be between 1 and number_of_engines (from AircraftType in Seed Context). Most aircraft have 2 engines (position 1 or 2), some 4-engine aircraft have positions 1-4.

3. **Current installations**: Each Engine should have exactly one active mount (removed_date = null).

4. **Realistic dates**: installed_date should be between 2015 and 2024. Engines can be older than their current installation (engines get swapped between aircraft).
