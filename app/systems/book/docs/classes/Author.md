# Author

A book author with biographical and contact information.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| first_name | string | Given name [LABEL] [UK1] | Gabriel |
| last_name | string | Family name [LABEL2] [UK1] | Garcia Marquez |
| birth_date | date | Date of birth | 1927-03-06 |
| death_date | date [OPTIONAL] | Date of death | 2014-04-17 |
| home_country | string | Country of residence | Colombia |
| email | mail [OPTIONAL] | Contact email address | gabriel@example.com |
| homepage | url [OPTIONAL] | Author website or blog | https://example.com/gabriel |
| is_active | bool | Currently writing and publishing | true |
| residence | address | Current or last known address | 06600 Mexico City |
| contact_info | contact | Contact details | garcia@lit.com (+52 55 1234) |
| bio | json [OPTIONAL] | Structured biographical data | {"awards": ["Nobel Prize"]} |

## Constraints

TimeRange(birth_date, death_date)

## Data Generator

Create 5 authors: mix of living and deceased, varied countries, realistic dates. Include email and homepage for living authors. Provide address and contact info. Bio JSON should contain awards and notable_works arrays.
