# WrightTest Docker Images

WrightTest is a low-code UI test automation platform powered by Playwright.

- Website: https://wrighttest.com
- GitHub repository: https://github.com/AlexFilippov-it/wrighttest
- Documentation: https://github.com/AlexFilippov-it/wrighttest#readme
- Live demo: https://demo.wrighttest.com

WrightTest is published as a multi-container stack:

- `sacha1bu/wrighttest-backend` - API, scheduler, BullMQ worker, and Playwright runner.
- `sacha1bu/wrighttest-frontend` - React web UI served by nginx.
- `sacha1bu/wrighttest-novnc` - noVNC desktop bridge for headed browser recording.
- `postgres:16-alpine` - official PostgreSQL image.
- `redis:7-alpine` - official Redis image.

WrightTest application images currently target `linux/amd64`. Apple Silicon hosts require Docker emulation.

## Run From Docker Hub

```bash
git clone https://github.com/AlexFilippov-it/wrighttest.git
cd wrighttest

cp .env.example .env
# Set JWT_SECRET to a long random string.

docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

Open:

- App: http://localhost:5173
- API health: http://localhost:3000/health
- noVNC: http://localhost:6080

## Configuration

Set these values in `.env` before starting:

```env
JWT_SECRET=replace-with-a-long-random-string
ADMIN_EMAIL=admin@wrighttest.app
ADMIN_PASSWORD=change-me
VITE_BACKEND_URL=http://localhost:3000
VITE_NOVNC_URL=http://localhost:6080
```

For server deployments behind a reverse proxy, set `FRONTEND_URL`, `VITE_BACKEND_URL`, and `VITE_NOVNC_URL` to the public URLs users should reach from the browser.

## Source And License

The source code is available on GitHub:

https://github.com/AlexFilippov-it/wrighttest

WrightTest is source-available under the WrightTest Source-Available License v1.0. See the repository license before offering WrightTest as a hosted service or commercial product.
