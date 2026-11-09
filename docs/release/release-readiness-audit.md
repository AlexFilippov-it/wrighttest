# WrightTest Release Readiness Audit

Audit date: 2026-11-09

Checkout: `codex/mcp-browser-exploration` at `8267e0e` (working tree contains user changes and Final Release Smoke evidence)
Scope: local release preparation after Final Release Smoke. No remote Git synchronization, GitHub Actions, release, or deployment was performed.

## Findings

| Severity | Component | Evidence and impact | Status / next action |
|---|---|---|---|
| Fixed in working tree | Check Editor Viewer access | A full ordered UI run confirmed that a Viewer could see enabled Check editing/running controls while project-role data had not loaded. The API returned `currentUserRole: VIEWER`; the editor's old UI guard only denied an explicit Viewer role and therefore failed open for an unresolved role. | Write access now requires confirmed OWNER/EDITOR or system admin. The Viewer UI smoke passes; this frontend guard supplements, but does not replace, backend authorization. |
| Known limitation | RBAC / IDOR coverage | Security Gate 1 fixed the confirmed Check-import authorization defect; the import regression test passes for Editor and denies Viewer, cross-project Owner, and revoked member without writes. | Gate 1 remains **PARTIAL** by explicit scope decision. A full per-operation matrix across 95 route registrations and 32 MCP tools is not release sign-off and is not being pursued without a concrete critical signal. |
| Closed for smoke | Mixed Check workflow | Isolated integration Check executed Generate → HTTP POST → SQL SELECT/assertion → Browser assertion → HTTP DELETE → SQL cleanup assertion. | All 7 steps passed; the temporary token was absent from serialized Run Results. This proves the exercised flow, not every HTTP/SQL/browser combination or policy. |
| Medium | Production dependency advisories | `npm audit --omit=dev` reported 3 Moderate advisories through `@fastify/static@10.1.3` → `glob@13.0.7` → `minimatch@10.2.6`; 0 High. | Unchanged. The currently fixed upstream static version brings a Node >=22 engine constraint, while supported runtime is Node 20. Reassess after a deliberate runtime upgrade. |
| Medium | E2E request limiting | Full UI suite exceeded the default global API limit during repeated project/localization requests. `/auth/login` uses its separate 10-per-5-minute route limit. | Isolated E2E process now uses `RATE_LIMIT_MAX=1000` only for its disposable backend; the authentication route limit is unchanged and no production setting or `.env` was modified. Final full-suite result is recorded in the regression matrix. |
| Closed for smoke | Docker Compose artifacts | Unique Compose project passed health, login, project creation, Browser Check, HTTP Check, Sequential Suite, backend restart, and post-restart API checks. | Screenshot retrieval returned HTTP 200; trace retrieval supported HTTP 206 byte ranges; Playwright Trace Viewer opened with timeline, actions, and screenshot. Full artifact-ticket lifecycle/security matrix remains untested. |
| Medium | Schedules / worker recovery | Isolated HTTP schedule, Suite reliability, worker restart/recovery tests and disposable Compose restart checks ran. | Full matrix of browser/HTTP/SQL scheduled occurrences, scheduler restart/time-zone behavior, cancellation races and all recovery cut points remains outstanding. |
| Known limitation | MCP security coverage | MCP build/tests passed; 32 tools are registered (23 core tools and 9 browser tools). | No exhaustive role/IDOR and secret-disclosure runtime matrix was run for every tool. Existing backend RBAC remains the enforcement layer; this coverage limitation is documented and is not being expanded absent a concrete critical signal. |
| Medium | Trace console message | The Trace Viewer opened and rendered the recorded timeline, actions, and screenshot. | One console message was emitted while replaying a `data:` URL because it cannot serve as a document base URL; this did not block trace viewing. |
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

## Final Release Smoke Evidence (2026-11-09)

- Docker Compose configuration and local builds for backend, frontend, and noVNC passed. A uniquely named isolated stack became healthy; backend `/health` and `/health/db`, frontend, noVNC, and basic authentication were verified. Its containers, volumes, and temporary env file were removed; the working `.env`, database, and unrelated containers were not touched.
- The full mixed Check passed all 7 steps: Generate → HTTP POST → SQL SELECT/assertion → Browser assertion → HTTP DELETE → SQL cleanup assertion. The temporary token did not appear in Run Results.
- Schedule and Sequential Suite smoke passed. Existing API integration covered the Check Editor and Run Results UI path.
- Dedicated worker restart and startup recovery checks passed 2/2: a Suite worker was terminated during the second Check, then replaced; completed Checks were not duplicated and the Suite reached a terminal result.
- Screenshot retrieval returned HTTP 200. Trace retrieval returned HTTP 206 for a byte-range request. The Playwright Trace Viewer rendered timeline, actions, and screenshot. The retained viewer screenshot is `output/playwright/release-smoke/docker-trace-viewer.png`; it contains only the viewer area and no temporary artifact-ticket URL. The artifact ticket lifecycle matrix remains outside this smoke.
- E2E TypeScript and `git diff --check` passed. The isolated test ran on Node 20.20.0; Node 23.9.0 failed in the Playwright loader before test execution, so it is not counted as a test failure or pass.
- Security Gate 1 remains **PARTIAL** as an accepted coverage limitation. This smoke did not run GitHub Actions, the complete artifact-ticket matrix, or every schedule/recovery combination.

## Phase 8.3 Evidence (2026-11-09)

- Backend unit suite rerun with `npm run test:unit -w backend`: 99 passed, 0 failed, 3 intentionally skipped integration cases. The skipped tests are the PostgreSQL provider case, MySQL provider case (`database-connections.integration.test.ts`, gated by `WRIGHTTEST_DATABASE_INTEGRATION=1`) and mixed browser/SQL worker case (`database-worker.integration.test.ts`, gated by `WRIGHTTEST_DATABASE_WORKER_INTEGRATION=1`). All three were separately executed against disposable services and passed: provider tests 2/2 and worker integration 1/1. A combined run with the private-address integration opt-in is not a valid full-suite command because the ordinary loopback SSRF unit case correctly expects loopback to remain blocked; an initial concurrent worker attempt also exposed test queue contention. A serial integration rerun passed the worker and failed-run-trace tests. Do not mark the combined flagged suite as PASS.
- Isolated UI E2E rerun: `npm run test:e2e:isolated`, 19/19 passed in 3.7 minutes on a unique database and backend port.
- Current-run checks: backend/frontend TypeScript, E2E typecheck, MCP TypeScript build, MCP tests (16/16), frontend production build, Prisma validation and `i18n:check` (1,334 messages) passed. Frontend build retains the known large-chunk warning.
- Current `npm audit --omit=dev`: 3 Moderate, 0 High, all through `@fastify/static` → `glob`/`minimatch`. The candidate fix is outside the declared dependency range; no forced upgrade was applied. Older changelog text naming Prisma `deepmerge-ts` is stale for this lockfile and must not be used as the current advisory inventory.
- API route review found consistent OWNER/EDITOR write/run guards and read-only access for project viewers across the inspected route groups. This was source inspection, not the required account-by-account API/MCP IDOR matrix. The 32 MCP tools (23 core and 9 browser) have 16 automated tests, not a per-tool/per-role test matrix. Gate remains open.
- At the Phase 8.3 checkpoint, the mixed Check, Compose artifact retrieval, complete schedule/recovery matrix, and GitHub Actions were not yet verified; the subsequent Final Release Smoke section records the first three requested smoke scenarios and confirms that CI remains unrun.
- README and installation/user/MCP/database/security guides were checked for local links and consistency with the measured smoke scope. Screenshot originals are real 1440×900 captures listed in the capture manifest; the workflow/report dates identify them as captured on 2026-11-04, not as images recaptured during Final Smoke. Existing user-owned changes remain in the worktree and are not staged.

## Verdict

`FINAL SMOKE: PASS; RELEASE PREPARATION: CONDITIONAL`. The requested Compose, mixed Check, screenshot/trace viewer, Schedule, Sequential Suite, and worker-restart smoke scenarios passed. Security Gate 1 remains **PARTIAL** by explicit scope decision, not a full release sign-off. Three Moderate production dependency advisories remain; the full artifact-ticket lifecycle, broad scheduler/recovery matrix, and live GitHub Actions have not been verified in this pass. README and guides still require final consistency review before any publication. No Critical/High advisory was reported by the dated npm audit; re-run before publication because that result can become stale.
