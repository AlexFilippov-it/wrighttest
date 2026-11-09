# WrightTest Release Readiness Audit

Audit date: 2026-11-09

Checkout: `codex/mcp-browser-exploration` at `809fc48` (working tree contains user changes and Phase 8.3 validation)
Scope: Phase 8.3 local RC preparation. No remote Git synchronization, GitHub Actions, release, or deployment was performed.

## Findings

| Severity | Component | Evidence and impact | Status / next action |
|---|---|---|---|
| High | Check Editor Viewer access | A full ordered UI run confirmed that a Viewer could see enabled Check editing/running controls while project-role data had not loaded. The API returned `currentUserRole: VIEWER`; the editor's old UI guard only denied an explicit Viewer role and therefore failed open for an unresolved role. | Fixed in working tree: write access now requires confirmed OWNER/EDITOR or system admin. The Viewer UI smoke passes; retain the complete route/MCP authorization matrix as an independent release gate. |
| High | RBAC / IDOR coverage | Existing Owner/Editor/Viewer UI tests and route-level tests cover selected project, variable, connection, MCP, and artifact authorization cases. | No confirmed bypass in executed coverage. A complete per-operation matrix for every object and all MCP tools, including removal/revocation cases, was not executed; release gate remains open. |
| High | Mixed Check workflow | Existing API integration exercises HTTP request/capture with SQL and scheduled HTTP execution. | Full 10-step HTTP → SQL → Browser → HTTP cleanup workflow, including all secret/artifact assertions, was not run end to end. |
| Medium | Production dependency advisories | `npm audit --omit=dev` reported 3 Moderate advisories through `@fastify/static@10.1.3` → `glob@13.0.7` → `minimatch@10.2.6`; 0 High. | Unchanged. The currently fixed upstream static version brings a Node >=22 engine constraint, while supported runtime is Node 20. Reassess after a deliberate runtime upgrade. |
| Medium | E2E request limiting | Full UI suite exceeded the default global API limit during repeated project/localization requests. `/auth/login` uses its separate 10-per-5-minute route limit. | Isolated E2E process now uses `RATE_LIMIT_MAX=1000` only for its disposable backend; the authentication route limit is unchanged and no production setting or `.env` was modified. Final full-suite result is recorded in the regression matrix. |
| Medium | Docker Compose artifacts | Unique Compose project passed real health, login, project creation, Browser Check, HTTP Check, Sequential Suite, backend restart, and post-restart API checks. | Screenshot preview and Trace Viewer artifact access were not fetched and validated inside that Compose run. Do not treat runtime metadata alone as artifact-delivery proof. |
| Medium | Schedules / worker recovery | Isolated HTTP schedule, Suite reliability, worker restart/recovery tests and disposable Compose restart checks ran. | Full matrix of browser/HTTP/SQL scheduled occurrences, scheduler restart/time-zone behavior, cancellation races and all recovery cut points remains outstanding. |
| Medium | MCP security | MCP build/tests passed; 32 tools are registered (23 core tools and 9 browser tools). | No exhaustive role/IDOR and secret-disclosure audit was run for each of the 32 tools. Existing API RBAC remains the enforcement layer; verify all mappings before release. |
| Medium | Browser/API/SQL combination | Provider-specific PostgreSQL and MySQL integration tests passed on disposable services. HTTP-to-SQL integration passed. | Cross-provider mixed workflow with Browser, SQL, HTTP captures and secret-bearing artifacts was not run as one Check. |
| Low | Frontend bundle | Production build passed. Vite still reports a large initial JavaScript chunk (historically ~1.62 MB minified). | Performance limitation, not a confirmed functional failure; compare bundle reports before release if bundle changes. |

## Phase 8.2 Evidence

- Backend and frontend TypeScript checks passed on Node 20.20.0.
- Prisma schema validation passed; isolated migrations used disposable PostgreSQL, not the working database.
- `i18n:check` passed for 1,334 English/Russian messages.
- Backend unit suite passed with 99 tests, 0 failures, and 3 provider/mixed-worker integration skips on an isolated PostgreSQL database. Provider-backed PostgreSQL/MySQL tests were run separately and passed 2/2.
- MCP build, typecheck and tests passed (16/16); no additional tools were added.
- Suite reliability tests passed (4/4), worker restart integration passed (2/2), API testing integration passed (1/1), and provider-specific DB integration passed (2/2), each on isolated infrastructure.
- Docker images for frontend, backend and noVNC built. A uniquely named Compose stack ran health, authentication, project/check creation, Browser Check, HTTP Check, Sequential Suite and backend restart persistence checks. Only resources belonging to those unique test projects were removed.
- The HTTP request transport had a confirmed Node DNS lookup overload mismatch: IP pinning used only the legacy callback form, while Node may request `all: true`. It now supports both contracts; the regression test and backend image rebuild passed without removing DNS pinning or SSRF checks.
- E2E harness screenshot paths now live under its unique temporary root, avoiding writes to shared `output/` and `/tmp` locations.
- Authentication HTTP 429 was not reproduced. The observed full-suite 429 was the general per-process API limit, not the login endpoint. The disposable harness now overrides only that global test-process limit; production and route-specific login limits were not changed.
- The final isolated UI E2E run passed 19/19. It includes Owner/Editor/Viewer smoke, Check editor, project creation/navigation, localization and route refresh/history. Earlier failures exposed project-list synchronization flakiness and the Viewer fail-open described above; both corresponding smoke/guard changes are included in the working tree.

## Phase 8.3 Evidence (2026-11-09)

- Backend unit suite rerun with `npm run test:unit -w backend`: 99 passed, 0 failed, 3 intentionally skipped integration cases. The skipped tests are the PostgreSQL provider case, MySQL provider case (`database-connections.integration.test.ts`, gated by `WRIGHTTEST_DATABASE_INTEGRATION=1`) and mixed browser/SQL worker case (`database-worker.integration.test.ts`, gated by `WRIGHTTEST_DATABASE_WORKER_INTEGRATION=1`). All three were separately executed against disposable services and passed: provider tests 2/2 and worker integration 1/1. A combined run with the private-address integration opt-in is not a valid full-suite command because the ordinary loopback SSRF unit case correctly expects loopback to remain blocked; an initial concurrent worker attempt also exposed test queue contention. A serial integration rerun passed the worker and failed-run-trace tests. Do not mark the combined flagged suite as PASS.
- Isolated UI E2E rerun: `npm run test:e2e:isolated`, 19/19 passed in 3.7 minutes on a unique database and backend port.
- Current-run checks: backend/frontend TypeScript, E2E typecheck, MCP TypeScript build, MCP tests (16/16), frontend production build, Prisma validation and `i18n:check` (1,334 messages) passed. Frontend build retains the known large-chunk warning.
- Current `npm audit --omit=dev`: 3 Moderate, 0 High, all through `@fastify/static` → `glob`/`minimatch`. The candidate fix is outside the declared dependency range; no forced upgrade was applied. Older changelog text naming Prisma `deepmerge-ts` is stale for this lockfile and must not be used as the current advisory inventory.
- API route review found consistent OWNER/EDITOR write/run guards and read-only access for project viewers across the inspected route groups. This was source inspection, not the required account-by-account API/MCP IDOR matrix. The 32 MCP tools (23 core and 9 browser) have 16 automated tests, not a per-tool/per-role test matrix. Gate remains open.
- Current-phase missing release evidence: one full Generate → HTTP → SQL → Browser → HTTP cleanup Check; screenshot/trace delivery and full ticket security matrix in Docker Compose; full schedule/recovery/cancellation matrix; exhaustive RBAC/IDOR tests; and a real GitHub Actions run. Historical Phase 8.2 positive Compose health/login/check/restart evidence does not prove artifact delivery.
- User-owned guide/screenshot/workflow changes remain unstaged and were not rewritten or included. `docs/security.md` is untracked and contains stale statements about public artifact routes and Prisma advisories; review/update it before release rather than treating it as current security documentation.

## Verdict

`NOT READY`: local type/build/i18n/MCP/UI checks passed and all three opt-in backend integrations passed separately on disposable infrastructure. Mandatory Phase 8.3 security and delivery gates remain unverified: exhaustive RBAC/IDOR including all 32 MCP tools, mixed Check, Compose screenshot/trace authorization and ticket lifecycle, broad schedules/recovery matrix, and live CI. Three Moderate advisories remain documented, and user-owned security guide text requires reconciliation. No Critical/High advisory was reported by the current npm audit, but this does not substitute for the missing security matrices.
