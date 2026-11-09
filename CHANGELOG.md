# Changelog

## Unreleased (release-candidate draft; public version not selected)

- Added project-scoped database connections and SQL steps, typed project/runtime variables, data-driven checks, and sequential Suite Runs with explicit variable handoff.
- Added HTTP Request steps with assertions and capture, plus MCP API-token, project/check/suite/run and browser-exploration tools.
- Improved responsive application surfaces, Check editing and Run Results, interface localization, and user-facing diagnostics.
- Hardened artifact access, browser/API egress validation, secret handling, and production runtime configuration.
- Release gates are not yet closed: see `docs/release/release-readiness-audit.md` and `docs/release/release-checklist.md` before assigning a public release version.

## 0.3.0 - 2026-11-03

- Unified the application shell, content surfaces, status treatments, and responsive layouts.
- Refined the login page and localized the interface in English and Russian, including instance-wide language selection and import/export of custom language packs.
- Improved translation validation and corrected Overview period labels and layout behavior.
- Stabilized E2E authentication setup and added isolated release validation for Docker Compose and existing E2E/integration scenarios.
- Updated vulnerable runtime dependencies within the supported major versions where possible.

### Historical advisory note for 0.3.0

This section described the 0.3.0 audit snapshot and is not the current advisory inventory. As of 2026-11-09, `npm audit --omit=dev` reports 3 Moderate and 0 High through `@fastify/static` → `glob`/`minimatch`; see the current release audit for the scoped disposition. No forced upgrade was applied.
