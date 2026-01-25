# Book - User Guide

A simple library data model demonstration.

## Entities

### Author
- **first_name**: Author's first name
- **last_name**: Author's last name (used as display label)
- **birth_date**: Date of birth

### Book
- **isbn**: International Standard Book Number (display label)
- **title**: Book title
- **publication_year**: Year the book was published
- **genre**: Literary genre (e.g., Fiction, Non-Fiction, Mystery)
- **author**: Reference to the author

## Quick Start

1. Create an Author record first
2. Create a Book and select the Author from the dropdown
3. Use the Tree View to see Books grouped by Author
