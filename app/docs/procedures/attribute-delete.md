# Prozedur: Attribut löschen

> Wiederverwendbare Anleitung für das vollständige Entfernen eines Attributs aus einer Entity.

## Variablen

```
ENTITY_NAME = <EntityName>       # Entity-Name (PascalCase)
ATTR_NAME   = <attribute_name>   # Attributname (snake_case)
TABLE_NAME  = <table_name>       # Tabellenname (snake_case)
```

---

## Schritt 1: Attribut aus Markdown-Tabelle entfernen

In `app/docs/requirements/classes/ENTITY_NAME.md` die Zeile mit dem Attribut löschen:

```markdown
| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| ... |
| ATTR_NAME | ... | ... | ... |  ← Diese Zeile löschen
| ... |
```

---

## Schritt 2: Attribut aus DataModel.yaml entfernen

In `app/docs/requirements/DataModel.yaml` den Attribut-Block löschen:

```yaml
ENTITY_NAME:
  attributes:
    # ...
    - name: ATTR_NAME        ← Diesen Block löschen
      type: ...
      description: ...
    # ...
```

---

## Schritt 3: Datenbank-Spalte entfernen

**Option A: SQLite 3.35.0+ (ALTER TABLE DROP COLUMN)**

```sql
ALTER TABLE TABLE_NAME DROP COLUMN ATTR_NAME;
```

**Option B: Ältere SQLite-Versionen (Tabelle neu erstellen)**

```python
import sqlite3
conn = sqlite3.connect('app/data/irma.sqlite')
cursor = conn.cursor()

# 1. Spalten der Tabelle abrufen (ohne die zu löschende)
cursor.execute(f"PRAGMA table_info({TABLE_NAME})")
columns = [col[1] for col in cursor.fetchall() if col[1] != 'ATTR_NAME']
cols_str = ', '.join(columns)

# 2. Temporäre Tabelle erstellen
cursor.execute(f"CREATE TABLE {TABLE_NAME}_backup AS SELECT {cols_str} FROM {TABLE_NAME}")

# 3. Originaltabelle löschen
cursor.execute(f"DROP TABLE {TABLE_NAME}")

# 4. Backup umbenennen
cursor.execute(f"ALTER TABLE {TABLE_NAME}_backup RENAME TO {TABLE_NAME}")

conn.commit()
conn.close()
```

---

## Schritt 4: Server neu starten

```bash
./run -p 18355  # oder User-Port 18354
```

Der SchemaGenerator:
1. Erkennt das fehlende Attribut im Schema
2. Erstellt die View ohne die gelöschte Spalte neu
3. Warnt ggf. über "orphaned column" falls Spalte noch in DB existiert

---

## Schritt 5: Verifizierung

- [ ] Server startet ohne Fehler
- [ ] Attribut erscheint nicht mehr in der UI
- [ ] Keine "orphaned column" Warnung beim Start
- [ ] CRUD-Operationen funktionieren weiterhin

---

## Hinweise

### Seed-Daten

Falls `app/data/seed_generated/ENTITY_NAME.json` das Attribut enthält:
- Kann so bleiben (wird beim Import ignoriert)
- Oder manuell aus JSON entfernen

### Foreign Key Attribute

Wenn das Attribut ein FK war:
- Constraint wird automatisch entfernt wenn Spalte gelöscht wird
- Abhängige Views werden beim Server-Neustart neu erstellt

### Computed Fields

Computed Fields (z.B. `[DAILY=...]`) existieren nicht in der Datenbank:
- Nur aus Markdown und YAML entfernen
- Kein Datenbank-Schritt nötig

---

## Beispiel: severity_factor bei Engine löschen

**Schritt 1:** Engine.md - Zeile entfernen:
```markdown
| severity_factor | int [DEFAULT=100] | ... | 90 |  ← löschen
```

**Schritt 2:** DataModel.yaml - Block entfernen:
```yaml
      - name: severity_factor
        type: int
        description: ...
```

**Schritt 3:** Datenbank:
```sql
ALTER TABLE engine DROP COLUMN severity_factor;
```

**Schritt 4:** Server neu starten
