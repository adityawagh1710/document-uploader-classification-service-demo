# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the document-uploader UI (Next.js standalone).
# Build context MUST be the repository root: the COPY paths are repo-root-
# relative and next.config's outputFileTracingRoot roots the standalone bundle
# at units/ (entry document-uploader-ui/server.js). The UI is now a pure
# HTTP/GraphQL client of the router — it no longer imports the sibling
# classification-service src (the old @svc cross-unit dep is gone).
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
