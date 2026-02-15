# Security

AIDE RAP implements defense-in-depth across all layers. This document provides a concise inventory of all security measures.

---

## Authentication

### Session-Based Auth (Browser)

Role-based access with three roles: **admin** (full access), **user** (read/write), **guest** (read-only).

- Passwords stored as **SHA-256 hashes** in `config.json`
- Client hashes password before sending (no plaintext over network)
- Sessions stored in **signed cookies** (HMAC with session secret)
- Tool: `tools/generate-password-hash.js` for creating password hashes
- `--noauth` flag disables auth for development

**Cookie Security:**

| Flag | Value | Purpose |
|------|-------|---------|
| `httpOnly` | true | No JavaScript access (XSS protection) |
| `signed` | true | Tamper detection via HMAC |
| `secure` | auto | HTTPS-only (detects `X-Forwarded-Proto`) |
| `sameSite` | strict | CSRF protection (no cross-site cookies) |

### API Key Auth (Service-to-Service)

For external tools (HCL Leap, Power Automate, etc.) via `X-API-Key` header.

- Keys stored as **SHA-256 hashes** (never plaintext)
- Per-key **CORS origin** whitelisting
- Per-key **entity scope** restriction (`allowedEntities`)
- **Trusted Subsystem**: `X-User-Id` header passthrough for audit trail

### Secret Management

- Session secret read from `config.json` → `auth.sessionSecret`
- **Startup warning** if secret contains "default" or "change"
- API keys stored as hashes, never logged in plaintext

---

## HTTP Security

### Helmet.js Headers

Helmet v8 sets protective HTTP headers:

- `X-Content-Type-Options: nosniff` (MIME sniffing prevention)
- `X-Frame-Options` (clickjacking prevention)
- `Strict-Transport-Security` (HSTS when behind HTTPS)
- CSP disabled (SPA with inline scripts)
- Cross-Origin-Embedder-Policy disabled (external resources like maps)

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/login` | 5 requests | 1 minute per IP |
| `/api/*` | 300 requests | 1 minute per IP |

Uses `express-rate-limit` with standard headers (`RateLimit-*`).

### CSRF Protection

No explicit CSRF tokens needed — the combination of `sameSite: strict` cookies and JSON-only API endpoints provides browser-enforced CSRF protection.

---

## Data Security

### SQL Injection Prevention

All database queries use **parameterized statements** via better-sqlite3:

```javascript
db.prepare('SELECT * FROM employee WHERE id = ?').get(id);
db.prepare(insertSQL).run(...values);
```

Table and column names come from validated schema metadata, not user input.

### XSS Prevention

Client-side HTML escaping via `DomUtils.escapeHtml()` (uses `textContent` assignment). All user-provided values pass through this function before DOM insertion.

### Input Validation

Isomorphic `ObjectValidator` runs identically on frontend and backend:
- **Type validation** (regex patterns, enums, numeric ranges)
- **Required fields**, `[MIN=x]`/`[MAX=x]` constraints
- **Object-level constraints** (cross-field, cross-entity via `lookup()`/`exists()`)
- See [Validation](validation.md) for details.

### Path Traversal Protection

- System directory paths validated with `path.resolve()` checks
- Media files stored with **UUID-based naming** (no user-controlled filenames)
- Subdirectory bucketing by UUID prefix

### File Upload Security

- Configurable **file size limit** (default 50 MB)
- MIME type **whitelist** support
- **Bulk upload limit** (default 20 files)
- Image resizing enforced via Sharp (maxWidth, maxHeight)

---

## Integrity

### Optimistic Concurrency Control

Every record carries a `_version` counter. Updates require `If-Match` header with current version — mismatches return **409 Conflict** with the current record state.

### Audit Trail

All CREATE, UPDATE, DELETE operations are logged to `_audit_trail` with before/after snapshots, user identification, timestamp, and correlation ID.

### Request Correlation

Every request gets a UUID (`X-Correlation-ID` header) for end-to-end tracing through logs and audit records.

---

## Known Limitations

### xlsx (SheetJS) v0.18.5

The `xlsx` package is used for XLSX import parsing. It is a **community edition** that no longer receives security updates (the maintained version is the commercial SheetJS Pro). The package processes uploaded files server-side. Risk is mitigated by:
- Files are only processed through the import pipeline (admin action)
- No user-facing spreadsheet rendering
- Alternative: consider replacing with a maintained XLSX parser if needed

### No Content Security Policy

CSP is disabled because the SPA uses inline scripts and dynamically loaded content. This is a trade-off for development convenience.

### SHA-256 Password Hashing

Passwords are hashed with SHA-256 (not bcrypt/argon2). This is acceptable for the current use case (small user base, role-based auth, not per-user passwords) but would need upgrading for a multi-user production system.

---

## Configuration Checklist

For production deployments:

1. Set a strong `auth.sessionSecret` in `config.json`
2. Enable auth: `auth.enabled: true`
3. Set password hashes for all roles
4. Configure `apiKeys` with per-key entity scopes and CORS origins
5. Run behind a **reverse proxy** (nginx/caddy) with HTTPS termination
6. Restrict file upload types via `media.allowedTypes`
