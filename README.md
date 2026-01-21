# AIDE IRMA

Intelligent Repair and Maintenance in Aviation - A demo application built on the aide-frame framework.

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
