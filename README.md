# 🎭 WrightTest

> Low-code UI test automation platform powered by Playwright.  
> Create, record, and run browser tests through a web interface - no code required.

![License](https://img.shields.io/badge/license-source--available-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.59-green)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)
[![Stars](https://img.shields.io/github/stars/AlexFilippov-it/wrighttest?style=social)](https://github.com/AlexFilippov-it/wrighttest/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/AlexFilippov-it/wrighttest)](https://github.com/AlexFilippov-it/wrighttest/commits/main)
[![CI](https://github.com/AlexFilippov-it/wrighttest/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AlexFilippov-it/wrighttest/actions/workflows/ci.yml?query=branch%3Amain)

## ✨ Features

- **Visual Recorder** - click through your app via noVNC, steps captured automatically
- **Smart Locators** - uses `getByRole`, `getByLabel`, `href` instead of fragile CSS paths
- **Assertions Builder** - `toBeVisible`, `toHaveText`, `toHaveURL` and more
- **Mobile Testing** - emulate iPhone 15, Pixel 7, iPad and other devices
- **Environments** - `{{BASE_URL}}`, `{{PASSWORD}}` replaced at runtime per environment
- **Scheduler** - cron-based automatic runs with full history per schedule
- **Suites** - group tests and run them with one click or on schedule
- **Trace Viewer** - built-in Playwright trace viewer after every run
- **Notifications** - Telegram / Slack alerts on FAILED
- **Export** - download tests as `.spec.ts`, run with `npx playwright test`
- **Import** - paste existing Playwright script, get a visual test
- **Dashboard** - pass rate over time and flaky test detection

## How WrightTest compares

| Feature | WrightTest | Cypress | Selenium IDE | Playwright UI |
|---|---|---|---|---|
| No-code recorder | ✅ | ❌ | ✅ | ❌ |
| Docker one-command | ✅ | ❌ | ❌ | ❌ |
| Mobile emulation | ✅ | ⚠️ | ❌ | ✅ |
| Built-in scheduler | ✅ | ❌ | ❌ | ❌ |
| Export to `.spec.ts` | ✅ | ❌ | ❌ | ❌ |
| Self-hosted | ✅ | ✅ | ✅ | ❌ |
| Trace Viewer built-in | ✅ | ❌ | ❌ | ✅ |

## 🚀 Quick Start (Docker-first)

**Requirements:** Docker, Docker Compose

```bash
git clone https://github.com/AlexFilippov-it/wrighttest.git
cd wrighttest

cp .env.example .env
# Edit .env - set JWT_SECRET to a long random string (required)

docker compose up --build
```

| Service | URL |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:3000 |
| noVNC | http://localhost:6080 |

Default admin login is defined in `.env`:

- `ADMIN_EMAIL=admin@wrighttest.com`
- `ADMIN_PASSWORD=changeme`

On an empty database the seed also creates a `Docker Demo` project with two sample tests, a `DEV` environment, a `Smoke Test` suite, and an hourly schedule.

This path is the recommended first launch on any machine. The backend image is built on the Playwright-ready base image and includes the browser bundle, so no host browser or system library setup is required.

## 🤖 AI Quick Start

If you are working with an AI coding agent, start here first:

- [AGENTS.md](./AGENTS.md)

It contains the canonical repo workflow, startup order, and environment rules for WrightTest.

## 🛠 Host Fallback (optional)

Use this only if you want to run the frontend with Vite and the backend on the host.

**Requirements:** Node.js 20+, PostgreSQL 16, Redis 7

```bash
git clone https://github.com/AlexFilippov-it/wrighttest.git
cd wrighttest

cp .env.example .env
# Edit DATABASE_URL for local PostgreSQL

npm install
npm run setup
cd backend && npx prisma migrate dev && npx prisma db seed && cd ..
npm run dev
```

`npm install` now runs a Playwright bootstrap step for Chromium. On Ubuntu/Linux
it will also try to install system dependencies when the terminal session allows
it. If Playwright still cannot launch Chromium, run the same bootstrap manually
and then install Linux deps:

```bash
npm run setup
npx playwright install chromium
sudo npx playwright install-deps chromium
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:3000 |

If the host environment still reports missing Playwright libraries, rerun `npm run setup` once from the repo root. On Ubuntu/Linux this may fall back to `npx playwright install-deps chromium` when needed.

## 🔄 Updating

```bash
git pull
docker compose up --build -d
```

On first launch or after resetting volumes:

```bash
cp .env.example .env
# Make sure JWT_SECRET is set to a long random value
docker compose up --build -d
```

Migrations apply automatically on startup. Existing projects, tests and run history are preserved in the Postgres volume.

## 🔧 Changing Ports

All ports are in `.env` - no hardcoded values in code:

```env
BACKEND_PORT=3001
FRONTEND_PORT=8080
NOVNC_PORT=6081
```

Then restart:

```bash
docker compose up --build -d
```

## 📸 Product Tour

<p align="center">
  <img src="./docs/Screenshot_1.png" alt="Projects overview" width="100%" />
</p>
<p align="center"><em>Projects overview with health summaries, project status, and onboarding.</em></p>

<p align="center">
  <img src="./docs/Screenshot_2.png" alt="Project workspace checks tab" width="49%" />
  <img src="./docs/Screenshot_3.png" alt="Project alerts tab" width="49%" />
</p>
<p align="center"><em>Project workspace with checks, schedules, alerts, and operational summaries.</em></p>

<p align="center">
  <img src="./docs/Screenshot_4.png" alt="Check editor" width="49%" />
  <img src="./docs/Screenshot_6.png" alt="Global runs page" width="49%" />
</p>
<p align="center"><em>Edit browser checks visually and review global execution history across projects.</em></p>

<p align="center">
  <img src="./docs/Screenshot_5.png" alt="Live browser recording" width="100%" />
</p>
<p align="center"><em>Live recording captures Playwright-ready selectors directly from the browser session.</em></p>

## 🏗 Architecture

```text
┌─────────────┐   POST /recordings/start   ┌──────────────────┐
│  noVNC      │ ─────────────────────────▶ │ playwright codegen│
│  (iframe)   │ ◀──── sessionId ─────────  │ headed browser   │
└─────────────┘                            └──────────────────┘
      │ clicks recorded as Steps
      ▼
┌─────────────┐   POST /tests/:id/run      ┌──────────────────┐
│ Step Editor │ ─────────────────────────▶ │ BullMQ + Redis   │
│ + Validate  │                            │ Worker queue     │
└─────────────┘                            └──────────────────┘
      │
Playwright headless
      │
┌─────────────┐   polling GET /runs/:id    ┌──────────────────┐
│ Run Result  │ ◀───────────────────────── │ Screenshots      │
│ Trace Viewer│                            │ Traces           │
└─────────────┘                            └──────────────────┘
```

## 📦 Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Ant Design |
| Backend | Node.js + Fastify + TypeScript |
| ORM | Prisma + PostgreSQL |
| Queue | BullMQ + Redis |
| Runner | Playwright (Chromium) |
| VNC | noVNC + Xvfb + x11vnc |
| Auth | JWT + bcrypt |
| Container | Docker Compose |

## 📋 Roadmap

- [ ] Network mocking (`page.route()`)
- [ ] CLI tool (`wrighttest run --project-id`)
- [ ] Export full Playwright project
- [ ] Test-to-Doc export
- [ ] Allure / TestIT integration

## 📦 Docker Image

The Docker image badge will be added after the first public image publish.

## 📄 License

WrightTest is source-available, but not open-source under the OSI definition.

You may use, copy, modify, and run WrightTest for personal, educational,
research, internal, and evaluation purposes, including testing your own
applications, websites, services, or products.

You may not sell WrightTest as a standalone product or offer WrightTest, or a
modified version of WrightTest, as a public hosted service without prior written
permission.

See [LICENSE](./LICENSE) for details.
