FROM mcr.microsoft.com/playwright:v1.61.0-jammy

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="WrightTest Backend" \
      org.opencontainers.image.description="Backend API, scheduler, BullMQ worker, and Playwright runner for WrightTest." \
      org.opencontainers.image.url="https://wrighttest.com" \
      org.opencontainers.image.source="https://github.com/AlexFilippov-it/wrighttest" \
      org.opencontainers.image.documentation="https://github.com/AlexFilippov-it/wrighttest#readme" \
      org.opencontainers.image.licenses="WrightTest Source-Available License v1.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY shared/ ./shared/

RUN npm ci --workspace=backend --ignore-scripts

COPY backend/ ./backend/
COPY .env.example .env

ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playwright_testing
ENV PLAYWRIGHT_BROWSERS_PATH=0

RUN cd backend && npx prisma generate
RUN cd backend && npx tsc -p tsconfig.json
RUN cd backend && npx playwright install chromium webkit

RUN mkdir -p /app/backend/screenshots /app/backend/traces

EXPOSE 3000

# TypeScript output lives under dist/src because the backend tsconfig compiles from src/.
CMD sh -c "cd backend && npx prisma migrate deploy && npx prisma db seed && node dist/src/index.js"
