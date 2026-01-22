# Computed Foreign Keys (Berechnete FK-Beziehungen)

Algorithmisch berechnete FK-Beziehungen, die:
- Durch eine **Berechnungsregel** definiert werden
- Als **echte Spalte** in der Tabelle gespeichert werden (redundant/materialisiert)
- **Zeitgesteuert** (CRON) oder **sofort** aktualisiert werden
- READONLY sind (nur lesbar, nicht manuell editierbar)
- Im UI wie normale FKs angezeigt werden

## Motivation

**Beispiel: Aircraft.current_operator_id**
- Finde FleetMember wo `aircraft_id = Aircraft.id` UND `exit_date IS NULL OR exit_date > TODAY`
- Von dort: `operator_id` → Operator
- Es darf nur einen aktiven FleetMember geben

**Wichtig:** Der Wechsel wird oft **vordatiert** eingegeben (exit_date in der Zukunft).
Das bedeutet: Der Update darf NICHT beim Speichern passieren, sondern muss **täglich** ausgeführt werden!

---

## Markdown-Syntax

### Annotation am Ziel-Attribut

Das berechnete Attribut wird **in der Attribut-Tabelle** mit einer Annotation definiert:

```markdown
## Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... | ... | ... | ... |
| current_operator_id | int | Reference to Operator [READONLY] [DAILY=FleetMember[exit_date=null OR exit_date>TODAY].operator] | 5 |
```

### Annotation-Syntax

| Annotation | Bedeutung | Use Case |
|------------|-----------|----------|
| `[DAILY=rule]` | Täglich um Mitternacht neu berechnen (CRON) | Zeitabhängige Regeln (exit_date) |
| `[IMMEDIATE=rule]` | Sofort bei Änderung der Quell-Tabelle | Nicht-zeitabhängige Regeln |
| `[HOURLY=rule]` | Stündlich (CRON) | Zeitkritischere Fälle |
| `[ON_DEMAND=rule]` | Manuell via API/CLI | Selten benötigte Berechnungen |

**Warum am Attribut statt separate Sektion?**
- Das Attribut ist eine echte Spalte → gehört in die Attribut-Tabelle
- `[READONLY]` zeigt: nicht manuell editierbar
- `[DAILY=...]` zeigt: wann und wie berechnet
- Konsistent mit anderen Annotations wie `[DEFAULT=...]`

---

## Regel-Syntax (Rule)

```
FleetMember[exit_date=null OR exit_date>TODAY].operator
│          │                                  └── FK: operator_id → Operator
│          └── Filter: WHERE exit_date IS NULL OR exit_date > CURRENT_DATE
└── Start-Entity: WHERE aircraft_id = self.id (Konvention)
```

### Filter-Syntax

| Syntax | Bedeutung |
|--------|-----------|
| `[field=value]` | Gleichheit (value=null → IS NULL) |
| `[field>value]` | Vergleich |
| `[field<value]` | Vergleich |
| `[cond1 OR cond2]` | Logisches ODER |
| `[cond1 AND cond2]` | Logisches UND |
| `TODAY` | CURRENT_DATE (wird täglich evaluiert) |

### Pfad-Navigation

Nach dem Filter folgt ein Pfad durch FK-Beziehungen:
- `.operator` → navigiert über `operator_id` zur Operator-Entity

Die FK-Spalte wird automatisch aus dem Entity-Namen abgeleitet (`operator` → `operator_id`).

---

## Redundantes Display-Label

Neben der ID kann auch das **Display-Label** des Ziel-Records gespeichert werden:

```markdown
| current_operator_id | int | Reference to Operator [READONLY] [DAILY=...] | 5 |
| current_operator_name | string | Display label [READONLY] [DERIVED=current_operator_id] | Lufthansa |
```

`[DERIVED=column]` bedeutet: Wird automatisch mit der ID aktualisiert.

**Vorteile:**
- Kein JOIN für Anzeige nötig
- Sofortige Lesbarkeit in Queries
- Performance bei Auflistungen

---

## Fehlerbehandlung

| Situation | Verhalten |
|-----------|-----------|
| Kein Treffer (kein aktiver FleetMember) | `current_operator_id = null` |
| Mehrere Treffer (Dateninkonsistenz!) | `current_operator_id = null` + Warning-Log |
| Ziel-Entity gelöscht | FK-Constraint verhindert oder CASCADE |

---

## Beispiel: Ablauf bei vordatiertem Operator-Wechsel

```
Szenario: Aircraft D-AIUA wechselt am 2024-02-01 von Lufthansa zu Eurowings

Tag 1 (2024-01-15): User gibt Wechsel ein
  └── FleetMember für Lufthansa: exit_date = '2024-02-01' (Zukunft!)
  └── FleetMember für Eurowings: entry_date = '2024-02-01'
  └── Aircraft.current_operator_id bleibt Lufthansa (exit_date > TODAY)

Tag 2-16: Keine Änderung
  └── DAILY Job läuft, aber exit_date > TODAY → Lufthansa bleibt

Tag 17 (2024-02-01): CRON Job um 00:05
  └── Für Aircraft D-AIUA:
      └── Query: FleetMember WHERE aircraft_id=1001 AND (exit_date IS NULL OR exit_date > '2024-02-01')
      └── Ergebnis: Eurowings FleetMember (exit_date=null)
      └── UPDATE aircraft SET current_operator_id = (Eurowings ID) WHERE id = 1001

Ergebnis: Aircraft zeigt jetzt Eurowings als current_operator
```

---

## Implementierung (TODO)

Die technische Implementierung umfasst:

1. **SchemaGenerator.js** - Parse-Logik für `[DAILY=...]`, `[IMMEDIATE=...]`
2. **database.js** - Migration für neue Spalten
3. **ComputedRefManager.js** - Neue Service-Klasse für Berechnungs-Engine
4. **CRON Setup** - node-cron für zeitgesteuerte Updates
5. **UI-Integration** - READONLY-Rendering für computed FKs

Status: **Spezifikation abgeschlossen, Implementierung ausstehend**

---

## Vorläufiger Fix: Seed-Generierung

Bis die vollständige Implementierung erfolgt, werden Computed Columns bei der Seed-Generierung ausgeblendet:

- **llm-generator.js**: `isComputedColumn()` filtert Spalten mit `[DAILY=...]` etc. aus dem LLM-Prompt
- **SeedManager.js**: Computed Columns werden beim Laden von Seed-Daten übersprungen

Dies ist ein **temporärer Workaround** basierend auf Regex-Matching der Description.
Nach Implementierung von SchemaGenerator wird das `col.computed` Property verwendet.
