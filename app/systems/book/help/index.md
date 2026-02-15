# AIDE RAP [book] - User Guide

A minimal model for authors and books

## Entities

### Author
- **first_name**: Given name (display label)
- **last_name**: Family name (secondary label)
- **home_country**: Country of residence
- **year_of_birth**: Year of birth

### Book
- **isbn**: International Standard Book Number (secondary label)
- **title**: Book title (display label)
- **publishing_year**: Year of publication
- **author**: Author reference (FK to Author)

## Quick Start

1. Create Author, Book records first (no dependencies)
2. Use the Tree View to explore relationships
