# Types

Project-wide type definitions for the Book system.

## Pattern Types

### ISBNCode

ISBN-13 format (e.g., 978-3-16-148410-0)

| Pattern | Example |
|---------|---------|
| `^\d{3}-\d{1,5}-\d{1,7}-\d{1,7}-\d$` | 978-3-16-148410-0 |

## Enum Types

### BookGenre

Literary genre classification.

| Internal | External | Description |
|----------|----------|-------------|
| FIC | Fiction | Novels, short stories |
| NF | Non-Fiction | Factual works |
| SF | Science Fiction | Speculative science-based fiction |
| FAN | Fantasy | Magical or supernatural fiction |
| BIO | Biography | Life stories |
| HIS | History | Historical works |
| SCI | Science | Scientific publications |
| PHI | Philosophy | Philosophical works |

### BindingType

Physical format of a book.

| Internal | External | Description |
|----------|----------|-------------|
| HC | Hardcover | Hardcover binding |
| PB | Paperback | Paperback binding |
| EB | Ebook | Digital format |

### BookCondition

Physical condition of a book copy.

| Internal | External | Description |
|----------|----------|-------------|
| 1 | New | Unused, mint condition |
| 2 | Good | Minor wear, fully readable |
| 3 | Fair | Noticeable wear, complete |
| 4 | Poor | Significant damage or missing pages |
