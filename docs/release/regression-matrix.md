# Release Regression Matrix

Run date: 2026-11-08. This matrix records actual Phase 8 validation only; earlier Phase 7 results are historical and are not counted as this run.

| Area | Required scenario | Result | Evidence / notes |
|---|---|---|---|
| Backend | TypeScript | Passed | Node 20.20.0; `tsc --noEmit -p backend/tsconfig.json`, exit 0 after artifact-route changes and updated `tsx`. |
| Frontend | TypeScript and production build | Passed with warning | Frontend tsc and production build passed on Node 20.20.0. Initial JS chunk 1,622.23 kB minified / 497.37 kB gzip; TestEditor route chunk 671.63 kB. Vite retains chunk-size warning; before/after delta not measured. |
| i18n | `npm run i18n:check` | Passed | 1,334 English/Russian messages, interpolation, usage, and literal scan consistent. |
| MCP | TypeScript, build and tests | Passed | Build, test typecheck; 16/16 tests, including scoped artifact links and secret/path redaction. |
| Prisma | Schema validation and isolated migrations | Passed | `prisma validate` passed; 24 migrations deployed to a uniquely named database on the disposable PostgreSQL service. |
| Backend unit | Isolated suite | Passed with skips | 98 passed, 0 failed, 3 provider-dependent tests skipped; unique `wrighttest_unit_*` DB, disposable PostgreSQL/Redis, generated test queue prefix. |
| HTTP | Methods, assertions, capture, SSRF and redirects | Passed unit coverage | Covered typed variables, POST/response assertions/capture, secret masking, missing variable, private target and redirect rejection. Not all network policy edges were tested. |
| SQL | PostgreSQL and MySQL | Partial | SQL policy/binding unit tests passed. Provider integration cases (PostgreSQL, MySQL, mixed worker) were skipped; MySQL service not run. |
| Queue/Suite | Retry, cancellation, restart, handoff | Partial | Existing coordinator/unit scenarios passed as part of backend suite. Real worker restart, schedules, and full recovery matrix not run in this pass. |
| Artifacts | Screenshot/trace access and Trace Viewer | Passed | Invalid ticket 401; cross-project ticket denied 404; screenshot 200; trace range 206; old public artifact routes 404. Real Chromium Trace Viewer loaded the trace through the expiring ticket. Path traversal and symlink escape unit cases passed. |
| RBAC/MCP | Project isolation and secret-safe results | Partial | Artifact cross-project denial and existing backend RBAC tests passed; MCP 16/16 including permission failures and safe artifact links. Full API IDOR E2E across all object types not run. |
| E2E | Smoke and integration | Partial / blocked | Showcase responsive and keyboard-focus/contrast tests passed 2/2 on correctly configured Vite. Project create and Russian localization were blocked in global setup by dedicated `/auth/login` HTTP 429 after repeated test runs; those specs did not execute in this final attempt. |
| Docker | Backend/frontend image build | Passed | Docker daemon 29.8.0; `docker compose build backend frontend` passed against final source/lockfile using ephemeral build-only required secrets. Both local images were built, including Prisma Client, backend TypeScript, frontend Vite bundle, Chromium and WebKit. No services or volumes were started. |
| Security | `npm audit --omit=dev` and full dependency audit | Partial | Production audit: 3 Moderate, 0 High. Full audit: same 3 Moderate, 0 Low after `tsx@4.23.15` brought `esbuild@0.28.2`. High findings from the prior audit are absent after Hono 2.1.6 and scoped `deepmerge-ts` 8.0.2 update. Moderate `@fastify/static` → glob/minimatch remain due Node 20 compatibility constraint; see audit. MCP workspace audit reports 0 vulnerabilities. |
| CI | GitHub Actions | Not run | Workflow now provisions disposable PostgreSQL and Redis, installs Chromium, validates Prisma, and runs backend/frontend/MCP checks. No remote workflow run was triggered. |
| Git hygiene | `git diff --check`, secret/artifact review | Passed with worktree changes retained | `git diff --check` passed. No production secrets were added; builds used dummy process-local values. Existing user-owned modifications and untracked files remain unstaged. |

Skipped, blocked, or partial rows are not release passes. GitHub Actions were not triggered from this local audit.
