# BookAuthor

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| author_order | int | Order of authorship [LABEL2] [DEFAULT=1] | 42 |
| contribution_type | string | Type: Author, Co-author, Contributor [LABEL] [DEFAULT=Author] | Example |
| book | Book | Reference to Book | 1 |
| author | Author | Reference to Author | 1 |

## Data Generator

Link authors to books; multi-author books have 2-3 authors with author_order specified (e.g., "book": "One Hundred Years of Solitude", "author": "García Márquez")
