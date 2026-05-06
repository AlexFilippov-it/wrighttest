# Contributing to WrightTest

Thanks for helping improve WrightTest.

## Before you start

- Read [AGENTS.md](./AGENTS.md) first.
- Follow the Docker-first workflow unless you explicitly need host fallback.
- Keep frontend and backend contracts in sync when changing shared types or API payloads.

## Development

```bash
npm install
docker compose up --build
```

For local frontend iteration, use Vite on `http://localhost:5173`.

## Pull request rules

- Keep changes focused.
- Do not commit runtime artifacts such as traces, screenshots, or Playwright test output.
- Run type-checking before opening a PR:

```bash
npm exec -w backend tsc -- --noEmit -p tsconfig.json
npm exec -w frontend tsc -- --noEmit -p tsconfig.json
```

## Reporting issues

If you hit a startup or validation issue, include:

- the page or route
- the exact step sequence
- the device if one was selected
- the backend trace link if available

## Style

- Prefer small, explicit changes.
- Keep user-facing wording concise and consistent.
- Avoid hardcoding ports or environment-specific paths.
