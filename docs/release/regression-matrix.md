# Release Regression Matrix

Run date: 2026-11-09. Phase 8.2 evidence is labeled as historical where applicable. Current Phase 8.3 reruns are identified explicitly. Test infrastructure was disposable and isolated from the working DB and user-owned containers.

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
| Sequential / Independent | Suite integration plus Compose Sequential Suite | PARTIAL | Sequential execution, handoff, and worker-restart evidence passed. Mixed Check passed independently; the complete Independent parallel-run isolation matrix was not part of this smoke. |
| Schedules | API testing integration; isolated Compose scenario | PARTIAL | HTTP scheduled execution passed. Browser + SQL schedule matrix, repeated occurrence idempotency, scheduler restart/time-zone and delete/disable cases remain unverified. |
| Mixed Check | Generate → HTTP POST → SQL SELECT/assertion → Browser assertion → HTTP DELETE → SQL cleanup assertion | PASS | Isolated integration Check; all 7 steps passed and temporary token was absent from serialized Run Results. |
| RBAC / IDOR | Existing backend route tests, MCP tests, UI Owner/Editor/Viewer smoke | PARTIAL | Selected project/variable/database-connection/artifact and role behavior covered. No confirmed bypass in tested paths; exhaustive per-object CRUD/run/get-secret and post-removal matrix not run. |
| MCP security | MCP tests/build and tool registry inspection | PARTIAL | 16/16 MCP tests passed. 32 registered tools (23 core, 9 browser). Not every tool was tested under all four role/access states. |
| Artifact delivery smoke | Retrieve screenshot and trace from isolated Compose run; open Trace Viewer | PASS, scoped | Screenshot HTTP 200; trace byte-range HTTP 206; viewer rendered timeline/actions/screenshot. Full ticket lifecycle and authorization matrix remains unverified; do not infer it from successful retrieval. |
| Artifact security | Existing artifact-route/path unit tests and actual Chromium Trace Viewer test | PARTIAL | Prior tests cover ticket auth, cross-project denial, old URL rejection, byte ranges and path traversal/symlink. This smoke adds real Compose delivery/viewer proof, but does not rerun the full revoked-member/expired-ticket matrix. |
| Docker build | `docker compose build backend frontend novnc` | PASS | Frontend/backend/noVNC images built locally; no Docker cache cleanup. |
| Docker Compose runtime | Unique project/volumes: health, login, create project/check, run Browser + HTTP checks, run Sequential Suite, restart backend and verify persisted API access | PASS | All stated runtime steps passed on disposable project resources; the separate Final Smoke also verified screenshot and trace delivery. User-owned containers/volumes were not stopped or removed. |
| Full UI E2E | `WRIGHTTEST_E2E_KEEP_ARTIFACTS=1 npm run test:e2e:isolated` | PASS | Final isolated smoke: 19/19 passed. Covered AppShell/responsive foundation, project creation, project navigation, Check editor, Runs/details, Owner/Editor/Viewer roles, project variables, localization and routing. Earlier repeated-run failures exposed project-list synchronization flakiness and a fail-open Check Editor for a Viewer while role data was unresolved; the smoke now waits for loaded/list state, and the editor now grants write access only to confirmed OWNER/EDITOR or system admin. |
| Authentication throttling | Full UI logs and backend route config | PASS / NOT REPRODUCED | Login route remains 10 requests/5 minutes. Observed 429 came from the general global API cap during full smoke, fixed only in disposable harness with `RATE_LIMIT_MAX=1000`; no production setting was changed. |
| Security advisories | `npm audit --omit=dev` | PARTIAL | 3 Moderate, 0 High through `@fastify/static` → `glob` → `minimatch`; see audit/known limitations. |
| Git hygiene | `git diff --check`; scoped diff and secret review | PASS | Runtime E2E outputs use unique temporary directories. Existing user modifications remain in the worktree and must not be staged unintentionally. |
| GitHub Actions | CI / Release Validation | SKIPPED | No remote workflow was triggered. |

## Final Release Smoke (2026-11-09)

| Area | Scenario | Result | Evidence / limits |
|---|---|---|---|
| Mixed Check | Generate → HTTP POST → SQL SELECT/assertion → Browser assertion → HTTP DELETE → SQL cleanup assertion | PASS | All 7 steps passed; temporary token was not present in serialized Run Results. |
| Schedule / Suite | Schedule execution and Sequential Suite smoke | PASS | These are the requested basic paths, not a full recurrence/timezone or all-failure-policy matrix. |
| Worker restart | Terminate Suite worker during Check 2 and start replacement; exercise startup recovery | PASS, 2/2 | No duplicate completed Check; run recovered to terminal status. Does not promise exactly-once external side effects. |
| Compose artifacts | Fetch screenshot and trace; open Trace Viewer | PASS, scoped | Screenshot HTTP 200, trace byte range HTTP 206; viewer rendered timeline/actions/screenshot. Ticket lifecycle security matrix remains partial. |
| Docker Compose | Build backend/frontend/noVNC; isolated stack health and app checks | PASS | Disposable project resources removed afterward; working database and other containers untouched. |
| Security Gate 1 | Check import authorization regression | PARTIAL | Confirmed bug fixed and tested; comprehensive route/MCP matrix is an accepted known limitation, not release sign-off. |
| GitHub Actions | CI / Release Validation | NOT RUN | No remote workflow was triggered. |

## Phase 8.3 Reruns (2026-11-09)

| Area | Command / scenario | Result | Evidence / limits |
|---|---|---|---|
| Backend unit | `npm run test:unit -w backend` | PASS with skips | 99 passed, 0 failed, 3 skipped. Isolated DB name was unique to this run and migrations/seed completed. |
| Opt-in DB integrations | PostgreSQL/MySQL provider integration plus worker integration, using disposable target services and unique queue namespace | PASS, separately | Provider tests 2/2 and worker test 1/1 passed. The combined integration-flag full suite was not green: its private-target opt-in conflicts with the loopback-block unit test, and concurrent worker execution caused queue contention on an initial attempt. Serial rerun passed the worker integration and `failed-run-trace`; do not report the combined run as passing. |
| UI E2E | `npm run test:e2e:isolated` | PASS | 19/19 passed in 3.7 minutes. Unique database/backend port; includes role UI, localization, project/check navigation, refresh/history and responsive foundation checks. |
| Backend/frontend TS | `npx tsc --noEmit -p backend/tsconfig.json`; `npx tsc --noEmit -p frontend/tsconfig.json` | PASS | Both exited 0 on current checkout. |
| E2E typecheck | `npm run test:e2e:typecheck` | PASS | Exit 0. |
| MCP | `npm run build -w mcp-server`; `npm test -w mcp-server` | PASS | Build succeeded; 16/16 tests passed. Registry contains 32 tools (23 core + 9 browser), but no per-tool × role matrix was run. |
| Frontend build | `npm run build -w frontend` | PASS with warning | Vite production build succeeded; initial JS chunk remains ~1.62 MB minified. |
| i18n | `npm run i18n:check` | PASS | 1,334 English/Russian messages. |
| Prisma | `npx prisma validate --config backend/prisma.config.ts` | PASS | Current schema valid. |
| npm audit | `npm audit --omit=dev` | PARTIAL | 3 Moderate, 0 High through `@fastify/static` → `glob`/`minimatch`; no forced update. |
| Docker artifact E2E | Unique Compose screenshot/trace lifecycle, authorization, expiry, range and restart matrix | NOT RUN | Prior Phase 8.2 Compose runtime did not validate screenshot/trace retrieval. Mandatory release gate remains open. |
| Mixed Check | Generate → HTTP → SQL → Browser → HTTP cleanup in one Check | NOT RUN | Component-level evidence is not equivalent to this end-to-end scenario. |
| RBAC/MCP matrix | Per-object CRUD/run/read/export/secret checks across Owner, Editor, Viewer, other project, revoked and anonymous contexts | NOT RUN | Route review and selected tests only; no complete IDOR matrix. |
| Schedules/recovery | Browser/HTTP/SQL schedules, scheduler restart, cancellation race and recovery matrix | PARTIAL | Selected HTTP schedule and worker/Suite reliability evidence is historical; the full requested matrix was not rerun in Phase 8.3. |
| CI | GitHub Actions CI and Release Validation | NOT RUN | Push/PR not authorized; no workflow was claimed as passed. |

`NOT RUN` is an open gate, not a pass. The combined DB integration command failure is recorded separately from the passing targeted integration tests.

## Security Gate 1 (2026-11-09)

| Area | Scenario | Result | Evidence / limits |
|---|---|---|---|
| RBAC / import IDOR | Editor allowed; Viewer denied; other-project Owner denied; removed Editor denied; no denied request created a Check | PASS | New isolated PostgreSQL Fastify integration test. Before the authorization fix, the Viewer case returned success and failed the regression. |
| Full route and role matrix | 95 backend route registrations inventoried; authorization policy reviewed by route family | PARTIAL | Inventory and the exact missing runtime cases are in `docs/release/rbac-idor-matrix.md`; source review is not runtime proof. |
| MCP inventory | 32 registered tools enumerated and mapped to backend operations / expected roles | PARTIAL | Existing 16 MCP tests mock backend calls. No full tool-by-role live authorization matrix was run. |
| Backend unit | `npm run test:unit -w backend` | PASS with skips | 100 passed, 0 failed, 3 opt-in integrations skipped by default. |
| UI smoke | `npm run test:e2e:isolated` | PASS | 19/19 passed against a separate disposable PostgreSQL/backend. Includes UI role flows; it is not proof of authorization for every API endpoint. |

`PASS` applies only to the exact command/scenario listed. `PARTIAL` and `SKIPPED` are not release passes.
