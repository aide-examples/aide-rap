# Prozedur: Attribut hinzufügen

> Wiederverwendbare Anleitung für das Hinzufügen eines neuen Attributs zu einer bestehenden Entity.

## Variablen

```
ENTITY_NAME = <EntityName>       # Entity-Name (PascalCase)
ATTR_NAME   = <attribute_name>   # Attributname (snake_case)
ATTR_TYPE   = <type>             # Datentyp (string, int, date, bool, oder FK-Entity)
```

---

## Schritt 1: Attribut in Markdown-Tabelle hinzufügen

In `app/docs/requirements/classes/ENTITY_NAME.md` eine neue Zeile zur Attribut-Tabelle hinzufügen:

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... bestehende Attribute ... |
| ATTR_NAME | ATTR_TYPE | Beschreibung [MARKER] | Beispielwert |
```

### Optionale Marker

| Marker | Bedeutung | Beispiel |
|--------|-----------|----------|
| `[DEFAULT=x]` | Standardwert für neue/bestehende Zeilen | `[DEFAULT=100]` |
| `[LABEL]` | Primäres Label für TreeView | |
| `[LABEL2]` | Sekundäres Label | |
| `[READONLY]` | Nicht editierbar in UI | |
| `[HIDDEN]` | Nicht in UI angezeigt | |
| `[UK1]` | Teil eines Unique Keys | |

**Beispiel mit Default:**
```markdown
| severity_factor | int | Effect of flight profile on degradation in % [DEFAULT=100] | 90 |
```

---

## Schritt 2: DataModel.yaml aktualisieren

In `app/docs/requirements/DataModel.yaml` das neue Attribut zur Entity hinzufügen:

```yaml
ENTITY_NAME:
  attributes:
    # ... bestehende Attribute ...
    - name: ATTR_NAME
      type: ATTR_TYPE
      description: Beschreibung [MARKER]
```

**Hinweis:** Die Reihenfolge in der YAML sollte der Markdown-Tabelle entsprechen.

---

## Schritt 3: Server neu starten

```bash
./run -p 18355  # oder User-Port 18354
```

Der SchemaGenerator:
1. Erkennt das neue Attribut im Schema
2. Führt `ALTER TABLE ... ADD COLUMN` aus
3. Setzt den DEFAULT-Wert (falls angegeben) für neue Zeilen
4. Erstellt die View mit der neuen Spalte neu

---

## Schritt 4: Bestehende Daten aktualisieren (optional)

Falls ein `[DEFAULT=x]` angegeben wurde, haben bestehende Zeilen zunächst `NULL`. Um den Default nachträglich zu setzen:

```sql
UPDATE ENTITY_TABLE SET ATTR_NAME = DEFAULT_VALUE WHERE ATTR_NAME IS NULL;
```

**Beispiel:**
```sql
UPDATE engine SET severity_factor = 100 WHERE severity_factor IS NULL;
```

---

## Schritt 5: Verifizierung

- [ ] Server startet ohne Fehler
- [ ] Neues Attribut erscheint in der Entity-Tabelle (UI)
- [ ] Neues Attribut ist editierbar (falls nicht READONLY)
- [ ] Default-Wert wird bei neuen Datensätzen gesetzt
- [ ] Bestehende Datensätze haben korrekten Wert (nach UPDATE)

---

## Hinweise

### Foreign Key Attribute

Wenn das neue Attribut eine Referenz auf eine andere Entity ist:

```markdown
| operator | Operator | Reference to operator [LABEL2] | 5 |
```

Der SchemaGenerator erstellt automatisch:
- Die FK-Spalte (`operator_id INTEGER`)
- Den Foreign Key Constraint
- Die View mit Label-Auflösung (`operator_label`)

### Computed Fields

Computed Fields werden nicht in der Datenbank gespeichert:

```markdown
| current_aircraft | Aircraft | [READONLY] [DAILY=EngineMount[removed_date=null].aircraft] | 1001 |
```

Diese benötigen keinen `ALTER TABLE` - sie werden zur Laufzeit berechnet.

### Seed-Daten

Falls `app/data/seed_generated/ENTITY_NAME.json` existiert und das neue Attribut dort fehlt:
- Seed-Daten können so bleiben (NULL wird eingefügt)
- Oder Seed-Daten manuell/per LLM aktualisieren

---

## Beispiel: severity_factor bei Engine

**Änderung in Engine.md:**
```markdown
| severity_factor | int | Effect of flight profile on degradation in % [DEFAULT=100] | 90 |
```

**Änderung in DataModel.yaml:**
```yaml
Engine:
  attributes:
    # ... andere Attribute ...
    - name: severity_factor
      type: int
      description: Effect of flight profile on degradation in % [DEFAULT=100]
```

**Nach Server-Neustart:**
```sql
UPDATE engine SET severity_factor = 100 WHERE severity_factor IS NULL;
```
