# AIDE RAP

**Rapid Application Prototyping** – a demonstration platform built on the AIDE Framework.

---

## What Is This?

This repository contains two things:

### 1. The AIDE Framework

A rapid application development platform that generates complete applications from Markdown-based data models. No code generation wizards, no XML schemas – just describe your entities in Markdown tables and get:

- SQLite database with constraints and relationships
- REST API with CRUD, filtering, and validation
- Modern browser UI with table and tree views
- AI-powered seed data generation
- Visual diagram editor for data model design

**[Read the Framework Documentation →](app/docs/index.md)**

### 2. Demo Systems

Example applications demonstrating the platform:

- **IRMA** – *Intelligent Repair and Maintenance in Aviation* – manages aircraft fleet data, operators, and maintenance records
- **Book** – A simple publishing system with authors and books

**[Read the User Guide →](app/help/index.md)**

---

## Quick Start

```bash
# Clone both repositories
git clone https://github.com/aide-examples/aide-rap.git
git clone https://github.com/aide-examples/aide-frame.git

# Create symlink
cd aide-rap
ln -s ../aide-frame aide-frame

# Install and run
npm install
./run -s irma         # Start IRMA system
./run -s book -p 18352  # Start Book system on different port
```

Open http://localhost:18354

---

## In the Application

| Menu Item | Description |
|-----------|-------------|
| **About** (`/about`) | Framework documentation – how the RAD system works |
| **Help** (`/help`) | User guide – how to use the application |

---

## Project Structure

```
aide-rap/
├── app/
│   ├── docs/                 # Framework documentation
│   │   ├── index.md          # ← RAD system overview
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
