# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the document-uploader UI (Next.js standalone).
# Build context MUST be the repository root — the UI imports a few types +
# SQS dispatchers from the sibling classification-service via the @svc alias
# (../classification-service/src), a documented temporary cross-unit dep that
# retires as the wundergraph-router grows into a full BFF.
#   docker build -f units/document-uploader-ui/Dockerfile -t document-uploader-ui:dev .
# ----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /workspace/units/document-uploader-ui
COPY units/document-uploader-ui/package.json ./package.json
RUN npm install --no-audit --no-fund --no-package-lock

FROM node:20-alpine AS builder
WORKDIR /workspace
COPY --from=deps /workspace/units/document-uploader-ui/node_modules ./units/document-uploader-ui/node_modules
COPY units/document-uploader-ui ./units/document-uploader-ui
# The @svc alias resolves to the sibling unit's src (types + dispatchers only).
COPY units/classification-service/src ./units/classification-service/src
# Make the UI's node_modules discoverable when @svc files walk up for deps
# (both tsc and webpack resolve from the importing file's directory).
RUN ln -s /workspace/units/document-uploader-ui/node_modules /workspace/node_modules
WORKDIR /workspace/units/document-uploader-ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next standalone bundle ships only what's needed at runtime. next.config sets
# outputFileTracingRoot to the units/ dir, so the bundle is rooted there and the
# entry lands at document-uploader-ui/server.js.
COPY --from=builder /workspace/units/document-uploader-ui/.next/standalone ./
COPY --from=builder /workspace/units/document-uploader-ui/.next/static ./document-uploader-ui/.next/static
COPY --from=builder /workspace/units/document-uploader-ui/public ./document-uploader-ui/public

EXPOSE 3000
USER node
CMD ["node", "document-uploader-ui/server.js"]
