# AI Onboarding Guide

This file is the canonical starting point for coding agents and LLMs working on this repository.

## What this project is

WrightTest is a low-code Playwright testing platform:

- Frontend: React + TypeScript + Vite + Ant Design
- Backend: Fastify + TypeScript
- Data: PostgreSQL + Prisma
- Queue: BullMQ + Redis
- Runner: Playwright Chromium
- Docker mode: PostgreSQL + Redis + backend + frontend + noVNC

## First files to read

Read in this order:

1. `AGENTS.md`
2. `README.md`
3. `.env.example`
4. `docker-compose.yml`
5. `package.json`
6. `backend/package.json`
7. `frontend/package.json`
8. `backend/src/index.ts`
9. `backend/src/services/recorder.ts`
10. `backend/src/queue/worker.ts`
11. `backend/src/routes/tests.ts`
12. `frontend/src/pages/TestEditorPage.tsx`

## Startup order

Choose one path and follow it fully.

### Docker first

Use this when you want the full stack, including noVNC:

1. Copy `.env.example` to `.env`
2. Keep ports in `.env` only
3. Run `docker compose up --build`
4. Check `docker compose ps`
5. Verify `http://localhost:80`
6. Verify `http://localhost:3000/health`
7. Verify `http://localhost:3000/health/db`
8. Verify `http://localhost:6080`

### Local development first

Use this for fast iteration on macOS:

1. Copy `.env.example` to `.env`
2. Set `FRONTEND_PORT=5173` for local Vite dev
3. Make sure PostgreSQL 16 and Redis 7 are running locally
4. Run `npm install` in the repo root
5. Run Prisma migration and seed from `backend`
6. Run `npm run dev`
7. Verify `http://localhost:5173`
8. Verify `http://localhost:3000/health`
9. Verify `http://localhost:3000/health/db`

## Environment rules

- Ports must come only from `.env`
- Do not hardcode ports in code
- Do not introduce a second env source inside `backend/`
- `DATABASE_URL` must come from the root `.env`
- Docker paths for artifacts are `backend/screenshots` and `backend/traces`
- Docker recorder uses `DISPLAY` and noVNC

## Runtime model

- `frontend` serves the UI and talks to the backend via `VITE_BACKEND_URL`
- `backend` exposes `/health`, `/health/db`, CRUD routes, validate routes, run routes, and recording routes
- `worker.ts` runs Playwright jobs and persists results to Prisma
- `recorder.ts` captures user interactions and returns steps to the editor

## Important gotchas

- On macOS, headed recording can use a native browser window
- In Docker, headed recording must use Xvfb + noVNC
- Some selectors are ambiguous by design; use validation before save
- When a selector breaks, inspect `selectorCandidates` before changing the worker
- Runtime artifacts must not be committed

## Safe change workflow

When changing behavior:

1. Read the relevant files
2. Update backend and frontend contracts together
3. Keep TypeScript types aligned
4. Run `tsc --noEmit` for both workspaces if the change touches shared contracts
5. Verify the minimal happy path with `curl` or the browser

## Do not do this

- Do not push or commit unless explicitly asked
- Do not rewrite user changes
- Do not change ports outside `.env`
- Do not add hardcoded localhost URLs unless they are fallback defaults already used by the app
- Do not remove Docker support when editing local dev flows

