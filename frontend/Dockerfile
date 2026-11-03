FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY shared/ ./shared/

RUN npm ci --workspace=frontend

COPY frontend/ ./frontend/

ARG VITE_BACKEND_URL=http://localhost:3000
ARG VITE_NOVNC_URL=http://localhost:6080

ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_NOVNC_URL=$VITE_NOVNC_URL

RUN cd frontend && npx vite build

FROM nginx:alpine

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="WrightTest Frontend" \
      org.opencontainers.image.description="React web UI for WrightTest." \
      org.opencontainers.image.url="https://wrighttest.com" \
      org.opencontainers.image.source="https://github.com/AlexFilippov-it/wrighttest" \
      org.opencontainers.image.documentation="https://github.com/AlexFilippov-it/wrighttest#readme" \
      org.opencontainers.image.licenses="WrightTest Source-Available License v1.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY frontend/docker-entrypoint.d/10-runtime-config.sh /docker-entrypoint.d/10-runtime-config.sh
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
