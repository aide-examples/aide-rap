# Seed Generation & Completion

AI-assisted seed data creation via copy/paste workflow.

## Features

| Feature | Purpose | Entity.md Section |
|---------|---------|-------------------|
| **Generate** | Create new records from scratch | `## Data Generator` |
| **Complete** | Fill missing attributes in existing records | `## Data Completer` |

## Workflow (identical for both)

1. **Right-click entity** in Seed Manager
2. Select "🤖 Generate..." or "✨ Complete..."
3. **Tab 1: Instruction** — Write or edit the instruction
4. **"Save to MD"** — Saves instruction to Entity.md (creates section if missing)
5. **"Build AI Prompt"** — Generates prompt with schema, FK data, context
6. **Copy prompt** to AI (ChatGPT, Claude, etc.)
7. **Tab 2: Paste** — Paste AI response (JSON or CSV)
8. **"Parse & Validate"** — Validates FK references, types, conflicts
9. **Tab 3: Result** — Review data, select conflict mode
10. **"Save & Load"** — Writes to seed file and loads into DB

## Entity.md Sections

```markdown
# Aircraft

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| registration | string | [LABEL] | D-AIBL |
| type | AircraftType | Reference | 1 |
| total_flight_hours | int | | null |

## Data Generator

Create 20 aircraft for Lufthansa Group airlines.
Use realistic registrations (D-AIxx for Lufthansa, OE-xxx for Austrian, etc.)

## Data Completer

Fill [total_flight_hours] with realistic values based on manufacture_date.
Older aircraft = more hours (~3000h/year typical).
```

## Key Differences

| Aspect | Generate | Complete |
|--------|----------|----------|
| Input | Schema + instruction | Schema + instruction + **existing records** |
| Output | New records (no IDs) | Updated records (IDs preserved) |
| Prompt | "Generate test data..." | "Complete missing data..." |
| Use case | Empty tables | Partial data |

## API Endpoints

```
GET  /api/entity/:name/generator-instruction
PUT  /api/entity/:name/generator-instruction
GET  /api/entity/:name/completer-instruction
PUT  /api/entity/:name/completer-instruction
POST /api/seed/prompt/:entity
POST /api/seed/complete-prompt/:entity
POST /api/seed/parse/:entity
```
