# Book

A book with bibliographic details, pricing, and classification.

## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| title | string | Book title [LABEL] | One Hundred Years of Solitude |
| isbn | [ISBNCode](../Types.md#isbncode) | ISBN-13 number [LABEL2] [UNIQUE] | 978-3-16-148410-0 |
| publication_date | date | Date of publication | 1967-06-05 |
| price | number [MIN=0] | Retail price in EUR | 24.99 |
| page_count | int [MIN=1] | Number of pages | 417 |
| is_available | bool | Currently in stock | true |
| genre | [BookGenre](../Types.md#bookgenre) | Literary genre | Fiction |
| binding | [BindingType](../Types.md#bindingtype) | Physical format | Hardcover |
| condition | [BookCondition](../Types.md#bookcondition) [DEFAULT=New] | Physical condition | New |
| author | Author | Reference to the author | 1 |
| publisher | Publisher | Reference to the publisher | 1 |
| storage_location | geo [OPTIONAL] | Warehouse GPS coordinates | 48.1371, 11.5754 |
| metadata | json [OPTIONAL] | Additional structured data | {"edition": 3, "language": "es"} |

## Constraints

```js
if (obj.binding === 'HC' && obj.price > 50) {
  const pub = lookup('Publisher', obj.publisher_id);
  if (pub && pub.founded_year >= 2000) {
    error(['publisher_id', 'binding', 'price'], 'PREMIUM_PUBLISHER');
  }
}
```

## Error Messages

| Code | en | de |
|------|----|----|
| PREMIUM_PUBLISHER | Premium hardcover books (> 50 EUR) require an established publisher (founded before 2000) | Premium-Hardcover (> 50 EUR) erfordert einen etablierten Verlag (gegründet vor 2000) |

## Data Generator

Create 2-3 books per author with unique ISBNs in valid ISBN-13 format, varied genres, bindings, and realistic prices. Include storage locations for some books and metadata with edition and language.
