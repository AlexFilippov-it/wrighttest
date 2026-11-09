# RBAC / IDOR Security Gate 1

Audit date: 2026-11-09\
Branch: `codex/mcp-browser-exploration`\
Base: `70117c4`\
Overall result: **PARTIAL**. One confirmed authorization defect was fixed and covered by an isolated database-backed route test. The full endpoint × role × MCP runtime matrix has not been executed; source inspection is not reported as runtime proof.

## Runtime evidence

`backend/tests/rbac-idor.integration.test.ts` runs through `backend/scripts/test-with-isolated-db.mjs`, which provisions and migrates a disposable PostgreSQL database. The test creates separate Owner, Editor, Viewer and other-project Owner identities and sends requests through Fastify route injection. It verified:

| Scenario | Result | Observable effect |
|---|---|---|
| Editor imports a `.spec.ts` check into an accessible project | PASS | HTTP 201 and one Check created |
| Viewer imports into that project | PASS | HTTP 403; no additional Check |
| Owner of another project imports into the target project | PASS | HTTP 403; no additional Check |
| Editor membership is revoked, then import is attempted | PASS | HTTP 403; no additional Check |
| Request without the test authentication identity | PASS | HTTP 401 from the test harness hook |

The authentication case above verifies the route harness boundary, not the production JWT/API-token verifier. The complete backend unit suite after the fix: **100 passed, 0 failed, 3 skipped**. Skipped cases are opt-in integrations and are not counted as passes.

## Confirmed finding and remediation

| Finding | Severity | Affected endpoint | Status |
|---|---|---|---|
| Authenticated users could import a check into a project without active membership or write role. The route looked up the project but did not authorize the caller before parsing and inserting the Check. | High: cross-project unauthorized write; no evidence of direct execution or secret disclosure through this route | `POST /projects/:projectId/import` | Fixed locally in `backend/src/routes/export.ts`; regression in `backend/tests/rbac-idor.integration.test.ts` |

The route now derives the user from the authenticated request and requires `OWNER` or `EDITOR` for the target project before import processing or writes. It uses the existing `requireProjectRole` helper and standard access error mapping. No global role policy was changed.

## Backend endpoint inventory

There are **95 route registrations** in `backend/src/routes` at this audit revision. The table records route families, actual access policy observed in handlers, and validation status. `Source reviewed` means code-path inspection only. `Runtime partial` means only listed cases were sent as actual requests. It does not imply every method/role/ID combination passed.

| Route family | Routes / methods | Observed access policy | Coverage |
|---|---|---|---|
| Authentication | `/auth/api-tokens` GET/POST, `/auth/api-tokens/:id` DELETE, `/auth/login` POST, `/auth/logout` POST, `/auth/me` GET, `/auth/change-password` POST, `/users/exists` GET | API token routes are tied to authenticated caller; login/public existence behavior is intentionally separate. Global preHandler validates auth on protected routes. | Source reviewed |
| Projects and members | `/projects` GET/POST; `/projects/:id` GET/PATCH/DELETE; `/projects/:id/members` GET/POST; member PATCH/DELETE | Project reads require membership; mutation/member management is Owner-only; project creation is restricted to protected system-admin identity. | Source reviewed |
| Checks | `/projects/:projectId/tests` GET/POST; `/tests/:id` GET/PATCH/DELETE; `/tests/validate` POST; `/devices` GET | Reads permit Owner/Editor/Viewer; writes and validation require Owner/Editor. Execution is in Runs. | Source reviewed |
| Suites and SuiteRuns | project suite list/create; suite update/delete/run; project SuiteRun list; SuiteRun get/cancel | Reads permit project members; create/update/delete/run/cancel require Owner/Editor. Suite check IDs are validated against project. | Source reviewed |
| Runs and artifacts | check run/all-cases/list; run and batch result GET; artifact ticket GET | Run/result reads require project membership; starting runs requires Owner/Editor. Artifact-ticket path additionally re-checks ticket user membership. | Source reviewed; artifact matrix incomplete |
| Schedules/history | project schedule list/create; schedule history/list; schedule PATCH/DELETE | Read is project-member scoped; mutation requires Owner/Editor. | Source reviewed |
| Environments | project list/create; environment PATCH/DELETE | Read permits members with Viewer redaction; writes require Owner/Editor. | Source reviewed |
| Project variables | project list/create; variable PATCH/DELETE | Read is membership scoped and secrets are redacted by role; mutations require Owner/Editor, with stricter secret-write policy for Owner. | Source reviewed; existing tests cover selected redaction/write cases |
| Database connections | project list/create; connection GET/PATCH/DELETE/test | Read is membership scoped and credentials are redacted; mutation and connection test require Owner/Editor. | Source reviewed; existing tests cover selected access/redaction cases |
| Project authentication | project auth GET/PUT/refresh/DELETE by project/environment | Read allows project members; changes and refresh require Owner/Editor; referenced environment/check ownership is validated. | Source reviewed |
| Alert channels | project list/create/test; channel test/PATCH/DELETE by channel ID | Read is member scoped; mutation and test actions require Owner/Editor based on the channel's owning project. | Source reviewed |
| Browser sessions | session create/navigate/snapshot/click/fill/select/screenshot/wait/close | Owner/Editor required; session ownership and project authorization are checked per operation. | Source reviewed |
| Recordings | start/stop/get | Owner/Editor required against the recording's project. | Source reviewed |
| Import/export | test export, project export, project import | Export requires Owner/Editor. Import now requires Owner/Editor before any write. | Import runtime partial; exports source reviewed |
| Localization | public catalog; instance locale/template/export/validate/apply/settings/delete | Public catalog intentionally unauthenticated; administration checks protected system-admin identity. | Source reviewed |
| Dashboard | dashboard aggregate GET routes | User-scoped project IDs are derived server-side from accessible memberships. | Source reviewed |
| Webhook | `/webhooks/trigger` POST | Public trigger endpoint is intentionally separate and relies on webhook-specific validation/secrets. | Source reviewed; needs dedicated webhook abuse review |

### Required IDOR scenarios

| Scenario | Result |
|---|---|
| Import into inaccessible project, Viewer write, membership revocation | PASS, exact endpoint test above |
| Get/update/run foreign Check; foreign Run/SuiteRun; foreign Schedule/Variable/Connection | NOT RUN as a consolidated actor matrix; handlers source-reviewed |
| Foreign screenshot/trace, ticket alteration/expiry/revoked member | NOT RUN in this gate; prior artifact tests exist but do not constitute this full matrix |
| Mismatched project and nested resource IDs, mass assignment across every write route | NOT RUN comprehensively |
| System Admin explicit exceptions across all routes | NOT RUN comprehensively |

## MCP registry inventory

The source registers **32 tools** (23 core and 9 browser tools). MCP forwards calls with the caller's API token to backend endpoints; role enforcement should occur in those endpoints. The table lists all registered tools. `Source reviewed` is not a successful Owner/Editor/Viewer request matrix. The existing MCP suite has 16 tests, but it uses mocked backend responses and does not establish per-role backend authorization.

| MCP tool | Backend operation | Expected authorization / data policy | Gate evidence |
|---|---|---|---|
| `list_projects` | `GET /projects` | Authenticated caller; only accessible projects | Source reviewed |
| `get_project` | `GET /projects/:id` | Owner/Editor/Viewer membership | Source reviewed |
| `create_project` | `POST /projects` | Protected system admin only | Source reviewed; MCP mocked tests exist |
| `update_project` | `PATCH /projects/:id` | Owner only | Source reviewed |
| `list_checks` | `GET /projects/:projectId/tests` | Owner/Editor/Viewer membership | Source reviewed |
| `get_check` | `GET /tests/:id` | Owner/Editor/Viewer membership | Source reviewed |
| `create_check` | `POST /projects/:projectId/tests` | Owner/Editor | Source reviewed; MCP mocked tests exist |
| `update_check` | `PATCH /tests/:id` | Owner/Editor | Source reviewed; MCP mocked tests exist |
| `list_suites` | `GET /projects/:projectId/suites` | Owner/Editor/Viewer membership | Source reviewed |
| `create_suite` | `POST /projects/:projectId/suites` | Owner/Editor; nested Checks must belong to project | Source reviewed |
| `add_check_to_suite` | `PATCH /suites/:id` | Owner/Editor; Check membership validated | Source reviewed |
| `run_check` | `POST /tests/:id/run` | Owner/Editor | Source reviewed |
| `run_suite` | `POST /suites/:id/run` | Owner/Editor | Source reviewed |
| `get_suite_run` | `GET /suite-runs/:id` | Owner/Editor/Viewer membership | Source reviewed |
| `cancel_suite_run` | `POST /suite-runs/:id/cancel` | Owner/Editor | Source reviewed |
| `get_run_status` | `GET /runs/:id` | Owner/Editor/Viewer membership | Source reviewed |
| `get_run_results` | `GET /runs/:id` | Owner/Editor/Viewer; secret masking applies | Source reviewed; mocked response tests exist |
| `browser_start` | `POST /browser-sessions` | Owner/Editor; scoped session | Source reviewed |
| `browser_navigate` | `POST /browser-sessions/:id/navigate` | Owner/Editor and session owner | Source reviewed |
| `browser_snapshot` | `GET /browser-sessions/:id/snapshot` | Owner/Editor and session owner | Source reviewed |
| `browser_click` | `POST /browser-sessions/:id/click` | Owner/Editor and session owner | Source reviewed; mocked test exists |
| `browser_fill` | `POST /browser-sessions/:id/fill` | Owner/Editor and session owner | Source reviewed |
| `browser_select` | `POST /browser-sessions/:id/select` | Owner/Editor and session owner | Source reviewed |
| `browser_screenshot` | `GET /browser-sessions/:id/screenshot` | Owner/Editor and session owner | Source reviewed |
| `browser_wait` | `POST /browser-sessions/:id/wait` | Owner/Editor and session owner | Source reviewed |
| `browser_close` | `DELETE /browser-sessions/:id` | Owner/Editor and session owner | Source reviewed |
| `list_database_connections` | `GET /projects/:projectId/connections` | Owner/Editor/Viewer; credential redaction | Source reviewed |
| `get_database_connection` | `GET /connections/:id` | Owner/Editor/Viewer; credential redaction | Source reviewed |
| `list_project_variables` | `GET /projects/:projectId/variables` | Owner/Editor/Viewer; secret redaction | Source reviewed |
| `create_project_variable` | `POST /projects/:projectId/variables` | Owner/Editor; secret writes Owner-only | Source reviewed |
| `update_project_variable` | `PATCH /variables/:id` | Owner/Editor; secret-write policy | Source reviewed |
| `delete_project_variable` | `DELETE /variables/:id` | Owner/Editor | Source reviewed |

## Limits and next gate

This is not a release security sign-off. No production or working database was used. The route regression ran on isolated PostgreSQL. The following remain open: comprehensive endpoint × role actor matrix; runtime role-denial and side-effect tests for all MCP-backed operations; anonymous/API-token verification against the full server; complete nested-ID/mass-assignment checks; artifact ticket lifecycle matrix; and dedicated webhook abuse testing. Do not mark Security Gate 1 complete until these are exercised and recorded.
