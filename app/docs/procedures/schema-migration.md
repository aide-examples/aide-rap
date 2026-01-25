# Schema-Migration (Entwicklungsmodus)

> Bei Schema-Änderungen wird die gesamte Datenbank neu aufgebaut.

## Workflow

1. **Markdown-Dateien ändern** (Entity-Attribute, Types.md, etc.)
2. **Server neu starten**
3. **Seed-Daten laden** (Admin UI → "Load All")

## Was passiert beim Start?

Der Server berechnet einen Hash über alle Entities und Types. Bei Änderung:

```
Schema changed - recreating all tables
Dropped table aircraft
Dropped table registration
...
Created table aircraft_oem
Created table aircraft_type
...
Schema initialized (15 tables, hash: a1b2c3d4...)
```

## Seed-Daten

Die Seed-Dateien in `app/data/seed/` bleiben erhalten. Nach Schema-Neuaufbau:

1. Admin-Menü öffnen (☰ → Admin)
2. "Load All" klicken

Oder einzelne Entities per Rechtsklick → "Load..."

## Manueller Reset

```bash
# Datenbank löschen und neu aufbauen
rm app/data/irma.sqlite
./run
```

## Für Produktion

Für produktive Systeme mit bestehenden Daten wäre ein echtes Migrations-System nötig (z.B. mit Versionsnummern und Up/Down-Scripts). Das aktuelle Verhalten ist für die Prototyp-Entwicklung optimiert.
