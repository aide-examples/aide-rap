# Book

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| original_isbn | string | Original ISBN [LABEL2] [UK1] | Example |
| title | string | Original title [LABEL] | Example |
| subtitle | string | Subtitle | Example |
| publication_year | int | Year first published | 42 |
| synopsis | text | Book synopsis | Lorem ipsum... |
| genre | string | Primary genre | Example |
| original_page_count | int | Original page count | 42 |
| has_multiple_authors | bool | Multiple authors flag [DEFAULT=false] | true |
| original_language | Language | Reference to Language | 1 |
| editor | Editor | Reference to Editor | 1 |

## Data Generator

Create 6 books with varied genres; 2 should have has_multiple_authors=true with editor assigned
