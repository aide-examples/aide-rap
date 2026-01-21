# Types

Projektweite Typdefinitionen für aide-irma.

## Pattern Types

### TailSign

German aircraft registration (e.g., D-AIUA)

| Pattern | Example |
|---------|---------|
| `^[A-Z]-[A-Z]{4}$` | D-AIUA |

### IATACode

2-letter IATA airline code (e.g., LH)

| Pattern | Example |
|---------|---------|
| `^[A-Z]{2}$` | LH |

### ICAOCode

3-letter ICAO airline code (e.g., DLH)

| Pattern | Example |
|---------|---------|
| `^[A-Z]{3}$` | DLH |

### MSN

Manufacturer Serial Number (e.g., MSN 4711)

| Pattern | Example |
|---------|---------|
| `^MSN \d{4,5}$` | MSN 4711 |

### FlightNumber

Flight number (e.g., LH123)

| Pattern | Example |
|---------|---------|
| `^[A-Z]{2}\d{1,4}$` | LH123 |

### AirportCode

3-letter IATA airport code (e.g., FRA)

| Pattern | Example |
|---------|---------|
| `^[A-Z]{3}$` | FRA |

## Enum Types

### OperationalStatus

| Internal | External | Description |
|----------|----------|-------------|
| 1 | Active | Currently in service |
| 2 | Grounded | Temporarily out of service |
| 3 | Retired | Permanently decommissioned |

### MaintenanceLevel

| Internal | External | Description |
|----------|----------|-------------|
| A | A-Check | Light maintenance (daily/weekly) |
| B | B-Check | Intermediate check (monthly) |
| C | C-Check | Heavy maintenance (yearly) |
| D | D-Check | Major overhaul (multi-year) |
