FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json

RUN npm ci --workspace=frontend

COPY frontend/ ./frontend/

ARG VITE_BACKEND_URL=http://localhost:3000
ARG VITE_NOVNC_URL=http://localhost:6080

ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_NOVNC_URL=$VITE_NOVNC_URL

RUN cd frontend && npx vite build

FROM nginx:alpine

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
