# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Multi-stage build for the classification-convert-worker.
#
# Build context = repository root (so the worker/ directory is accessible).
# Example:
#   docker build -f worker/Dockerfile -t classification-convert-worker:dev .
#
# The worker is a long-lived Node process — it polls SQS and bridges to
# office-convert. No Next.js, no UI, no Aspose — just SDK + undici + zod.
# ----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /workspace/worker
COPY worker/package.json ./package.json
RUN npm install --no-audit --no-fund --no-package-lock

FROM node:20-alpine AS builder
WORKDIR /workspace/worker
COPY --from=deps /workspace/worker/node_modules ./node_modules
COPY worker/tsconfig.json ./tsconfig.json
COPY worker/src ./src
RUN npx tsc -p tsconfig.json

# Trim dev deps from node_modules so the runtime image is small. Cheaper than
# a separate npm-install in production-mode.
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Compiled worker + its runtime deps. No source, no tests, no tsx.
COPY --from=builder /workspace/worker/dist ./dist
COPY --from=builder /workspace/worker/node_modules ./node_modules
COPY worker/package.json ./package.json

# Distroless would be cleaner, but node:20-alpine matches the rest of the
# repo's image conventions (ui/Dockerfile) and keeps `kubectl exec` debugging
# possible.
USER node
CMD ["node", "dist/main.js"]
