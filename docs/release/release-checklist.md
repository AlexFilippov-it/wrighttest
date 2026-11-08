# Release Checklist

Current status: **NOT READY**. Phase 8.1 artifact controls and High-advisory remediation are validated, but moderate production advisories and broader regression gates remain.

## Security

- [x] Replace public screenshot/trace delivery with scoped, expiring artifact access compatible with the Trace Viewer.
- [x] Resolve High Prisma configuration dependency advisory without changing Prisma 6.19.3; verify isolated migration/seed and backend tests.
- [x] Upgrade the vulnerable MCP runtime `@hono/node-server` and verify lockfile/audit output.
- [x] Fix the Low dev-only esbuild advisory by updating compatible `tsx` resolution to 4.23.15 / esbuild 0.28.2.
- [ ] Resolve or formally accept the 3 remaining Moderate `@fastify/static` / `glob` / `minimatch` advisories. The currently fixed static package requires Node 22 through `content-disposition@3`; current runtime baseline is Node 20.
- [x] Fail closed when webhook signing secret is missing or placeholder.
- [x] Reject insecure production JWT, administrator password and credential-encryption configuration.
- [x] Bind PostgreSQL, Redis and VNC/noVNC published ports to loopback by default.
- [ ] Run full RBAC/IDOR and SSRF regression beyond unit coverage; artifact cross-project access and current HTTP destination unit coverage passed.

## Runtime and regression

- [x] Run backend/frontend/MCP TypeScript and frontend production build on Node 20; Vite retains the known large-chunk warning.
- [x] Run backend unit suite on disposable PostgreSQL + Redis (98 passed, 0 failed, 3 provider-dependent skips).
- [x] Run MCP build, test typecheck, and tests (16 passed).
- [x] Validate Prisma schema and run all 24 migrations/seed against a disposable PostgreSQL database.
- [x] Verify actual Chromium Trace Viewer load against an authorized trace ticket.
- [ ] Run provider-backed PostgreSQL worker integration and MySQL integration.
- [ ] Run disposable MySQL provider integration.
- [ ] Run Browser/API/SQL mixed Check and Sequential Suite E2E.
- [ ] Verify worker recovery, schedules, cancellation and restart on isolated infrastructure.
- [x] Build backend/frontend Docker images against final source/lockfile (passed; no services or volumes started).
- [x] Prior Phase 8 isolated Compose health/login/project/check creation evidence is recorded in the audit; not repeated in this phase.
- [ ] Execute a Check and verify data persistence after service restart.
- [ ] Review Compose volumes and ensure cleanup only targets the isolated project.
- [x] Review `git diff --check`; final changed-file/secret/artifact exclusion review remains before any later publication.

## Release preparation

- [ ] Review user, installation and security guides against shipped behavior.
- [ ] Complete regression matrix with actual outcomes.
- [ ] Resolve all Critical/High findings or explicitly defer release.
- [ ] Obtain release approval before tag, registry publication or deployment.
