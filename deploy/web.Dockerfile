# Front (build do Vite) servido pelo Caddy, que também faz o proxy de /api e o HTTPS.
# Contexto de build: raiz do repositório.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
