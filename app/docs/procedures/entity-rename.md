# Prozedur: Entity Umbenennung

> Wiederverwendbare Anleitung für das Umbenennen einer Entity im AIDE-IRMA Projekt.

## Variablen

```
OLD_NAME = <AlterName>           # Alter Entity-Name (PascalCase)
NEW_NAME = <NeuerName>           # Neuer Entity-Name (PascalCase)
OLD_TABLE = <alter_name>         # Alter Tabellenname (snake_case)
NEW_TABLE = <neuer_name>         # Neuer Tabellenname (snake_case)
```

---

## Schritt 1: Referenzen finden

Vor der Umbenennung alle Referenzen suchen:

```bash
grep -r "OLD_NAME" app/docs/requirements/
grep -r "OLD_NAME" app/data/seed_generated/
grep -r "OLD_NAME" app/server/
grep -r "OLD_NAME" app/config.json
```

**Typische Fundorte:**
- `app/docs/requirements/classes/OLD_NAME.md` - Entity-Definition
- `app/docs/requirements/DataModel.md` - Auflistung und Links
- `app/docs/requirements/DataModel.yaml` - Schema-Definition
- `app/docs/requirements/DataModel-layout.json` - Diagramm-Position
- `app/docs/requirements/classes/*.md` - Seed Context in anderen Entities
- `app/data/seed_generated/OLD_NAME.json` - Generierte Seed-Daten
- `app/config.json` - enabledEntities Liste

---

## Schritt 2: Dateien umbenennen

```bash
# Entity-Markdown
mv app/docs/requirements/classes/OLD_NAME.md app/docs/requirements/classes/NEW_NAME.md

# Seed-Daten (falls vorhanden)
mv app/data/seed_generated/OLD_NAME.json app/data/seed_generated/NEW_NAME.json
```

---

## Schritt 3: Inhalte aktualisieren

### 3.1 Entity-Datei (NEW_NAME.md)
- Titel ändern: `# OLD_NAME` → `# NEW_NAME`

### 3.2 DataModel.md
- Link aktualisieren: `[OLD_NAME](classes/OLD_NAME.md)` → `[NEW_NAME](classes/NEW_NAME.md)`
- Beschreibungstext anpassen falls nötig

### 3.3 DataModel.yaml
- Entity-Key ändern: `OLD_NAME:` → `NEW_NAME:`

### 3.4 DataModel-layout.json
- Key ändern: `"OLD_NAME":` → `"NEW_NAME":`

### 3.5 config.json
- In `crud.enabledEntities` Array umbenennen

### 3.6 Andere Entity-Dateien (Seed Context, FK-Referenzen, Freitext)
- Alle `OLD_NAME` Referenzen durch `NEW_NAME` ersetzen
- **Wichtig:** Auch Freitext in `## Data Generator` Abschnitten prüfen!

---

## Schritt 4: Datenbank-Migration

**Wichtig:** Der SchemaGenerator erstellt bei Serverstart automatisch die neue Tabelle, aber die Daten müssen manuell migriert werden.

```python
import sqlite3
conn = sqlite3.connect('app/data/irma.sqlite')
cursor = conn.cursor()

# 1. Backup der Daten
cursor.execute('SELECT * FROM OLD_TABLE')
data = cursor.fetchall()

# 2. Neue Tabelle mit korrekten Constraints erstellen
cursor.execute('''
CREATE TABLE NEW_TABLE (
  id INTEGER PRIMARY KEY,
  -- ... Spalten analog zur alten Tabelle ...
  -- ... Foreign Keys und Constraints ...
)
''')

# 3. Daten einfügen
for row in data:
    cursor.execute('INSERT INTO NEW_TABLE (...) VALUES (...)', row)

conn.commit()

# 4. Verifizieren
cursor.execute('SELECT COUNT(*) FROM NEW_TABLE')
print(f'Migrated {cursor.fetchone()[0]} rows')

# 5. Alte Tabelle löschen (nach Verifizierung)
cursor.execute('DROP TABLE OLD_TABLE')
conn.commit()
conn.close()
```

**Alternative:** Server neu starten, dann werden Views automatisch neu erstellt.

---

## Schritt 5: Verifizierung

- [ ] Server startet ohne Fehler
- [ ] Entity mit neuem Namen erscheint in UI
- [ ] Daten sind vollständig vorhanden
- [ ] FK-Referenzen funktionieren
- [ ] Seed Context in abhängigen Entities korrekt
- [ ] Keine Warnungen zu "orphaned columns" beim Start

---

## Beispiel: EngineTypePossible → EngineMountPossible

**Betroffene Dateien:**
1. `classes/EngineTypePossible.md` → `classes/EngineMountPossible.md`
2. `DataModel.md` - Zeile 18
3. `DataModel.yaml` - Entity-Key
4. `DataModel-layout.json` - Position-Key
5. `config.json` - enabledEntities
6. `classes/EngineMount.md` - Seed Context
7. `seed_generated/EngineTypePossible.json` → `seed_generated/EngineMountPossible.json`

**Datenbank:**
- `engine_type_possible` → `engine_mount_possible` (30 Datensätze)
