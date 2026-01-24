# Airline

Customer-facing brand (e.g., Lufthansa, Swiss). Often identical to the Operator, but can be separate (e.g., Eurowings Discover operated by Eurowings).

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| name | string | Airline brand name [LABEL] | Lufthansa |
| iata_code | IATACode | IATA code [LABEL2] | LH |
| icao_code | ICAOCode | ICAO code | DLH |
| country | string | Country of registration | Germany |
| own_operator | Operator | Own operator (if airline operates itself) | 1 |
| camo | CAMO | Responsible CAMO for airworthiness | 1 |

## Data Generator

Create Lufthansa Group airlines: Lufthansa, Swiss, Austrian, Brussels Airlines, Eurowings.
