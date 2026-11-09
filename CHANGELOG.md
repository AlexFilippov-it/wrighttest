# Changelog

## 0.4.0 (release candidate; not published)

- Added project database connections and SQL steps, typed runtime/project variables, data-driven Checks, and sequential Suite Runs with explicit variable handoff.
- Added HTTP Request steps with assertions and capture, plus a local stdio MCP server for project, Check, Suite, run, browser exploration, and safe database-connection metadata workflows.
- Improved responsive application surfaces, Check editing, Run Results, interface localization, and step-level diagnostics.
- Hardened artifact delivery, browser/API egress validation, secret handling, and production runtime configuration.
- Final smoke evidence and accepted limitations are recorded in `docs/release/release-readiness-audit.md`, `docs/release/regression-matrix.md`, and `docs/release/known-limitations.md`. No Git tag or GitHub Release has been created.

## 0.3.0 - 2026-11-03

- Unified the application shell, content surfaces, status treatments, and responsive layouts.
- Refined the login page and localized the interface in English and Russian, including instance-wide language selection and import/export of custom language packs.
- Improved translation validation and corrected Overview period labels and layout behavior.
- Stabilized E2E authentication setup and added isolated release validation for Docker Compose and existing E2E/integration scenarios.
- Updated vulnerable runtime dependencies within the supported major versions where possible.

### Historical advisory note for 0.3.0

This section described the 0.3.0 audit snapshot and is not the current advisory inventory. As of 2026-11-09, `npm audit --omit=dev` reports 3 Moderate and 0 High through `@fastify/static` → `glob`/`minimatch`; see the current release audit for the scoped disposition. No forced upgrade was applied.
