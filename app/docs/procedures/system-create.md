# Procedure: Create New System

> Guide for creating a new AIDE RAP system using the Model Builder.

## Variables

```
SYSTEM_NAME = <system_name>   # System directory name (snake_case, lowercase)
DISPLAY_NAME = <Display Name> # Human-readable name
```

---

## Method 1: Via Model Builder UI (Recommended)

### Step 1: Open Model Builder

1. Open the AIDE RAP main application
2. Click **Seed Data** in the toolbar (or press `/`)
3. Click **+ New System** button

### Step 2: System Info (Tab 1)

| Field | Description | Example |
|-------|-------------|---------|
| System Name | Unique identifier (snake_case) | `library_v2` |
| Display Name | Human-readable name | `Library Management` |
| Description | Brief description | `Manage books, authors, and loans` |
| Theme Color | PWA accent color | `#2563eb` |

Click **Save & Continue** to create the system directory immediately.

**Note:** At this point, `app/systems/<SYSTEM_NAME>/` is created with `config.json`.

### Step 3: Design Brief (Tab 2)

Write a natural language description of your data model:

```
I need a system to manage a library:
- Authors have names and biographies
- Books have titles, ISBNs, publication dates
- Each book has one author
- Members can borrow books
- Track loan dates and return status
```

Click **Save & Build Prompt** to save to `design.md` and generate the AI prompt.

### Step 4: AI Prompt (Tab 3)

Copy the generated prompt and paste it into an AI assistant (Claude, ChatGPT, etc.).

The AI will generate a Mermaid ER diagram.

### Step 5: Paste Response (Tab 4)

Paste the AI-generated Mermaid code (including the ```mermaid markers).

You can also drag & drop a `.md` file containing the diagram.

### Step 6: Preview & Import (Tab 5)

Review the parsed entities and choose an import mode:

| Mode | Description |
|------|-------------|
| **Replace All** | Delete existing entities, import new ones |
| **Merge (ignore)** | Keep existing entities, add only new ones |
| **Merge (replace)** | Keep non-conflicting, replace same-named |

Click **Import** to generate the entity files.

### Step 7: Restart Server

The system is created but requires a server restart to be active:

```bash
./run -s SYSTEM_NAME
```

---

## Method 2: Manual Copy

```bash
# Copy from existing system
cp -r app/systems/book app/systems/SYSTEM_NAME

# Edit config
nano app/systems/SYSTEM_NAME/config.json

# Edit data model
nano app/systems/SYSTEM_NAME/docs/DataModel.md
```

---

## Files Created

| Path | Created When |
|------|--------------|
| `config.json` | Tab 1 (Save & Continue) |
| `design.md` | Tab 2 (Save & Build Prompt) |
| `docs/classes/*.md` | Tab 5 (Import) |
| `docs/DataModel.md` | Tab 5 (Import) |
| `docs/index.md` | Tab 5 (Import) |
| `help/index.md` | Tab 5 (Import) |
| `data/seed/*.json` | Tab 5 (empty arrays) |

---

## Resuming Creation

If you close the dialog before completing:

1. Reopen Model Builder
2. Select the system from the dropdown
3. Continue from where you left off

All saved data persists between sessions.

---

## Tips

- **System names**: Use snake_case, lowercase, start with letter
- **Valid**: `library`, `book_store`, `inventory_v2`
- **Invalid**: `Library`, `book-store`, `2nd_system`

- **AI Output**: Request the diagram as a downloadable `.md` file to preserve code block markers

- **FK References in Seed Data**: Use `"author": "#1"` (by index) or `"author": "Jane Austen"` (by label)
