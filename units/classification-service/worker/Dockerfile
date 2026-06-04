# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the classification-convert-worker (a long-lived Node
# process that polls SQS and bridges to office-convert).
#
# Build context = REPOSITORY ROOT — the pnpm workspace lockfile lives there.
#   docker build -f units/classification-service/worker/Dockerfile -t classification-convert-worker:dev .
# ----------------------------------------------------------------------------

FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY units/classification-service/package.json units/classification-service/
COPY units/classification-service/worker/package.json units/classification-service/worker/
COPY units/document-uploader-ui/package.json units/document-uploader-ui/
# document-uploader-ui pulls its design system from vendored tarballs (file:
# deps in the shared lockfile); the workspace-wide frozen install needs them
# present even though this image doesn't use the UI.
COPY units/document-uploader-ui/packages units/document-uploader-ui/packages
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY units/classification-service/worker ./units/classification-service/worker
RUN pnpm --filter classification-convert-worker run build
RUN pnpm --filter classification-convert-worker deploy --prod /out

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Compiled worker + its runtime deps. dist comes straight from the builder
# (the worker's .gitignore excludes dist from pnpm deploy's packlist); the prod
# node_modules comes from the deploy.
COPY --from=builder /workspace/units/classification-service/worker/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json
# node:20-alpine matches the repo's image conventions and keeps `kubectl exec`
# debugging possible.
USER node
CMD ["node", "dist/main.js"]
