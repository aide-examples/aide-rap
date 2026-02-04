# Shared Utilities Registry

**WICHTIG:** Diese Datei vor dem Schreiben von neuem Code konsultieren!

---

## String/Name Utilities

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `toSnakeCase(str)` | SchemaGenerator.js | PascalCase → snake_case |
| `toSqlName(viewName)` | UserViewGenerator.js | View-Name → SQL-safe |
| `titleCase(str)` | UserViewGenerator.js | snake_case → Title Case |

---

## Schema & Type Utilities

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `TypeRegistry.resolve(name)` | shared/types/TypeRegistry.js | Typ-Definition auflösen |
| `TypeRegistry.isAggregate(name)` | shared/types/TypeRegistry.js | Prüfen ob Aggregate-Typ |
| `TypeRegistry.getAggregateFields(name)` | shared/types/TypeRegistry.js | Aggregate-Felder holen |
| `TypeRegistry.getSqlType(name)` | shared/types/TypeRegistry.js | JS-Typ → SQL-Typ |
| `filterColumnsForDiagram(columns)` | server/utils/DiagramUtils.js | System-Spalten filtern, Aggregates kollabieren |

**Built-in Aggregate Types:** `geo`, `address`, `contact`

---

## FK & Path Resolution

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `findFKColumn(entity, name)` | UserViewGenerator.js | FK-Spalte finden (3 Patterns: displayName, name, name_id) |
| `resolveColumnPath(path, base, schema)` | UserViewGenerator.js | Dot-Notation FK-Kette auflösen |
| `resolveBackRefPath(path, base, schema)` | UserViewGenerator.js | Back-Reference auflösen |

---

## Validation

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `ObjectValidator.validate(type, obj)` | shared/validation/ObjectValidator.js | Objekt validieren |
| `ObjectValidator.validateField(type, field, value)` | shared/validation/ObjectValidator.js | Einzelnes Feld validieren |
| `ValidationError` | shared/validation/ValidationError.js | Strukturierter Validierungsfehler |

---

## Logging & Events

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `logger.info/error/warn/debug()` | server/utils/logger.js | Zentrales Logging |
| `EventBus.emit/on/off()` | server/utils/EventBus.js | Pub/Sub Events |

---

## Markdown Parsing

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `extractSection(content, name)` | instruction-parser.js | Markdown-Sektion extrahieren |
| `updateSection(content, name, new)` | instruction-parser.js | Markdown-Sektion aktualisieren |
| `parseEntityFile(content)` | SchemaGenerator.js | Entity-Markdown parsen |
| `parseGlobalTypes(path)` | shared/types/TypeParser.js | Types.md parsen |

---

## Import/Seed

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `SeedManager.resolveConceptualFKs()` | SeedManager.js | "type": "A320neo" → type_id |
| `SeedManager.flattenAggregates()` | SeedManager.js | Nested aggregates → flat columns |
| `ImportManager.applyTransform()` | ImportManager.js | date/number/trim Transforms |

---

## Vollständige Modul-Übersicht

| Modul | Pfad | Verantwortung |
|-------|------|---------------|
| **TypeRegistry** | shared/types/ | Typ-Definitionen (built-in + custom) |
| **TypeParser** | shared/types/ | Types.md parsen |
| **ObjectValidator** | shared/validation/ | Regel-basierte Validierung |
| **ValidationError** | shared/validation/ | Strukturierte Fehler |
| **SchemaGenerator** | server/utils/ | Schema aus Markdown generieren |
| **UserViewGenerator** | server/utils/ | User Views generieren |
| **DiagramUtils** | server/utils/ | Diagram-Hilfsfunktionen |
| **FilterParser** | server/utils/ | Filter → SQL WHERE |
| **SeedManager** | server/utils/ | Seed-Daten Lifecycle |
| **ImportManager** | server/utils/ | XLSX Import Pipeline |
| **EventBus** | server/utils/ | Pub/Sub System |
| **logger** | server/utils/ | Winston Logging |
| **instruction-parser** | server/utils/ | Markdown-Sektionen |
| **mermaid-parser** | server/utils/ | Mermaid ER parsen |
| **UISpecLoader** | server/utils/ | Crud.md/Views.md laden |

---

## Anti-Patterns (NICHT machen!)

| Statt dessen | Verwende |
|--------------|----------|
| `str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()` | `toSnakeCase(str)` aus SchemaGenerator |
| `columns.find(c => c.foreignKey && (c.displayName === x \|\| c.name === x \|\| c.name === x + '_id'))` | `findFKColumn(entity, x)` aus UserViewGenerator |
| System-Spalten manuell filtern | `filterColumnsForDiagram(columns)` aus DiagramUtils |
| Eigene Typ-Prüfung für aggregates | `TypeRegistry.isAggregate(name)` |
