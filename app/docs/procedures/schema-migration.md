# Schema Migration (Development Mode)

> For schema changes, the entire database is rebuilt.

## Workflow

1. **Modify Markdown files** (entity attributes, Types.md, etc.)
2. **Restart server**
3. **Load seed data** (Admin UI -> "Load All")

## What Happens at Startup?

The server calculates a hash over all entities and types. On change:

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

## Seed Data

The seed files in `app/systems/<system>/data/seed/` are preserved. After schema rebuild:

1. Open Admin menu (hamburger -> Admin)
2. Click "Load All"

Or load individual entities via right-click -> "Load..."

## Manual Reset

```bash
# Delete database and rebuild
rm app/systems/<system>/data/<system>.sqlite
./run -s <system>
```

## For Production

For production systems with existing data, a real migration system would be needed (e.g., with version numbers and up/down scripts). The current behavior is optimized for prototype development.
