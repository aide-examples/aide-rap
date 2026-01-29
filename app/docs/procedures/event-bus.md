# Event Bus

Central event system for application-wide hooks and extensibility.

## Overview

The EventBus allows decoupled communication between components via a publish/subscribe pattern. Use it to:
- Add audit logging
- Trigger external webhooks
- Implement custom validation
- React to schema changes

## Usage

```javascript
const eventBus = require('./app/server/utils/EventBus');

// Subscribe to events
eventBus.on('entity:create:after', (entityName, record) => {
  console.log(`Created ${entityName}:`, record.id);
});

// Before-hooks can throw to abort operation
eventBus.on('entity:create:before', (entityName, data) => {
  if (data.status === 'forbidden') {
    throw new Error('Status not allowed');
  }
});

// Unsubscribe
const unsubscribe = eventBus.on('entity:update:after', handler);
unsubscribe(); // removes handler
```

## Available Events

### Entity Events (GenericService)

| Event | Arguments | Description |
|-------|-----------|-------------|
| `entity:create:before` | `(entityName, data)` | Before creating a record |
| `entity:create:after` | `(entityName, record)` | After record created successfully |
| `entity:update:before` | `(entityName, id, data)` | Before updating a record |
| `entity:update:after` | `(entityName, record)` | After record updated successfully |
| `entity:delete:before` | `(entityName, id)` | Before deleting a record |
| `entity:delete:after` | `(entityName, id)` | After record deleted successfully |
| `entity:batch:before` | `(entityName, records)` | Before batch create |
| `entity:batch:after` | `(entityName, records)` | After batch create |

### Schema Events (database.js)

| Event | Arguments | Description |
|-------|-----------|-------------|
| `schema:reload:before` | `(oldSchema)` | Before schema reload |
| `schema:reload:after` | `(newSchema, { oldHash, newHash, changed })` | After schema reload |

## Event Naming Convention

```
{domain}:{action}:{timing}
```

- **domain**: `entity`, `schema`, `auth`, etc.
- **action**: `create`, `update`, `delete`, `reload`, etc.
- **timing**: `before`, `after`

## Before vs After Hooks

### Before Hooks
- Can **throw errors** to abort the operation
- Receive data **before** it's persisted
- Use for: validation, transformation, access control

```javascript
eventBus.on('entity:create:before', (entity, data) => {
  if (entity === 'Currency' && !data.code.match(/^[A-Z]{3}$/)) {
    throw new Error('Currency code must be 3 uppercase letters');
  }
});
```

### After Hooks
- Errors are **logged but don't affect** the operation
- Receive the **final persisted** data
- Use for: audit logging, notifications, cache invalidation

```javascript
eventBus.on('entity:create:after', (entity, record) => {
  auditLog.write({ action: 'create', entity, recordId: record.id });
});
```

## API Reference

### `eventBus.on(event, callback)`
Subscribe to an event. Returns unsubscribe function.

### `eventBus.once(event, callback)`
Subscribe to event, auto-unsubscribes after first call.

### `eventBus.off(event, callback)`
Unsubscribe a specific callback.

### `eventBus.emit(event, ...args)`
Emit event synchronously (errors logged, don't propagate).

### `eventBus.emitAsync(event, ...args)`
Emit event asynchronously (errors propagate, can abort operations).

### `eventBus.listenerCount(event)`
Get number of listeners for an event.

### `eventBus.eventNames()`
Get all registered event names.

### `eventBus.removeAllListeners()`
Remove all listeners (useful for testing).

## Examples

### Audit Logging

```javascript
// In app startup or plugin
const eventBus = require('./app/server/utils/EventBus');
const auditLog = require('./audit-service');

['create', 'update', 'delete'].forEach(action => {
  eventBus.on(`entity:${action}:after`, (entity, data) => {
    auditLog.record({
      timestamp: new Date(),
      action,
      entity,
      recordId: typeof data === 'object' ? data.id : data
    });
  });
});
```

### External Webhook

```javascript
eventBus.on('entity:create:after', async (entity, record) => {
  if (entity === 'Order') {
    await fetch('https://webhook.example.com/orders', {
      method: 'POST',
      body: JSON.stringify(record)
    });
  }
});
```

### Custom Validation

```javascript
eventBus.on('entity:update:before', (entity, id, data) => {
  if (entity === 'Engine' && data.status === 'scrapped') {
    // Check if engine has active leases
    const leases = getActiveLeases(id);
    if (leases.length > 0) {
      throw new Error('Cannot scrap engine with active leases');
    }
  }
});
```
