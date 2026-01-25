# Data Model

![Data Model Diagram](/docs-assets/requirements/DataModel-diagram.svg)

## Entity Descriptions

Entity definitions are stored in separate files under [classes/](classes/).

### Authoring
<div style="background-color: #E8F4E8; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Author](classes/Author.md) | Writers who create original book content |
| [Editor](classes/Editor.md) | Professionals who coordinate multi-author book projects |
| [BookAuthor](classes/BookAuthor.md) | Links authors to books with contribution order and type |
</div>

### Translating
<div style="background-color: #E6D9F2; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Translator](classes/Translator.md) | Language specialists who convert books between languages |
| [TranslatorLanguage](classes/TranslatorLanguage.md) | Tracks translator competencies in specific language pairs |
| [Translation](classes/Translation.md) | Converted version of a book into a different language |
</div>

### Publishing
<div style="background-color: #FCE5CD; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Publisher](classes/Publisher.md) | Publishing houses responsible for producing and distributing editions |
| [Book](classes/Book.md) | Original literary works with metadata and content information |
| [Edition](classes/Edition.md) | Physical or digital publication of a book or translation by a publisher |
</div>

### Referencing
<div style="background-color: #E8EEF4; padding: 10px;">

| Entity | Description |
|--------|-------------|
| [Country](classes/Country.md) | Geographic reference data with ISO codes for nationality and location tracking |
| [Language](classes/Language.md) | Language reference data for original works and translations |
</div>

## Class Diagram

![Data Model Diagram (Detailed)](/docs-assets/requirements/DataModel-diagram-detailed.svg)

<a href="/layout-editor?doc=DataModel" target="_blank"><button type="button">Edit Layout</button></a>

---

*Model generated with [Model Builder](/#model-builder). See [Design Brief](../design.md) for original requirements.*
