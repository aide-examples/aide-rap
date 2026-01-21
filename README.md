# AIDE IRMA

A demo application built on the aide-frame framework. This is a generic rapid prototyping tool which is driven by meta data defined in the markdown docs of the app. It is the dream of what "CASE" tools in the 1990s wanted to be. You describe your class model in semi-formal notation and interactively design a graphical representation. At the same time SQL tables are generated and a generic three layer backend and a modern browser UI are generated. There is also a generic type system available which allows you to define enums, numeric ranges, regexp patterns for attributes of entities. Validation is identically performed in the backend for integrity reasins and in the formt end for ergonomic reasons. Sample data can be imported or generated
based on semi-formal rules. 

The example is taken from aviation industry, hence the acronym IRMA *Intelligent Repair and Maintenance in Aviation*.

## Prerequisites

- Node.js 18+
- npm

## Setup

This project requires the [aide-frame](https://github.com/aide-examples/aide-frame) framework.

```bash
# 1. Clone both repositories
git clone https://github.com/aide-examples/aide-irma.git
git clone https://github.com/aide-examples/aide-frame.git

# 2. Create symlink from aide-irma to aide-frame
cd aide-irma
ln -s ../aide-frame aide-frame

# 3. Install dependencies
npm install

# 4. Start the server
npm start
```

The application will be available at http://localhost:18354

## Project Structure

```
aide-irma/
├── app/                    # Application code
│   ├── data/              # SQLite database and seed data
│   ├── docs/              # Documentation and data model
│   ├── server/            # Backend modules
│   └── static/irma/       # Frontend (HTML, CSS, JS)
├── tools/                  # CLI utilities
└── aide-frame -> ../aide-frame  # Framework (symlink)
```

## Development

```bash
# Run with auto-reload
npm run dev

# Regenerate data model diagrams
npm run regenerate-diagrams
```

## License

MIT
