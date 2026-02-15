# Design Brief

This is a comprehensive example system that serves as a testbed for all built-in types and constraints.

**Entities:**
- **Publisher** — name, founding year, website (url), headquarters (address)
- **Author** — name, birth/death dates (TimeRange constraint), country, email (mail), homepage (url), active flag (bool), residence (address), contact (contact), bio (json)
- **Book** — title, ISBN (pattern type), publication date, price (number with MIN), page count (int with MIN), availability (bool), genre/binding/condition (enum types), author/publisher (FK references), storage location (geo), metadata (json)

**Types covered:** string, int, number, date, bool, url, mail, json, geo, address, contact, pattern (ISBNCode), enum (BookGenre, BindingType, BookCondition)

**Constraints:**
- TimeRange(birth_date, death_date) on Author
- Custom JS with lookup() on Book: premium hardcover books (> 50 EUR) require an established publisher (founded before 2000)

**Validation features demonstrated:**
- [MIN=x], [MAX=x] — numeric range
- [UNIQUE] — single-column uniqueness
- [UK1] — composite unique key
- [OPTIONAL] — nullable fields
- [DEFAULT=x] — default values
- Pattern validation (ISBNCode regex)
- Enum validation (genre, binding, condition)
- Cross-field constraints (TimeRange, custom JS with lookup)
- Multilingual error messages (en/de)
