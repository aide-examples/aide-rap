# TranslatorLanguage

| Attribute | Type | Description | Example |
|-----------|------|-------------|----------|
| is_primary | bool | Primary language pair [LABEL] [DEFAULT=false] | true |
| proficiency_level | string | Level: Native, Fluent, Professional [LABEL2] | Example |
| translator | Translator | Reference to Translator | 1 |
| source_language | Language | Reference to Language | 1 |
| target_language | Language | Reference to Language | 1 |

## Data Generator

Create 2-3 language pairs per translator (e.g., "translator": "García", "source_language": "Spanish", "target_language": "English")
