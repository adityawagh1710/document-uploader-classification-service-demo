# syntax=docker/dockerfile:1.7
# ingestion-subgraph image — multi-stage Go build → distroless-nonroot runtime,
# mirroring classification's image conventions (static binary, non-root, ECR
# keep-last-10). This is the ingestion-service unit's Go subgraph (the real
# server); the wundergraph-router (Cosmo) is a separate, pulled image.
#
# Build context = REPO ROOT, because the unit replace-imports the local lib at
# ../../../libs/pipeline-contracts/go:
#
#   docker build -f units/ingestion-service/ingestion-subgraph/Dockerfile \
#     -t 537462380503.dkr.ecr.eu-west-1.amazonaws.com/classification-service-sandbox/ingestion-subgraph:<sha> .

# ---------- builder ----------
FROM golang:1.25-bookworm AS builder
WORKDIR /src

# Module graph first (layer cache). The replaced local lib needs its go.mod present.
COPY libs/pipeline-contracts/go/go.mod ./libs/pipeline-contracts/go/
COPY units/ingestion-service/ingestion-subgraph/go.mod units/ingestion-service/ingestion-subgraph/go.sum ./units/ingestion-service/ingestion-subgraph/
WORKDIR /src/units/ingestion-service/ingestion-subgraph
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Full source.
WORKDIR /src
COPY libs/pipeline-contracts/go ./libs/pipeline-contracts/go
COPY units/ingestion-service/ingestion-subgraph ./units/ingestion-service/ingestion-subgraph
WORKDIR /src/units/ingestion-service/ingestion-subgraph
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
        -o /out/ingestion-subgraph ./cmd/ingestion-subgraph

# ---------- runtime ----------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/ingestion-subgraph /app/ingestion-subgraph
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/ingestion-subgraph"]
