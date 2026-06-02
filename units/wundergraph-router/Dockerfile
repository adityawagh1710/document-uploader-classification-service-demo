# syntax=docker/dockerfile:1.7
# wundergraph-router image — multi-stage Go build → distroless-nonroot runtime,
# mirroring classification's image conventions (static binary, non-root, ECR
# keep-last-10). Build context = REPO ROOT, because the unit replace-imports
# ../../libs/pipeline-contracts/go:
#
#   docker build -f units/wundergraph-router/Dockerfile \
#     -t 537462380503.dkr.ecr.eu-west-1.amazonaws.com/classification-service-sandbox/wundergraph-router:<sha> .

# ---------- builder ----------
FROM golang:1.25-bookworm AS builder
WORKDIR /src

# Module graph first (layer cache). The replaced local lib needs its go.mod present.
COPY libs/pipeline-contracts/go/go.mod ./libs/pipeline-contracts/go/
COPY units/wundergraph-router/go.mod units/wundergraph-router/go.sum ./units/wundergraph-router/
WORKDIR /src/units/wundergraph-router
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Full source.
WORKDIR /src
COPY libs/pipeline-contracts/go ./libs/pipeline-contracts/go
COPY units/wundergraph-router ./units/wundergraph-router
WORKDIR /src/units/wundergraph-router
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
        -o /out/wundergraph-router ./cmd/wundergraph-router

# ---------- runtime ----------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/wundergraph-router /app/wundergraph-router
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/wundergraph-router"]
