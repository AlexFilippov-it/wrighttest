# Changelog

## 0.3.0 - 2026-11-03

- Unified the application shell, content surfaces, status treatments, and responsive layouts.
- Refined the login page and localized the interface in English and Russian, including instance-wide language selection and import/export of custom language packs.
- Improved translation validation and corrected Overview period labels and layout behavior.
- Stabilized E2E authentication setup and added isolated release validation for Docker Compose and existing E2E/integration scenarios.
- Updated vulnerable runtime dependencies within the supported major versions where possible.

### Remaining dependency advisories

`npm audit --omit=dev` still reports advisories in the Prisma 6 `deepmerge-ts` chain and the `glob`/`minimatch` chain under `@fastify/static`. Prisma loads `deepmerge-ts` while reading the repository-owned `backend/prisma.config.ts` during migration/seed startup; the vulnerable recursive-object case is not constructed from HTTP/API input. `@fastify/static` calls `glob` only when configured with `wildcard: false`; WrightTest uses the default wildcard route and does not expose static plugin options or glob patterns to users. These findings remain in the dependency audit and should be reevaluated when upgrading Prisma/static dependencies, but no externally reachable path to the vulnerable input conditions was found for this release.
