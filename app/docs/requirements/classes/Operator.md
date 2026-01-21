# Operator

Airlines or aircraft operators (e.g., Lufthansa, Delta).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| id | int | Primary key [READONLY] | 1 |
| name | string | Operator name [LABEL] | Lufthansa |
| icao_code | [ICAOCode](../Types.md#icaocode) | ICAO code [LABEL2] | DLH |
| iata_code | [IATACode](../Types.md#iatacode) | IATA code | LH |
| country | string | Country | Germany |

## Data Generator

All subsidiaries of Lufthansa group.
