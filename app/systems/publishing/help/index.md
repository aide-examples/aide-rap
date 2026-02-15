# AIDE RAP [publishing] - User Guide

Authoring, translating and publishing books

## Entities

### Country
- **iso_code**: ISO 3166-1 alpha-2 code
- **name**: Country name (display label)
- **region**: Geographic region

### Language
- **iso_code**: ISO 639-1 code
- **name**: Language name (display label)
- **is_active**: Currently supported

### Publisher
- **name**: Publisher name (display label)
- **city**: City of headquarters
- **founded_year**: Year established
- **website**: Company website URL
- **email**: Contact email
- **is_active**: Currently operating
- **country**: Reference to Country

### Author
- **first_name**: First name
- **last_name**: Last name (display label)
- **pen_name**: Pen name if used (secondary label)
- **birth_date**: Date of birth
- **death_date**: Date of death if applicable
- **biography**: Short biography
- **website**: Author website URL
- **email**: Contact email
- **nationality**: Reference to Country

### Editor
- **first_name**: First name
- **last_name**: Last name (display label)
- **email**: Email address
- **specialization**: Area of expertise
- **hire_date**: Date hired
- **is_freelance**: Freelance editor
- **is_active**: Currently active
- **country**: Reference to Country

### Translator
- **first_name**: First name
- **last_name**: Last name (display label)
- **email**: Email address
- **biography**: Short biography
- **is_certified**: Certified translator
- **years_experience**: Years of experience
- **is_active**: Currently active
- **nationality**: Reference to Country

### Book
- **original_isbn**: Original ISBN (secondary label)
- **title**: Original title (display label)
- **subtitle**: Subtitle
- **publication_year**: Year first published
- **synopsis**: Book synopsis
- **genre**: Primary genre
- **original_page_count**: Original page count
- **has_multiple_authors**: Multiple authors flag
- **original_language**: Reference to Language
- **editor**: Reference to Editor

### BookAuthor
- **author_order**: Order of authorship (secondary label)
- **contribution_type**: Type: Author, Co-author, Contributor (display label)
- **book**: Reference to Book
- **author**: Reference to Author

### TranslatorLanguage
- **is_primary**: Primary language pair (display label)
- **proficiency_level**: Level: Native, Fluent, Professional (secondary label)
- **translator**: Reference to Translator
- **source_language**: Reference to Language
- **target_language**: Reference to Language

### Translation
- **translated_title**: Translated title (display label)
- **translated_subtitle**: Translated subtitle
- **translation_year**: Year translated
- **translator_notes**: Translator notes
- **is_abridged**: Abridged version
- **is_authorized**: Authorized translation
- **book**: Reference to Book
- **target_language**: Reference to Language
- **translator**: Reference to Translator

### Edition
- **isbn**: Edition ISBN (secondary label)
- **edition_name**: Edition name (display label)
- **edition_number**: Edition number
- **publication_date**: Publication date
- **page_count**: Page count
- **format**: Format: Hardcover, Paperback, eBook
- **cover_type**: Cover design type
- **print_run**: Number of copies printed
- **is_reprint**: Is this a reprint
- **reprint_number**: Reprint number if applicable
- **is_limited_edition**: Limited edition flag
- **is_out_of_print**: Out of print status
- **book**: Reference to Book
- **translation**: Reference to Translation
- **publisher**: Reference to Publisher

## Quick Start

1. Create Country, Language records first (no dependencies)
2. Create Publisher, Author, Editor, Translator, Book, BookAuthor, TranslatorLanguage, Translation, Edition records and link to existing records
3. Use the Tree View to explore relationships
