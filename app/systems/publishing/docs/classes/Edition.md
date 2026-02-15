# Edition

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| isbn | string | Edition ISBN [LABEL2] [UK1] | Example |
| edition_name | string | Edition name [LABEL] | Example |
| edition_number | int | Edition number [DEFAULT=1] | 42 |
| publication_date | date | Publication date | 2024-01-15 |
| page_count | int | Page count | 42 |
| format | string | Format: Hardcover, Paperback, eBook | Example |
| cover_type | string | Cover design type | Example |
| print_run | int | Number of copies printed | 42 |
| is_reprint | bool | Is this a reprint [DEFAULT=false] | true |
| reprint_number | int | Reprint number if applicable | 42 |
| is_limited_edition | bool | Limited edition flag [DEFAULT=false] | true |
| is_out_of_print | bool | Out of print status [DEFAULT=false] | true |
| book | Book | Reference to Book | 1 |
| translation | Translation | Reference to Translation | 1 |
| publisher | Publisher | Reference to Publisher | 1 |

## Data Generator

Create 15-20 editions mixing original and translated works; include reprints (is_reprint=true) and limited editions (e.g., "book": "#1", "publisher": "Penguin Random House", "translation": "#3")
