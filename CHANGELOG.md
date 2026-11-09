# Changelog

## 0.4.0 - 2026-11-09

- Added HTTP/API testing with response assertions and capture, project database connections and SQL steps, typed variables, data-driven Checks, and sequential Suite Runs with explicit variable handoff.
- Added a local stdio MCP server with 32 tools for project, Check, Suite, run, project-variable, database-connection metadata, and browser-exploration workflows.
- Improved responsive application surfaces, Check editing, Run Results, interface localization, and step-level diagnostics.
- Hardened artifact delivery, browser/API egress validation, secret handling, and production runtime configuration.
- Added `.gitattributes` rule `*.sh text eol=lf` via contributor `hendricktlv` to keep container shell scripts LF on Windows checkouts with `core.autocrlf=true`.
- PR #9 CI and Release Validation passed before merge; CI and Release Validation also passed on the resulting `main` merge commit. Release smoke evidence and accepted limitations are recorded in `docs/release/release-readiness-audit.md`, `docs/release/regression-matrix.md`, and `docs/release/known-limitations.md`.
- Published as GitHub Release [`v0.4.0`](https://github.com/AlexFilippov-it/wrighttest/releases/tag/v0.4.0); Docker Hub publish workflow completed for backend, frontend, and noVNC (`0.4.0` and `latest` tags).

## 0.3.0 - 2026-11-03

- Unified the application shell, content surfaces, status treatments, and responsive layouts.
- Refined the login page and localized the interface in English and Russian, including instance-wide language selection and import/export of custom language packs.
- Improved translation validation and corrected Overview period labels and layout behavior.
- Stabilized E2E authentication setup and added isolated release validation for Docker Compose and existing E2E/integration scenarios.
- Updated vulnerable runtime dependencies within the supported major versions where possible.

### Historical advisory note for 0.3.0

This section described the 0.3.0 audit snapshot and is not the current advisory inventory. As of 2026-11-09, `npm audit --omit=dev` reports 3 Moderate and 0 High through `@fastify/static` → `glob`/`minimatch`; see the current release audit for the scoped disposition. No forced upgrade was applied.
