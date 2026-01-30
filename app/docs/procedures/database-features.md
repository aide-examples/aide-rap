# Database Features

AIDE RAP includes several enterprise-grade database features that work automatically without configuration.

## WAL Mode (Write-Ahead Logging)

SQLite runs in WAL mode for better concurrency:

- **Multiple readers** can access data simultaneously while a writer is active
- **Faster writes** due to sequential log appending instead of random-access page updates
- **Crash recovery** is more robust

This is enabled automatically at database initialization.

## System Columns

Every entity automatically includes three system-managed columns:

| Column | Type | Description |
|--------|------|-------------|
| `created_at` | TEXT (ISO 8601) | Timestamp when the record was created |
| `updated_at` | TEXT (ISO 8601) | Timestamp of the last modification |
| `version` | INTEGER | Incremented on each update (for OCC) |

These columns are:
- **Invisible in DataModel.md** - You don't define them, they just appear
- **Readonly in forms** - Users cannot manually edit them
- **Excluded from schema hash** - Adding them doesn't trigger schema rebuild

## Optimistic Concurrency Control (OCC)

Prevents lost updates when multiple users edit the same record simultaneously.

### How It Works

1. When you load a record, its `version` is stored
2. When you save, the server checks if `version` still matches
3. If another user saved in between, you see a conflict dialog

### Conflict Resolution

When a conflict occurs, the UI shows a comparison dialog with three options:

| Option | What It Does |
|--------|--------------|
| **Cancel** | Stay in the form, keep your changes unsaved |
| **Load Server Version** | Discard your changes, reload the current version |
| **Overwrite** | Force-save your changes, incrementing from the new version |

### Technical Details

- **ETag Header**: GET responses include `ETag: "Entity:id:version"`
- **If-Match Header**: PUT requests send `If-Match: "Entity:id:version"`
- **409 Response**: On conflict, includes `currentRecord` with the server's version

### Example

```bash
# Get record with ETag
curl -i http://localhost:18349/api/entities/Currency/1
# ETag: "Currency:1:3"

# Update with version check
curl -X PUT http://localhost:18349/api/entities/Currency/1 \
  -H "Content-Type: application/json" \
  -H 'If-Match: "Currency:1:3"' \
  -d '{"name": "Euro", "code": "EUR", "symbol": "€"}'
```

## Audit Trail

All entity changes are automatically logged to the `_audit_trail` table.

### What Gets Logged

| Action | Before | After |
|--------|--------|-------|
| CREATE | null | Full new record |
| UPDATE | Record before change | Record after change |
| DELETE | Record before deletion | null |

### Audit Record Structure

| Column | Description |
|--------|-------------|
| `id` | Auto-increment primary key |
| `entity_name` | Which entity type (e.g., "Currency") |
| `entity_id` | Which record ID |
| `action` | CREATE, UPDATE, or DELETE |
| `before_data` | JSON snapshot before the change |
| `after_data` | JSON snapshot after the change |
| `changed_by` | Client IP address |
| `changed_at` | ISO 8601 timestamp |
| `correlation_id` | Request tracking ID |

### Viewing the Audit Trail

The audit trail appears as **AuditTrail** in the entity selector under the **System** area. It's readonly - you can view but not modify audit records.

### API Access

```bash
# List all audit entries (newest first)
curl http://localhost:18349/api/audit

# Filter by entity
curl http://localhost:18349/api/audit?entity=Currency

# Filter by entity and ID
curl http://localhost:18349/api/audit?entity=Currency&entityId=1

# Filter by action
curl http://localhost:18349/api/audit?action=UPDATE
```

### JSON Diff Analysis

The `before_data` and `after_data` fields contain full JSON snapshots. To see what changed in an UPDATE:

```javascript
const before = JSON.parse(entry.before_data);
const after = JSON.parse(entry.after_data);

// Find changed fields
for (const key of Object.keys(after)) {
  if (before[key] !== after[key]) {
    console.log(`${key}: ${before[key]} → ${after[key]}`);
  }
}
```

## Backup and Restore

The audit trail is included in backup/restore operations:
- **Backup**: `_audit_trail` records are exported to `data/backup/_audit_trail.json`
- **Restore**: Audit records are restored along with other data
- **Seeding**: The `GENERATE` instruction doesn't apply to audit (it's system-managed)

## Best Practices

1. **Don't modify system columns manually** - They're managed automatically
2. **Handle 409 conflicts gracefully** - The dialog gives users clear choices
3. **Use the audit trail for debugging** - Track down "who changed what when"
4. **Consider audit retention** - For long-running systems, you may want to archive old audit records
