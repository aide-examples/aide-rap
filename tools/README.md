# RAP Tools

Dieses Verzeichnis enthält Werkzeuge zur Verwaltung des Datenmodells und der Diagramme.

## Voraussetzungen

### draw.io VS Code Extension (optional)

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
                                            Layout Editor (Browser)
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

2. **Layout Editor öffnen:**
   - http://localhost:18354/layout-editor
   - Dokument auswählen
   - Neue Klasse wird automatisch angezeigt

3. **Position anpassen und speichern:**
   - Box per Drag & Drop positionieren
   - "Save" klicken → SVG-Diagramme werden automatisch generiert

---

### 2. Beziehung hinzufügen/ändern

Beziehungen werden automatisch aus den Attributen erkannt!

1. **In DataModel.md:** Attribut mit Entitynamen als Typ hinzufügen:
   ```markdown
   | other | OtherClass | Reference to OtherClass |
   ```

2. **Layout Editor öffnen** → Neue Verbindungslinie wird automatisch gezeichnet

3. **Speichern** → SVG wird aktualisiert

---

### 3. Layout visuell anpassen

#### Option A: Layout Editor (empfohlen)

1. **Layout Editor öffnen:** http://localhost:18354/layout-editor
2. **Dokument auswählen**
3. **Boxen per Drag & Drop verschieben**
4. **"Save" klicken** → Speichert layout.json + diagram.svg + diagram-detailed.svg

#### Option B: draw.io (für komplexe Layouts)

1. **draw.io Datei öffnen:**
   - In VS Code: `app/docs/requirements/layout.drawio` öffnen
   - Oder im Browser: https://app.diagrams.net → Datei öffnen

2. **Boxen verschieben:**
   - Klassen per Drag & Drop positionieren
   - Speichern (Ctrl+S)

3. **Positionen extrahieren:**
   ```bash
   node tools/extract-layout.js -i app/docs/requirements/layout.drawio
   ```

4. **Layout Editor öffnen** und "Save" klicken für SVG-Generierung

---

### 4. Area (Kompetenzgebiet) hinzufügen/ändern

1. **In DataModel.md:** HTML-Tabelle "Areas of Competence" editieren:
   ```html
   <tr style="background-color: #E0E0E0;">
     <td><strong>Neue Area</strong></td>
     <td>Klasse1, Klasse2, Klasse3</td>
   </tr>
   ```

2. **Layout Editor öffnen und speichern** → Farben werden aktualisiert

---

## Scripts

### parse-datamodel.js

Parst DataModel.md und erzeugt DataModel.yaml.

```bash
node tools/parse-datamodel.js
```

### extract-layout.js

Liest Positionen aus draw.io Datei und aktualisiert layout.json.

```bash
node tools/extract-layout.js -i app/docs/requirements/layout.drawio
```

### generate-drawio.js

Erzeugt draw.io Datei aus DataModel.yaml + layout.json (für neue Klassen).

```bash
node tools/generate-drawio.js -o app/docs/requirements/layout.drawio
```

---

## Schnellreferenz

```bash
cd /home/gero/aide-examples/aide-rap

# Nach Änderungen in DataModel.md:
# 1. Layout Editor öffnen: http://localhost:18354/layout-editor
# 2. Dokument auswählen → Änderungen werden automatisch geladen
# 3. "Save" klicken → SVG-Diagramme werden generiert

# Nach Layout-Änderungen in draw.io:
node tools/extract-layout.js -i app/docs/requirements/layout.drawio
# Dann Layout Editor öffnen und "Save" klicken
```
