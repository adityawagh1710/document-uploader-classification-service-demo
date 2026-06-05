# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the document-uploader UI (Next.js standalone).
# Build context = REPOSITORY ROOT: the COPY paths are repo-root-relative, the
# pnpm workspace lockfile lives there, and next.config's outputFileTracingRoot
# roots the standalone bundle at the repo root (entry
# units/document-uploader-ui/server.js). The UI is a pure HTTP/GraphQL client of
# the router — no sibling classification-service src dependency.
#   docker build -f units/document-uploader-ui/Dockerfile -t document-uploader-ui:dev .
# ----------------------------------------------------------------------------

FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /workspace
# Workspace manifests + lockfile first (layer cache).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY units/classification-service/package.json units/classification-service/
COPY units/classification-service/worker/package.json units/classification-service/worker/
COPY units/document-uploader-ui/package.json units/document-uploader-ui/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY units/document-uploader-ui ./units/document-uploader-ui
WORKDIR /workspace/units/document-uploader-ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next standalone is rooted at the REPO ROOT (outputFileTracingRoot=../..), so
# the bundle lays out as units/document-uploader-ui/server.js with node_modules
# at the standalone root.
COPY --from=builder /workspace/units/document-uploader-ui/.next/standalone ./
COPY --from=builder /workspace/units/document-uploader-ui/.next/static ./units/document-uploader-ui/.next/static
COPY --from=builder /workspace/units/document-uploader-ui/public ./units/document-uploader-ui/public

EXPOSE 3000
USER node
CMD ["node", "units/document-uploader-ui/server.js"]
