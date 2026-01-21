# Fleet

A fleet represents the collection of aircraft of a specific type operated by an operator.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | Fleet name [LABEL] [READONLY] | DLH-A320 |
| operator_id | int | Reference to Operator [DETAIL] | 1 |
| type_id | int | Reference to AircraftType [DETAIL] | 5 |
| base_location | string | Home base airport [LABEL2] | FRA |

## Naming Convention

The fleet name follows the pattern `{Operator.icao_code}-{AircraftType.designation}`.

## Data Generator

Create fleets ONLY for operators and aircraft types listed in the available references.
For each operator, check which aircraft types they actually operate (use your knowledge).
Set name = "{Operator.icao_code}-{AircraftType.designation}" using the label from the references.
