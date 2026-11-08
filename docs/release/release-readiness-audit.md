# WrightTest Release Readiness Audit

Audit date: 2026-11-08
Checkout: `codex/mcp-browser-exploration` at `a2e77618a71a47208850b9c64e906bded76fbbba`
Scope: Phase 8 review. Findings below distinguish code evidence from checks not yet run.

## Findings

| Severity | Component | Evidence and impact | Status / next action |
|---|---|---|---|
| High | Screenshots and Playwright traces | Previous public artifact routes allowed retrieval without project authorization. | Fixed in working tree: artifact bytes are served only by `/api/artifacts` using a five-minute signed ticket bound to user, project, run, kind, and screenshot index. The handler rechecks membership and the run-to-project relation, confines files to storage, rejects symlink escapes, and supports byte ranges. The Playwright viewer shell remains public but contains no user trace data. Backend regression test exercises screenshot, cross-project denial, old URL denial, range download, and real viewer loading. |
| High | Prisma CLI dependency chain | The earlier production audit included High findings through Prisma configuration dependencies. Prisma and Prisma Client remain on 6.19.3; no proposed Prisma downgrade was applied. | High advisories no longer appear in current `npm audit --omit=dev`. A scoped `@prisma/config` override moves `deepmerge-ts` to 8.0.2; isolated migrations, seed, validation, and backend tests pass. Keep the override under compatibility monitoring. |
| Medium | Public webhook | An unset webhook secret previously disabled signature verification, allowing unauthenticated job creation. | Fixed in working tree: endpoint fails closed with 503 unless a non-placeholder >=32-character secret is configured; HMAC SHA-256 signatures are compared in constant time. Regression tests added. |
| Medium | Production secret defaults | JWT had a built-in fallback; Compose supplied `changeme` and default database credentials, and published internal services on all host interfaces. | Fixed in working tree: production config rejects weak JWT/admin/encryption secrets; Compose requires PostgreSQL/admin secrets and binds PostgreSQL, Redis, VNC and noVNC host ports to loopback. |
| Medium | Dependency advisories | Current production audit reports 3 Moderate advisories through `@fastify/static@10.1.3` → `glob@13.0.7` → `minimatch@10.2.6`; it reports 0 High. Full audit's prior Low finding for `esbuild` was dev-only and is fixed by `tsx@4.23.15` / `esbuild@0.28.2`. The static server now serves only trusted Playwright viewer assets, not user artifacts. | Residual risk documented. npm's fixed `@fastify/static@10.1.10` pulls `content-disposition@3`, whose declared engine is Node >=22; project runtime baseline is Node 20. Do not silently raise runtime baseline or force an engine-incompatible package. Reassess when Node 22 adoption is approved. |
| Medium | E2E authentication throttling | `/auth/login` has a dedicated limit of 10 requests per 5 minutes (`backend/src/routes/auth.ts`), independent of the general API limit. Repeated E2E global setup attempts with new state directories miss cached sessions and receive HTTP 429 with a 2-minute retry window. | Product protection was not weakened. Showcase UI tests pass; current project/localization rerun was blocked in global setup before those specs executed. Reuse persistent isolated auth state or wait for the limiter window in a clean E2E run. |
| Medium | Frontend initial bundle | Lazy page imports split route modules. Current Vite output still has a 1,622.23 kB minified initial JS chunk (497.38 kB gzip), plus a 671.73 kB TestEditor chunk. | Build passes, but Vite still warns about the >500 kB chunk. A comparable pre-change build was not produced in this run, so size reduction is not claimed. |
| Low | Test/runtime version | System Node is 18.20.8; checks were run with installed Node 20.20.0, matching the runtime family used by CI/Docker. | Node 20 TypeScript/build/test checks listed in the regression matrix completed. |
| Medium | Clean Compose install | Docker build and a new isolated Compose project succeeded. PostgreSQL, Redis, backend, frontend and noVNC became healthy; migrations ran, login succeeded, and project/check creation was exercised. | Full check execution, restart persistence, schedules, MySQL, and complete browser/API/SQL/Suite workflow were not completed. No existing Docker data was cleaned. |

## Security review evidence

- Core project routes have existing role guards; Phase 8.1 added artifact-specific cross-project IDOR coverage. A complete endpoint-by-endpoint IDOR matrix across every object type remains outstanding.
- HTTP Request code validates HTTP(S), resolves and checks all DNS answers, pins the chosen address, checks redirects, strips cross-origin credentials, and blocks private/loopback/reserved destinations unless the server-side host allowlist permits a private hostname. Backend unit tests passed; production SSRF scenarios were not exhaustively exercised in this pass.
- Database connections use bound parameters and provider-specific read-only transaction protections in addition to SQL validation. Provider-backed PostgreSQL/MySQL integration cases were skipped in the backend suite; MySQL was not started for this phase.
- Secret-bearing runs suppress trace and screenshot creation in the worker; artifact access additionally requires a scoped, expiring ticket and current project membership.
- MCP reuses backend APIs and RBAC. Build, test typecheck, and all 16 MCP tests passed, including permission-denial and safe-artifact-link cases; no new MCP tools were added. Full authorization coverage for all 30 tools remains part of the broader regression phase.
- Backend unit suite completed with 98 passed, 0 failed, and 3 provider-dependent tests skipped on disposable PostgreSQL/Redis. The trace regression launches the actual Playwright Trace Viewer in Chromium and observes its artifact request; the browser's service-worker request must be observed at BrowserContext level.
- Local CI workflow changes were type/build checked where applicable, but GitHub Actions were not run in this audit.

## Verdict

`NOT READY`: no High advisories remain in the current production audit, and artifact access is protected, but 3 Moderate runtime advisories remain and full endpoint-by-endpoint RBAC/IDOR, provider integration, broad E2E, and Docker build evidence are not all complete. Phase 8.1 checks do not imply overall release readiness; Phase 8.2 and 8.3 remain separate gates.
