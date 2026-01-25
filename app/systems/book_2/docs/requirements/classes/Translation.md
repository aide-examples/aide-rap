# Translation

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| translated_title | string | Translated title [LABEL] | Example |
| translated_subtitle | string | Translated subtitle | Example |
| translation_year | int | Year translated | 42 |
| translator_notes | text | Translator notes | Lorem ipsum... |
| is_abridged | bool | Abridged version [DEFAULT=false] | true |
| is_authorized | bool | Authorized translation [DEFAULT=true] | true |
| book | Book | Reference to Book | 1 |
| target_language | Language | Reference to Language | 1 |
| translator | Translator | Reference to Translator | 1 |

## Data Generator

Create 8-10 translations (e.g., "book": "One Hundred Years of Solitude", "target_language": "English", "translator": "#1")
