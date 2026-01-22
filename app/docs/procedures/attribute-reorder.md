# Prozedur: Attribut-Reihenfolge ändern

> Wiederverwendbare Anleitung für das Umordnen von Attributen einer Entity im AIDE-IRMA Projekt.

## Variablen

```
ENTITY_NAME = <EntityName>       # Entity-Name (PascalCase)
```

---

## Hintergrund

Die Attribut-Reihenfolge wird an mehreren Stellen verwendet:

| Quelle | Verwendung |
|--------|------------|
| `classes/ENTITY_NAME.md` (Markdown-Tabelle) | **Source of Truth** - definiert die Reihenfolge |
| `DataModel.yaml` | Schema-Definition (wird beim Start geparst) |
| SchemaGenerator | Erstellt Views mit der Reihenfolge aus dem Schema |
| UI (entity-table.js) | Liest `schema.columns` für Spaltenreihenfolge |

**Wichtig:** SQLite unterstützt kein `ALTER TABLE ... REORDER COLUMNS`. Die physische Spaltenreihenfolge in der Tabelle ändert sich nicht, aber:
- Die **View** wird mit der neuen Reihenfolge erstellt
- Die **UI** zeigt die Spalten in der Schema-Reihenfolge

---

## Schritt 1: Markdown-Tabelle umordnen

In `app/docs/requirements/classes/ENTITY_NAME.md` die Zeilen der Attribut-Tabelle in die gewünschte Reihenfolge bringen.

**Beispiel vorher:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| engine | Engine | Reference [LABEL] | 2001 |
| aircraft | Aircraft | Reference [LABEL2] | 1001 |
| position | int | Engine position | 1 |
```

**Beispiel nachher:**
```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| aircraft | Aircraft | Reference [LABEL2] | 1001 |
| engine | Engine | Reference [LABEL] | 2001 |
| position | int | Engine position | 1 |
```

---

## Schritt 2: DataModel.yaml anpassen

In `app/docs/requirements/DataModel.yaml` die Attribute der Entity in die gleiche Reihenfolge bringen.

**Beispiel:**
```yaml
EngineMount:
  attributes:
    aircraft:        # jetzt zuerst
      type: Aircraft
      ...
    engine:          # jetzt zweites
      type: Engine
      ...
    position:
      type: int
      ...
```

---

## Schritt 3: Server neu starten

```bash
./run -p 18355  # oder User-Port 18354
```

Der Server:
1. Parst das aktualisierte Schema
2. Erstellt die Views mit der neuen Spaltenreihenfolge neu
3. Die UI zeigt die Spalten in der neuen Reihenfolge

---

## Schritt 4: Verifizierung

- [ ] Entity-Tabelle in UI zeigt Spalten in neuer Reihenfolge
- [ ] Tree-View zeigt korrekte Labels
- [ ] CRUD-Operationen funktionieren weiterhin

---

## Hinweise

### Seed-Daten

Falls `app/data/seed_generated/ENTITY_NAME.json` existiert, ist die Reihenfolge der Keys in JSON-Objekten nicht relevant - JSON-Objekte sind per Definition ungeordnet.

### Physische Tabellenstruktur

Die physische Spaltenreihenfolge in SQLite bleibt unverändert. Dies hat keine praktischen Auswirkungen, da:
- Alle Abfragen über Views laufen
- Die UI die Schema-Reihenfolge verwendet
- INSERT-Statements explizite Spaltennamen verwenden

### Computed Fields

Computed Fields (z.B. `[COMPUTED:...]`) können an beliebiger Position stehen - sie werden nicht in der Datenbank gespeichert.

---

## Beispiel: EngineMount (aircraft vor engine)

**Betroffene Dateien:**
1. `app/docs/requirements/classes/EngineMount.md` - Tabellenzeilen tauschen
2. `app/docs/requirements/DataModel.yaml` - Attribut-Reihenfolge anpassen

**Änderung:** `engine, aircraft, position, ...` → `aircraft, engine, position, ...`
