# Security Guide

## Deployment secrets

Set unique `JWT_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, and `DATABASE_CREDENTIALS_ENCRYPTION_KEY` before production startup. The database encryption key is 32 bytes represented as 64 hex characters. Do not commit `.env`, include secrets in issue reports, or reuse CI/demo credentials. Configure `WEBHOOK_SECRET` only when webhook triggers are needed; the endpoint fails closed if it is missing or weak.

## Access control

Project operations enforce role checks in the backend. Security Gate 1 fixed a confirmed IDOR in Check import and added regression coverage: an Owner or Editor can import, while Viewer, cross-project and revoked-member requests are denied before writes. The broader endpoint-by-endpoint API and MCP role matrix is intentionally **PARTIAL** and remains a known coverage limitation; source inventory is not equivalent to runtime testing of every role combination. Do not treat this guide as a full RBAC/IDOR sign-off. Use individual accounts and least privilege. API tokens act as their owning user, are stored hashed, and should be expired and revoked when no longer needed. Do not share administrator tokens with integrations.

## HTTP and database network access

HTTP Request steps accept HTTP/HTTPS only and block loopback, link-local, metadata, private and reserved network destinations by default. DNS answers and redirects are revalidated and the selected address is pinned. Trusted private destinations require an administrator-managed exact-host allowlist; do not add broad wildcards.

SQL connections use configured providers and named bound parameters. Prefer Read Only mode and a database account with minimal grants. Read Only transaction enforcement complements SQL validation; it is not a substitute for database-side least privilege.

## Secrets and artifacts

Stored database credentials are encrypted. Secret variable values and authorization headers are masked in supported summaries; secret-bearing runs suppress screenshots and traces. Screenshot and trace downloads use short-lived, scoped artifact tickets and re-check current project membership. A ticket is still a temporary bearer capability: do not persist it, paste it into public reports, or include it in screenshots/logs. Artifact contents may contain sensitive application data, so use synthetic test data and review run artifacts before sharing. The Compose smoke verified screenshot delivery and opened the Playwright Trace Viewer; the full artifact ticket lifecycle and exhaustive authorization matrix were not covered by that smoke.

## Compose exposure

Compose binds PostgreSQL, Redis, VNC and noVNC host ports to `127.0.0.1` by default. Do not publish those ports directly to the Internet. Put a TLS reverse proxy in front of the frontend/backend and forward only required paths. Keep Docker socket access and volumes restricted to trusted operators.

## Logging and operations

Do not log API tokens, passwords, cookies, authorization headers or raw sensitive request/response bodies. Keep backups encrypted and access-controlled. The 2026-11-09 production dependency audit recorded three Moderate advisories and no High advisories through `@fastify/static` → `glob`/`minimatch`; this is a dated result, not a live audit. See the [release audit](release/release-readiness-audit.md) for the recorded disposition and runtime constraint.
