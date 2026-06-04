# Document-uploader UI — Vite/React SPA served by nginx.
# Built from the REPO ROOT so the pnpm workspace lockfile + sibling member
# manifests are available (mirrors the other units' repo-root build context):
#
#   docker build -f units/document-uploader-ui/Dockerfile -t document-uploader-ui:dev ../..
#
# Runtime config: the GraphQL endpoint is injected at container start into
# /usr/share/nginx/html/config.js (envsubst on docker-entrypoint), so ONE image
# works for local (browser-direct) and dev05 (nginx same-origin proxy) — see
# GRAPHQL_URL below and the commented /graphql proxy block in nginx.conf.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace

# pnpm workspace skeleton first (layer cache): lockfile + every member manifest.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY units/classification-service/package.json units/classification-service/
COPY units/classification-service/worker/package.json units/classification-service/worker/
COPY units/document-uploader-ui/package.json units/document-uploader-ui/
# Vendored design-system tarballs must exist before install (file: deps).
COPY units/document-uploader-ui/packages units/document-uploader-ui/packages
RUN pnpm install --frozen-lockfile --ignore-scripts

# App source + build.
COPY units/document-uploader-ui ./units/document-uploader-ui
WORKDIR /workspace/units/document-uploader-ui
RUN pnpm run build           # → dist/

# ── Runtime: static SPA on nginx ──────────────────────────────────────────
FROM nginx:alpine AS runner
ENV GRAPHQL_URL=http://localhost:8099/graphql
COPY --from=build /workspace/units/document-uploader-ui/dist /usr/share/nginx/html
COPY units/document-uploader-ui/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY units/document-uploader-ui/deploy/config.js.template /etc/nginx/templates/config.js.template
COPY units/document-uploader-ui/deploy/docker-entrypoint.sh /docker-entrypoint.d/40-app-config.sh
RUN chmod +x /docker-entrypoint.d/40-app-config.sh
EXPOSE 80
# nginx:alpine's own entrypoint runs /docker-entrypoint.d/*.sh then starts nginx.
