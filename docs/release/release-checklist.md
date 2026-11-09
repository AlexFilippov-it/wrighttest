# Release Checklist

Current status: **RELEASE CANDIDATE PREPARATION** (2026-11-09). PR #8 is merged; CI and Release Validation passed on the merge commit. Security Gate 1 remains PARTIAL and three Moderate advisories remain. This is not a claim that a GitHub Release or Docker Hub images have been published.

## Security

- [x] Replace public screenshot/trace delivery with scoped, expiring artifact access and current membership checks.
- [x] Keep production authentication rate limit unchanged; isolated UI harness uses a separate higher global API limit only for its disposable backend.
- [x] Keep HTTP DNS resolution pinned after checking all resolved addresses; regression covers Node single-address and `all:true` lookup callback forms.
- [x] Run PostgreSQL/MySQL provider integration with disposable services, including real read-only enforcement and secret redaction.
- [x] Record Security Gate 1 as **PARTIAL**: confirmed Check-import IDOR fixed and regression-tested. Full endpoint × role and all-32-MCP-tool matrix is an accepted known coverage limitation for this self-hosted open-source release; do not describe it as a full release sign-off.
- [ ] Complete artifact security matrix in Docker Compose for expired tickets, removed members, altered kind/run IDs, path escape, cache/referrer headers, logs, range requests and restart persistence.
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
- [x] Validate Compose screenshot and Trace Viewer delivery in the isolated runtime: screenshot HTTP 200, trace byte range HTTP 206, viewer timeline/actions/screenshot visible. Full artifact-ticket lifecycle and authorization matrix remains open.
- [x] Run isolated mixed Check: Generate → HTTP → SQL → Browser → cleanup; all 7 steps passed. Full Sequential/Independent handoff matrix remains broader than this smoke.
- [ ] Complete broad schedule recurrence, scheduler restart, timezone, cancellation and idempotency scenarios.
- [x] Confirm full UI E2E after project-list loading synchronization; final run passed 19/19. The same ordered regression run exposed and verified the Viewer fail-closed editor fix.
- [x] Rerun backend unit suite: 100 passed, 0 failed, 3 opt-in integration cases skipped by default after adding the RBAC import regression. All three opt-in cases passed separately on disposable services (PostgreSQL/MySQL 2/2; worker 1/1); combined flagged suite is not green due test-mode incompatibility with the loopback policy unit case and earlier queue contention.
- [x] Rerun isolated UI E2E (2026-11-09): 19/19 passed in 3.7 minutes.
- [x] Rerun backend/frontend TypeScript, E2E typecheck, MCP build/tests (16/16), frontend build, Prisma validate and `i18n:check` (1,334 messages).
- [ ] Run complete isolated recovery matrix for every coordinator crash/cancel/retry cut point and Redis reconnect.

## Release Preparation

- [x] Review README, installation, user, MCP, database and security guide claims against the measured feature/smoke scope; local Markdown links resolve. Recheck time-sensitive release/dependency facts before publication.
- [x] Update the Phase 8.3 audit, regression matrix, checklist, changelog draft and known limitations with measured results.
- [x] Recorded production dependency audit dated 2026-11-09: 0 High (3 Moderate); this result is historical and detailed reachability/risk disposition remains required before stable release.
- [x] No confirmed Critical/High defect was found in the executed smoke scope. This is not equivalent to exhaustive security coverage; Gate 1 remains PARTIAL.
- [ ] Re-run current dependency audit and required CI workflows before publishing; the previous audit recorded 3 Moderate advisories and 0 High, which may change over time.
- [x] Merge PR #8 with the contributor's original commit preserved; the current `main` CI passed on merge commit `1a3119b`.
- [x] Confirm Release Validation run [42592608099](https://github.com/AlexFilippov-it/wrighttest/actions/runs/42592608099) passed on the PR #8 merge commit.
- [ ] Publish the v0.4.0 GitHub Release and Docker Hub tags only after explicit release approval; the three image repositories currently have no `0.4.0` tag.
- [ ] Obtain release approval before tag, registry publication or deployment.
