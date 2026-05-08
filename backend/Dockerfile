FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json

RUN npm ci --workspace=backend --ignore-scripts

COPY backend/ ./backend/
COPY .env.example .env

ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playwright_testing
ENV PLAYWRIGHT_BROWSERS_PATH=0

RUN cd backend && npx prisma generate
RUN cd backend && npx tsc -p tsconfig.json
RUN cd backend && npx playwright install chromium

RUN mkdir -p /app/backend/screenshots /app/backend/traces

EXPOSE 3000

CMD sh -c "cd backend && npx prisma migrate deploy && npx prisma db seed && node dist/index.js"
