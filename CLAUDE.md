# Claude Code Projektkontext

## Server-Ports

Der User und Claude nutzen separate Ports für die Entwicklung:

| Wer    | Port  | Kommando         |
|--------|-------|------------------|
| User   | 18354 | `./run` (Default)|
| Claude | 18355 | `./run -p 18355` |

**Workflow:**
- User hat seinen Server auf Port 18354 laufen
- Wenn Claude sagt "Server-Neustart erforderlich", startet der User seinen Server neu
- Claude testet bei Bedarf auf Port 18355

## Projektstruktur

- `app/` - Hauptapplikation
  - `server/` - Node.js Backend
  - `shared/` - Isomorpher Code (Browser + Node.js)
  - `static/irma/` - Frontend
  - `docs/requirements/` - Markdown-Dokumentation und Typdefinitionen
- `tools/` - Build- und Generierungsskripte
- `aide-frame/` - Framework (Submodule)

## Type-System

Custom Types werden in `app/docs/requirements/Types.md` definiert:
- **Pattern Types**: Regex-Validierung (z.B. TailSign, ICAOCode)
- **Enum Types**: Internal/External Mapping (z.B. OperationalStatus)

Entity-lokale Typen können in der Entity-Markdown-Datei unter `## Types` definiert werden.

Relevante Dateien:
- `app/shared/types/TypeRegistry.js` - Type-Management
- `app/shared/types/TypeParser.js` - Markdown-Parsing
- `app/shared/validation/ObjectValidator.js` - Validierung (shared)
- `app/server/utils/SchemaGenerator.js` - Schema-Generierung
