# Release Regression Matrix

Run date: 2026-11-08. This table reports Phase 8.2 evidence only; historical Phase 8.1 results are not silently counted as current reruns. Test infrastructure was disposable and isolated from the working DB and user-owned containers.

| Area | Command / scenario | Result | Evidence / limits |
|---|---|---|---|
| Backend | `npx tsc --noEmit -p backend/tsconfig.json` | PASS | Node 20.20.0; exit 0 after HTTP pinned-DNS lookup fix. |
| Frontend | `npx tsc --noEmit -p frontend/tsconfig.json`; `npm run build -w frontend` | PASS | TypeScript passed; production build passed with the known large-chunk warning. |
| E2E typing | `npm run test:e2e:typecheck` | PASS | Passed after current project/localization smoke edits. |
| i18n | `npm run i18n:check` | PASS | 1,334 English/Russian messages, interpolation and UI literal scan. |
| Prisma | `npx prisma validate --config backend/prisma.config.ts`; isolated `prisma migrate deploy` | PASS | Schema valid; 24 migrations ran on a unique disposable PostgreSQL database. Working local DB was not migrated. |
| Backend unit | `npm run test:unit -w backend` | PASS with skips | 99 passed, 0 failed, 3 skipped on isolated PostgreSQL. The 3 skipped cases are mixed worker/provider integrations covered only partially by separate provider tests. |
| PostgreSQL / MySQL | `node --test` provider integration via disposable PostgreSQL 16 and MySQL 8.4 | PASS | 2/2 provider cases passed, including SELECT/write, bound parameters, captures/assertions, redaction, invalid credentials, SSL/timeout and read-only enforcement. No production DB was used. |
| HTTP request | `tsx --test backend/tests/http-request.test.ts` | PASS | Node single-address and `all:true` DNS lookup overloads pass; HTTP capture/assertion, secret redaction, missing variables and URL policy tests passed (7/7 at direct run). |
| HTTP + SQL / schedule | `npm run test:e2e:isolated:integration -- e2e/tests/integration/api-testing.integration.spec.ts` | PASS | 1 integration test passed for existing HTTP-to-SQL and HTTP schedule workflow. This is not the full mixed Browser/SQL/HTTP workflow. |
| Suite reliability | isolated Suite reliability integration | PASS | 4 tests passed for existing retry/idempotency, cancellation, parallel isolation and Independent behavior. Does not cover every Phase 8.2 fault cut point. |
| Worker restart | isolated `suite-worker-restart.integration.spec.ts` | PASS | 2 tests passed with a separately launched worker and disposable Redis/DB. Exactly-once effects in external systems are not guaranteed. |
| Sequential / Independent | Suite integration plus Compose Sequential Suite | PARTIAL | Sequential execution and handoff/restart evidence passed. Full A→B→C→D HTTP/SQL/Browser/cleanup scenario and complete Independent parallel-run isolation matrix were not run. |
| Schedules | API testing integration; isolated Compose scenario | PARTIAL | HTTP scheduled execution passed. Browser + SQL schedule matrix, repeated occurrence idempotency, scheduler restart/time-zone and delete/disable cases remain unverified. |
| Mixed Check | Generate → HTTP → SQL → Browser → HTTP cleanup | SKIPPED | Not executed as a single Check. Component-level HTTP/SQL and browser smoke evidence does not substitute for this workflow. |
| RBAC / IDOR | Existing backend route tests, MCP tests, UI Owner/Editor/Viewer smoke | PARTIAL | Selected project/variable/database-connection/artifact and role behavior covered. No confirmed bypass in tested paths; exhaustive per-object CRUD/run/get-secret and post-removal matrix not run. |
| MCP security | MCP tests/build and tool registry inspection | PARTIAL | 16/16 MCP tests passed. 32 registered tools (23 core, 9 browser). Not every tool was tested under all four role/access states. |
| Artifact security | Existing artifact-route/path unit tests and actual Chromium Trace Viewer test | PARTIAL | Ticket auth, cross-project denial, old URL rejection, byte ranges, path traversal/symlink and browser viewer access have prior passing regression evidence. Compose screenshot preview and trace viewer were not validated after the runtime run; full revoked-member/expired-ticket matrix was not rerun in this pass. |
| Docker build | `docker compose build backend frontend novnc` | PASS | Frontend/backend/noVNC images built locally; no Docker cache cleanup. |
| Docker Compose runtime | Unique project/volumes: health, login, create project/check, run Browser + HTTP checks, run Sequential Suite, restart backend and verify persisted API access | PASS | All stated runtime steps passed on disposable project resources. Screenshot preview and Trace Viewer artifact retrieval remain unverified in Compose. User-owned containers/volumes were not stopped or removed. |
| Full UI E2E | `WRIGHTTEST_E2E_KEEP_ARTIFACTS=1 npm run test:e2e:isolated` | PASS | Final isolated smoke: 19/19 passed. Covered AppShell/responsive foundation, project creation, project navigation, Check editor, Runs/details, Owner/Editor/Viewer roles, project variables, localization and routing. Earlier repeated-run failures exposed project-list synchronization flakiness and a fail-open Check Editor for a Viewer while role data was unresolved; the smoke now waits for loaded/list state, and the editor now grants write access only to confirmed OWNER/EDITOR or system admin. |
| Authentication throttling | Full UI logs and backend route config | PASS / NOT REPRODUCED | Login route remains 10 requests/5 minutes. Observed 429 came from the general global API cap during full smoke, fixed only in disposable harness with `RATE_LIMIT_MAX=1000`; no production setting was changed. |
| Security advisories | `npm audit --omit=dev` | PARTIAL | 3 Moderate, 0 High through `@fastify/static` → `glob` → `minimatch`; see audit/known limitations. |
| Git hygiene | `git diff --check`; scoped diff and secret review | PASS | Runtime E2E outputs use unique temporary directories. Existing user modifications remain in the worktree and must not be staged with the Phase 8.2 changes. |
| GitHub Actions | CI / Release Validation | SKIPPED | No remote workflow was triggered. |

`PASS` applies only to the exact command/scenario listed. `PARTIAL` and `SKIPPED` are not release passes.
