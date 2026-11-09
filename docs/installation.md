# Installation Guide

## Requirements

- Node.js 20 for local development and CI.
- Docker Engine with Docker Compose V2 for the full container stack.
- PostgreSQL 16 and Redis 7 for local development outside Docker.
- 8 GB RAM recommended for browser workers; Docker builds may require several GB of temporary disk space.

## Docker Compose

1. Clone the repository and copy `.env.example` to `.env`.
2. Generate unique secrets. Use `openssl rand -hex 32` for `JWT_SECRET`, `DATABASE_CREDENTIALS_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, and (if using webhooks) `WEBHOOK_SECRET`. `DATABASE_CREDENTIALS_ENCRYPTION_KEY` must be exactly 32 bytes encoded as 64 hex characters; use at least 32 random bytes for the other secrets.
3. Set `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `DATABASE_CREDENTIALS_ENCRYPTION_KEY` in `.env`. Never commit `.env`.
4. Set the public frontend/API/noVNC URLs appropriate to the deployment. Behind a reverse proxy, configure it to route the frontend, `/api` backend paths, and `/vnc/` to noVNC; use `VITE_NOVNC_URL=/vnc`.
5. Start with `docker compose up --build -d --wait` and inspect `docker compose ps` and service logs.
6. Verify `http://localhost:${BACKEND_HOST_PORT}/health` and `/health/db`, then sign in with the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

The source Compose file builds the backend, frontend and noVNC images from the checked-out source. It uses PostgreSQL 16 and Redis 7 upstream images. The default app ports come from `.env.example`; update the `*_HOST_PORT` values in `.env` when those host ports are already in use.

### Docker Hub images

`docker-compose.hub.yml` pulls the three WrightTest application images instead of building them. Use the same `.env` setup, then run:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d --wait
```

Set `WRIGHTTEST_IMAGE_NAMESPACE` and `WRIGHTTEST_IMAGE_TAG` in `.env` to pin the images. As of 2026-11-09, Docker Hub has `0.3.0` and `latest` tags for backend, frontend and noVNC; `0.4.0` has not been published. Do not select the `0.4.0` tag until the images are published.

### Windows checkout and shell scripts

The repository includes `.gitattributes` rule `*.sh text eol=lf`. Git therefore checks container shell scripts out with LF line endings even when Windows Git is configured with `core.autocrlf=true`; this prevents `/bin/sh^M` and similar startup errors in Linux containers. This fix is included in PR #8 by contributor `hendricktlv`. If an existing clone already contains CRLF copies, make a backup and re-clone or re-check out the affected scripts after updating the repository before rebuilding.

Database, Redis and VNC/noVNC host ports bind to loopback by default. Keep them off public interfaces; expose only frontend/reverse-proxy entry points. Containers still communicate over the private Compose network.

The backend runs Prisma migrations and seed initialization as part of startup. Do not point a first-time install at an existing database without a verified backup and migration plan.

## Local development

Run PostgreSQL 16 and Redis 7 locally, configure root `.env` with `DATABASE_URL`, `REDIS_HOST`, and `REDIS_PORT`, then run `npm ci`, `npm run prisma:generate -w backend`, `npm run dev`. The backend and Vite frontend default to ports 3000 and 5173. Local development does not run the production secret validator.

## Updates and backup

Back up PostgreSQL and the Compose volumes for screenshots, traces and authentication state before upgrades. Pull the intended source/image version, review its release notes, apply migrations, then start services and verify health before routing user traffic. Restore into an isolated environment first when validating backups. No automatic rollback of schema migrations is promised.

For source-based upgrades, update the Git checkout and run `docker compose up --build -d --wait`. For Docker Hub upgrades, set the intended already-published `WRIGHTTEST_IMAGE_TAG`, then run `docker compose -f docker-compose.hub.yml pull` and `docker compose -f docker-compose.hub.yml up -d --wait`. A merged Git version does not imply that its Docker images have been published.

## MCP

The local MCP server uses stdio and an API token. Follow [MCP Server](mcp-server.md); keep the token in the client secret store/environment, never in Git.

## Troubleshooting

- Missing-secret startup error: set unique production secrets; placeholders are rejected.
- Webhook returns 503: configure a unique `WEBHOOK_SECRET` and send an HMAC SHA-256 signature.
- noVNC connection failure: verify `VITE_NOVNC_URL`, proxy `/vnc/` and websocket forwarding.
- Browser worker failure: verify backend, Redis, noVNC health and available shared memory.
- Disk pressure: inspect `docker system df -v` and host disk usage first. Do not run prune commands against a shared Docker host without reviewing ownership.
