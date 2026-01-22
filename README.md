# AIDE IRMA

A **Rapid Application Development** demonstration built on the AIDE Framework.

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

### 2. IRMA – A Demo Application

*Intelligent Repair and Maintenance in Aviation* – a demonstration application for managing aircraft fleet data, operators, and maintenance records.

**[Read the User Guide →](app/help/index.md)**

---

## Quick Start

```bash
# Clone both repositories
git clone https://github.com/aide-examples/aide-irma.git
git clone https://github.com/aide-examples/aide-frame.git

# Create symlink
cd aide-irma
ln -s ../aide-frame aide-frame

# Install and run
npm install
npm start
```

Open http://localhost:18354

---

## In the Application

| Menu Item | Description |
|-----------|-------------|
| **About** (`/about`) | Framework documentation – how the RAD system works |
| **Help** (`/help`) | User guide – how to use the IRMA application |

---

## Project Structure

```
aide-irma/
├── app/
│   ├── docs/                 # Framework documentation
│   │   ├── index.md          # ← RAD system overview
│   │   └── requirements/     # Data model definitions
│   ├── help/
│   │   └── index.md          # ← Application user guide
│   ├── server/               # Backend (Node.js)
│   ├── shared/               # Isomorphic code (validation, types)
│   ├── static/irma/          # Frontend (HTML, CSS, JS)
│   └── data/                 # Database and seed data
├── tools/                    # CLI utilities
└── aide-frame/               # Framework (symlink)
```

---

## License

MIT

---

*Built with [aide-frame](https://github.com/aide-examples/aide-frame)*
