# Release Checklist

Current status: **NOT READY**. The final isolated UI E2E smoke passes 19/19 and the confirmed Viewer Check Editor fail-open has been fixed in the working tree. Several release-critical security and end-to-end coverage gates remain incomplete.

## Security

- [x] Replace public screenshot/trace delivery with scoped, expiring artifact access and current membership checks.
- [x] Keep production authentication rate limit unchanged; isolated UI harness uses a separate higher global API limit only for its disposable backend.
- [x] Keep HTTP DNS resolution pinned after checking all resolved addresses; regression covers Node single-address and `all:true` lookup callback forms.
- [x] Run PostgreSQL/MySQL provider integration with disposable services, including real read-only enforcement and secret redaction.
- [ ] Complete endpoint-by-endpoint RBAC/IDOR matrix for every object and operation, including revocation/removal and secret access.
- [ ] Exercise all 32 MCP tools against Owner, Editor, Viewer, cross-project and unauthenticated contexts.
- [ ] Complete artifact security matrix for expired tickets, removed members, altered kind/run IDs, path escape, cache/referrer headers, logs and analytics on current source.
- [ ] Resolve or formally accept 3 remaining Moderate production dependency advisories. Current fixed upstream `@fastify/static` requires Node >=22; supported runtime is Node 20.

## Runtime and Regression

- [x] Backend/frontend TypeScript and E2E typecheck passed on Node 20.
- [x] Full isolated UI E2E smoke passed (19/19), including Owner/Editor/Viewer flows and route smoke.
- [x] Fix confirmed Check Editor fail-open: unresolved project role no longer grants write actions; only confirmed OWNER/EDITOR or system admin can edit/run.
- [x] `i18n:check` passed (1,334 English/Russian messages).
- [x] Prisma validation and isolated migrations passed on disposable PostgreSQL.
- [x] Provider-specific PostgreSQL/MySQL integration passed (2/2).
- [x] MCP build/typecheck/tests passed (16/16); no MCP tools added.
- [x] Suite reliability integration passed (4/4) and isolated worker restart integration passed (2/2).
- [x] HTTP-to-SQL and HTTP schedule integration passed (1/1).
- [x] Backend/frontend/noVNC Docker image builds passed without pruning caches.
- [x] A unique Compose stack ran health, login, project/check creation, Browser Check, HTTP Check, Sequential Suite, backend restart and persisted API checks.
- [ ] Validate screenshot preview and Trace Viewer artifact access in the Compose runtime.
- [ ] Run full mixed HTTP → SQL → Browser Check and full Sequential/Independent handoff matrix.
- [ ] Complete broad schedule recurrence, scheduler restart, timezone, cancellation and idempotency scenarios.
- [x] Confirm full UI E2E after project-list loading synchronization; final run passed 19/19. The same ordered regression run exposed and verified the Viewer fail-closed editor fix.
- [x] Run the full backend unit suite: 99 passed, 0 failed, 3 provider/mixed-worker tests skipped; provider-backed PostgreSQL/MySQL integration passed separately (2/2).
- [ ] Run complete isolated recovery matrix for every coordinator crash/cancel/retry cut point and Redis reconnect.

## Release Preparation

- [ ] Review user, installation and security guides against shipped behavior.
- [x] Update the Phase 8.2 audit, regression matrix, checklist and known limitations with measured results.
- [ ] Resolve all Critical/High findings; none were confirmed in tested paths, but exhaustive coverage remains open.
- [ ] Obtain release approval before tag, registry publication or deployment.
