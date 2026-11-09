# Docker Hub Description Draft

This repository documents the WrightTest Docker Hub image set. The current Hub tags were checked on 2026-11-09.

## Images

- `sacha1bu/wrighttest-backend`
- `sacha1bu/wrighttest-frontend`
- `sacha1bu/wrighttest-novnc`

PostgreSQL and Redis are upstream images and are not included in the WrightTest image set:

- `postgres:16-alpine`
- `redis:7-alpine`

All three WrightTest images currently expose `0.3.0` and `latest` tags. The `0.4.0` tag is not available yet; a Git merge alone does not publish images. Set `WRIGHTTEST_IMAGE_TAG` only to a tag present in all three repositories.

## Run

Clone the repository, configure the root `.env` from `.env.example`, set unique `JWT_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, and `DATABASE_CREDENTIALS_ENCRYPTION_KEY` values, then start the prebuilt stack:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d --wait
```

The Compose file reads `WRIGHTTEST_IMAGE_NAMESPACE` and `WRIGHTTEST_IMAGE_TAG` from `.env`. Keep PostgreSQL, Redis, VNC and noVNC ports bound to loopback unless a deployment design explicitly requires otherwise. See the [Installation Guide](../installation.md) for initial setup, updates, health checks, reverse-proxy configuration, and backup guidance.

## Version publishing

The `docker-publish.yml` GitHub Actions workflow publishes the three application images when a GitHub Release is published. For a `v0.4.0` GitHub Release, it creates `0.4.0` and `latest` tags. Do not show `0.4.0` as available on Docker Hub until those workflow runs succeed and the tags are visible in all three repositories.
