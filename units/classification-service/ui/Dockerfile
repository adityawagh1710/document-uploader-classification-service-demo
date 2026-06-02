# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the Classification Service Test UI.
# Build context MUST be the repository root (the UI imports from ../src), e.g.
#   docker build -f ui/Dockerfile -t classification-ui:dev .
# ----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /workspace
# UI deps + service src — both needed because the UI transpiles src/ in-tree.
COPY ui/package.json ./ui/package.json
WORKDIR /workspace/ui
RUN npm install --no-audit --no-fund --no-package-lock

FROM node:20-alpine AS builder
WORKDIR /workspace
COPY --from=deps /workspace/ui/node_modules ./ui/node_modules
COPY ui ./ui
COPY src ./src
COPY tsconfig.json ./tsconfig.json
# Make ui/node_modules discoverable when src/ files walk up looking for deps.
# Both Webpack (already overridden in next.config.mjs) and tsc need this:
# tsc uses Node's module resolution from the importing file's directory.
RUN ln -s /workspace/ui/node_modules /workspace/node_modules
WORKDIR /workspace/ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next standalone bundle ships only what's needed at runtime.
COPY --from=builder /workspace/ui/.next/standalone ./
COPY --from=builder /workspace/ui/.next/static ./ui/.next/static
COPY --from=builder /workspace/ui/public ./ui/public

EXPOSE 3000
USER node
CMD ["node", "ui/server.js"]
