# IRMA Tools

Dieses Verzeichnis enthält Werkzeuge zur Verwaltung des Datenmodells und der Diagramme.

## Voraussetzungen

### draw.io VS Code Extension

```bash
code --install-extension hediet.vscode-drawio
```

Nach der Installation können `.drawio` Dateien direkt in VS Code bearbeitet werden.

**Alternative:** https://app.diagrams.net (Browser-Version)

---

## Architektur

**Single Source of Truth:** `DataModel.md`

```
DataModel.md          →  parse-datamodel.js  →  DataModel.yaml
(lesbare Doku)                                   (generiert)
     +
layout.drawio         →  extract-layout.js   →  layout.json
(visuelles Layout)                               (Positionen)
                                                     ↓
                                            generate-diagram.js
                                                     ↓
                                            diagram.svg / diagram-detailed.svg
```

### Dateien

| Datei | Typ | Zweck |
|-------|-----|-------|
| `app/docs/requirements/DataModel.md` | **Quelle** | Klassen, Attribute, Areas (bearbeiten!) |
| `app/docs/requirements/layout.drawio` | **Quelle** | Positionen der Boxen (visuell bearbeiten) |
| `app/docs/requirements/DataModel.yaml` | Generiert | Maschinenlesbares Modell |
| `app/docs/requirements/layout.json` | Generiert | Positionen als JSON |
| `app/docs/requirements/diagram.svg` | Generiert | Kompaktes Diagramm |
| `app/docs/requirements/diagram-detailed.svg` | Generiert | Diagramm mit Attributen |

---

## Workflows

### 1. Klasse hinzufügen/ändern

1. **DataModel.md editieren:**

   a) Klasse zur Areas-Tabelle hinzufügen (HTML-Tabelle am Anfang)

   b) Entity Description hinzufügen:
   ```markdown
   ### NeueKlasse
   Beschreibung der Klasse.

   | Attribute | Type | Description |
   |-----------|------|-------------|
   | id | int | Primary key |
   | name | string | Name |
   | other_class_id | int | Reference to OtherClass |
   ```

2. **Position in layout.drawio hinzufügen:**
   - draw.io öffnen
   - Neue Box erstellen und positionieren
   - Speichern

3. **Alles neu generieren:**
   ```bash
   cd /home/gero/aide-examples/aide-irma
   node tools/parse-datamodel.js && \
   node tools/extract-layout.js -i app/docs/requirements/layout.drawio && \
   node tools/generate-diagram.js -o app/docs/requirements/diagram.svg && \
   node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg
   ```

---

### 2. Beziehung hinzufügen/ändern

Beziehungen werden automatisch aus den Attributen erkannt!

1. **In DataModel.md:** Attribut mit "Reference to X" hinzufügen:
   ```markdown
   | other_id | int | Reference to OtherClass |
   ```

2. **Neu generieren** (siehe oben)

---

### 3. Layout visuell anpassen (mit draw.io)

1. **draw.io Datei öffnen:**
   - In VS Code: `app/docs/requirements/layout.drawio` öffnen
   - Oder im Browser: https://app.diagrams.net → Datei öffnen

2. **Boxen verschieben:**
   - Klassen per Drag & Drop positionieren
   - Speichern (Ctrl+S)

3. **Positionen extrahieren und Diagramme generieren:**
   ```bash
   node tools/extract-layout.js -i app/docs/requirements/layout.drawio && \
   node tools/generate-diagram.js -o app/docs/requirements/diagram.svg && \
   node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg
   ```

---

### 4. Area (Kompetenzgebiet) hinzufügen/ändern

1. **In DataModel.md:** HTML-Tabelle "Areas of Competence" editieren:
   ```html
   <tr style="background-color: #E0E0E0;">
     <td><strong>Neue Area</strong></td>
     <td>Klasse1, Klasse2, Klasse3</td>
   </tr>
   ```

2. **Neu generieren**

---

## Scripts

### parse-datamodel.js

Parst DataModel.md und erzeugt DataModel.yaml.

```bash
node tools/parse-datamodel.js
```

### generate-diagram.js

Erzeugt SVG-Diagramm aus DataModel.yaml + layout.json.

```bash
# Kompaktes Diagramm (nur Klassennamen)
node tools/generate-diagram.js -o app/docs/requirements/diagram.svg

# Mit Attributen (y-scale 2.5 Standard)
node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg

# Mit benutzerdefiniertem y-scale
node tools/generate-diagram.js -a -y 3.0 -o app/docs/requirements/diagram-detailed.svg

# Ohne Legende
node tools/generate-diagram.js --no-legend -o output.svg
```

### generate-drawio.js

Erzeugt draw.io Datei aus DataModel.yaml + layout.json (für neue Klassen).

```bash
node tools/generate-drawio.js -o app/docs/requirements/layout.drawio
```

### extract-layout.js

Liest Positionen aus draw.io Datei und aktualisiert layout.json.

```bash
node tools/extract-layout.js -i app/docs/requirements/layout.drawio
```

---

## Schnellreferenz

```bash
cd /home/gero/aide-examples/aide-irma

# Nach Änderungen in DataModel.md:
node tools/parse-datamodel.js && \
node tools/generate-diagram.js -o app/docs/requirements/diagram.svg && \
node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg

# Nach Layout-Änderungen in draw.io:
node tools/extract-layout.js -i app/docs/requirements/layout.drawio && \
node tools/generate-diagram.js -o app/docs/requirements/diagram.svg && \
node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg

# Komplette Regenerierung:
node tools/parse-datamodel.js && \
node tools/extract-layout.js -i app/docs/requirements/layout.drawio && \
node tools/generate-diagram.js -o app/docs/requirements/diagram.svg && \
node tools/generate-diagram.js -a -o app/docs/requirements/diagram-detailed.svg
```
