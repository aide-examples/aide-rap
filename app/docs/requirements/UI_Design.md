# UI Design Notes

Design decisions, ideas, and future improvements for the IRMA user interface.

## Current Implementation

### View Modes
The entity explorer supports two view modes:
- **Tree View**: Hierarchical display with expandable nodes, FK navigation, and back-references
- **Table View**: Classic spreadsheet-style with sortable columns and zebra striping

### Navigation Patterns
- **FK Links in Tree**: Click on FK field expands inline; click on entity badge navigates to that entity
- **FK Links in Table**: Click on FK value navigates to the referenced entity and selects the record

## Design Ideas / Future Improvements

### FK Navigation in Table View
Currently, clicking an FK link in the table view navigates to the referenced entity and loads ALL records of that type. Alternative approaches to consider:

1. **Detail-Panel Only**: Show the referenced record in the detail panel without switching entities
2. **Filtered View**: Navigate to entity but show only the one referenced record
3. **Popup/Modal**: Open referenced record in an overlay dialog

**Decision**: Keep current behavior for now - full table navigation is consistent with tree view behavior.

### Back-Reference Columns in Table View
**Idea**: Append back-reference columns to the table showing counts of related records.

Example for `AircraftType` table:
| designation | name | manufacturer_id | ... | Aircraft (type_id) | Engine (compatible_types) |
|------------|------|-----------------|-----|--------------------:|-------------------------:|
| A320-200 | Airbus A320-200 | Airbus | ... | 15 | 3 |
| B737-800 | Boeing 737-800 | Boeing | ... | 8 | 2 |

- Column header shows: `EntityName (fk_field_name)`
- Cell shows count of referencing records
- **Click action**: Navigate to that entity with filter `fk_field = current_record.id`
- This effectively shows "which Aircraft use this type?" as a filtered list

**Benefits**:
- Quick overview of how many related records exist
- One-click navigation to filtered results
- Mirrors the back-reference concept from tree view

**Implementation Notes**:
- Requires async loading of counts (similar to FK label loading)
- Filter parameter needs to be passed to entity switch
- Consider caching counts to avoid repeated API calls

### Table View Column Visibility
Consider allowing users to:
- Hide/show specific columns
- Reorder columns via drag-and-drop
- Save column preferences per entity type

### Improved View Mode Icons
Current icons (&#9638; for table, &#9698; for tree) may not be immediately recognizable.

Consider:
- Using actual SVG icons or icon font (e.g., grid icon for table, tree/hierarchy icon for tree)
- Adding text labels on hover or as part of button
- Moving toggle buttons to a more prominent location (e.g., before entity selector)

## Accessibility Considerations

- Ensure keyboard navigation works in both tree and table views
- Add ARIA labels to interactive elements
- Support high-contrast mode
- Consider screen reader compatibility for tree structure

## Performance Considerations

- Lazy loading for large datasets (pagination or virtual scrolling)
- Debounce filter input (already implemented: 300ms)
- Cache schema information (already implemented via SchemaCache)
- Consider IndexedDB for offline capability
