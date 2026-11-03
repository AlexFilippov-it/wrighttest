# WrightTest UI E2E

This suite is a characterization layer for the current WrightTest UI. It protects existing behavior before the design-system and AppShell redesign; it does not redefine navigation, permissions, recorder lifecycle, or Playwright execution.

## Prerequisites

- Root `.env` contains working `ADMIN_EMAIL` and `ADMIN_PASSWORD` values.
- PostgreSQL and Redis are available to the backend.
- Chromium is installed for Playwright.
- The command can reuse an existing frontend/backend or start both development servers automatically.

Optional reusable member credentials can be configured with:

```env
E2E_EDITOR_EMAIL=e2e-editor@wrighttest.app
E2E_VIEWER_EMAIL=e2e-viewer@wrighttest.app
E2E_MEMBER_PASSWORD=wrighttest-e2e-password
```

The suite creates a temporary project, check, and project memberships through the public API. The project is deleted after the worker finishes. The two reusable login accounts remain in the local test database because WrightTest intentionally has no user-deletion API.

## Base smoke suite

```bash
npm run test:e2e
```

The base suite covers:

- Login, Dashboard, Projects, and global browser history.
- Project creation and opening.
- Registered project routes and project sections.
- Check opening and unsaved form editing.
- Runs and Run Details with deterministic browser-network fixtures.
- Owner, Editor, and Viewer action visibility.

Runs/Run Details use synthetic API responses only for run data. Project creation, project/check loading, and project roles use the real local backend. Session revalidation and secondary empty project collections are fulfilled in the browser test layer to keep the smoke suite below the backend's production rate limit; the Login scenario still exercises the real `/auth/login` endpoint.

## Real worker integration

```bash
npm run test:e2e:integration
```

This additionally queues a real check and waits for the BullMQ/Playwright worker. It requires Redis, worker startup, and an installed Playwright Chromium browser.

## Real recorder integration

```bash
E2E_RECORDER=1 npm run test:e2e:integration
```

The recorder test is opt-in because it launches the real headed recorder. On macOS it requires headed browser support. In Docker it requires `DISPLAY`, Xvfb, and noVNC/websockify services. The test always attempts to stop a session that it successfully starts.

## Known current limitations

The `known-limitations.spec.ts` tests are intentionally marked `fixme` and reported as skipped:

- Most project tabs do not update the URL, so refresh and Back/Forward do not preserve them.
- Direct project Alerts and Members routes are not fully registered.
- Standalone and embedded project sections do not have identical role-aware behavior.

These are existing product limitations and are not changed by this E2E preparation step.
