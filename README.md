# AIDE RAP

**Rapid Application Prototyping** – a demonstration platform built on the AIDE Framework.

---

## Architecture: Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  Systems: irma, book, ...                               │  ← Your domain models
│  (Markdown entity definitions under app/systems/)       │
├─────────────────────────────────────────────────────────┤
│  AIDE RAP                                               │  ← This repository
│  (Markdown → Database, API, UI generator)               │
├─────────────────────────────────────────────────────────┤
│  aide-frame                                             │  ← Foundation framework
│  (Docs viewer, PWA, i18n, widgets)                      │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: aide-frame (Foundation)

The [aide-frame](https://github.com/aide-examples/aide-frame) framework provides infrastructure used by all AIDE applications: documentation viewer, PWA support, internationalization, header/footer widgets, and more.

### Layer 2: AIDE RAP (Generator)

The generic RAP engine transforms Markdown-based data models into complete applications. *No code generation wizards*, *no XML schemas* – just describe your entities in Markdown tables and get:

- SQLite database with constraints and relationships
- REST API with CRUD, filtering, and validation
- Modern browser UI with table and tree views
- AI-powered seed data generation
- Visual diagram editor for data model design

**[Read the Documentation →](app/docs/index.md)**

### Layer 3: Systems (Your Domain)

Concrete applications built on AIDE RAP. Each system defines its own entities, relationships, and seed data:

- **IRMA** – *Intelligent Repair and Maintenance in Aviation* – manages aircraft fleet data, operators, and maintenance records
- **Book** – A simple publishing system with authors and books

You can create your own system by adding a folder under `app/systems/`.

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/aide-examples/aide-rap.git

# Clone the aide-frame repository
# This is necessary because aide-rap uses aide-frame internally
# and aide-frame is stored in a separate repository
git clone https://github.com/aide-examples/aide-frame.git

# Create symlink
cd aide-rap
ln -s ../aide-frame aide-frame

# Install and run
npm install
./run -s irma -p 18354  # Start IRMA system
./run -s book -p 18352  # Start Book system on different port
```

Open http://localhost:18354

# Install as PWA if you like

---

## In the Application

| Menu Item | Description |
|-----------|-------------|
| **About** (`/about`) | Data Model of the application - feel free to modify |
| **Help** (`/help`) | User guide – how to use the application |

You can edit the entity descriptions manually, but it's far more efficient to use an AI agent. Just tell it: *"We need an Xyz entity with a relationship to Abc."* If you choose meaningful names, you'll get a solid starting point for your own model.

---

## Project Structure

```
aide-rap/
├── app/
│   ├── docs/                 # RAP tool documentation
│   │   ├── index.md          # ← RAP system overview
│   │   └── statistics.md     # ← Project-wide LOC statistics
│   ├── help/
│   │   └── index.md          # ← Application user guide
│   ├── server/               # Backend (Node.js)
│   ├── shared/               # Isomorphic code (validation, types)
│   ├── static/rap/           # Frontend (HTML, CSS, JS)
│   └── systems/              # Multi-system support
│       ├── irma/             # IRMA aviation system
│       └── book/             # Book demo system
├── tools/                    # CLI utilities
└── aide-frame/               # Framework (symlink)
```

---

## License

MIT

---

*Built with [aide-frame](https://github.com/aide-examples/aide-frame)*
