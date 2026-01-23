# Automatische Schema-Migration

> Der Server erkennt Schema-Änderungen automatisch beim Start und führt sichere Migrationen durch.

## Übersicht

Die `_schema_metadata` Tabelle speichert das aktuelle Schema. Beim Startup vergleicht der Server das Markdown-Schema mit dem gespeicherten Schema und erkennt Änderungen.

## Erkannte Änderungen

### Entities

| Änderung | Aktion | Log-Level |
|----------|--------|-----------|
| **Neue Entity** | CREATE TABLE | INFO |
| **Entity entfernt** | DROP TABLE, VIEW, Seed | WARN |
| **Entity umbenannt** | RENAME TABLE, Seed | INFO |

### Attribute (Spalten)

| Änderung | Aktion | Log-Level |
|----------|--------|-----------|
| **Neue Spalte** | ALTER TABLE ADD COLUMN | INFO |
| **Spalte entfernt** | ALTER TABLE DROP COLUMN | INFO |
| **Spalte umbenannt** | RENAME COLUMN (bei high confidence) | INFO |
| **Typ geändert** | Nur Warnung (SQLite-Limit) | WARN |
| **DEFAULT geändert** | Nur Info | INFO |
| **Required geändert** | Warnung wenn jetzt required | WARN/INFO |
| **FK-Referenz geändert** | Nur Warnung (SQLite-Limit) | WARN |

### Types (Types.md)

| Änderung | Aktion | Log-Level |
|----------|--------|-----------|
| **Pattern hinzugefügt** | Registriert | INFO |
| **Pattern geändert** | Warnung | WARN |
| **Pattern entfernt** | Warnung | WARN |
| **Enum hinzugefügt** | Registriert | INFO |
| **Enum geändert** | Warnung | WARN |
| **Enum entfernt** | Warnung | WARN |

---

## Rename-Erkennung

### Entity-Rename
- Erkannt via **identischer Schema-Hash**
- Wenn eine Entity fehlt und eine neue Entity denselben Hash hat → Rename
- Tabelle und Seed-Datei werden automatisch umbenannt

### Spalten-Rename
- **High Confidence**: Gleiche Description → automatisches RENAME COLUMN
- **Low Confidence**: Nur gleicher Typ → Warnung, manuelle Prüfung nötig

---

## SQLite-Limitierungen

Folgende Änderungen können **nicht automatisch** durchgeführt werden:

| Änderung | Grund | Lösung |
|----------|-------|--------|
| Typ ändern | Kein ALTER COLUMN | Tabelle neu erstellen |
| NOT NULL hinzufügen | Bei existierenden NULL-Werten | Daten erst bereinigen |
| FK-Constraint ändern | Kein ALTER CONSTRAINT | Tabelle neu erstellen |

---

## Workflow

### Einfache Änderungen (automatisch)

1. Markdown-Datei ändern (z.B. Attribut hinzufügen)
2. Server neu starten
3. Log prüfen: `Schema: ADD Entity.attribute`

### Komplexe Änderungen (manuell)

Bei Warnungen wie `(manual migration needed)`:

1. Backup erstellen: `cp app/data/irma.sqlite app/data/irma.sqlite.bak`
2. Manuelle SQL-Migration ausführen
3. Server neu starten

---

## Metadaten-Tabelle

```sql
SELECT * FROM _schema_metadata;
```

| entity_name | columns_json | schema_hash | updated_at |
|-------------|--------------|-------------|------------|
| Aircraft | [...] | abc123... | 2026-01-23 |
| _types | {...} | def456... | 2026-01-23 |

---

## Beispiele

### Attribut hinzufügen

```markdown
# In Aircraft.md
| rating | int | Quality rating | 5 |
```

Log: `Schema: ADD Aircraft.rating`

### Attribut umbenennen (mit Description-Match)

```markdown
# Vorher
| old_name | int | Quality rating | 5 |

# Nachher
| new_name | int | Quality rating | 5 |
```

Log: `Schema: RENAME Aircraft.old_name -> new_name (description match)`

### Entity umbenennen

```bash
# Datei umbenennen
mv app/docs/requirements/classes/OldName.md app/docs/requirements/classes/NewName.md
# Inhalt: ## NewName
```

Log:
```
Schema: Entity renamed OldName -> NewName
Renamed table old_name -> new_name
Renamed seed file OldName.json -> NewName.json
```
