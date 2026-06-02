# ingestion-service

The document-uploader **ingestion front door**. One unit, deployed as a
**sidecar-pair Pod** of two containers (the same pattern as `office` =
Aspose + orchestrator and `html` = Gotenberg + sidecar):

```
units/ingestion-service/
├── wundergraph-router/      gateway  — the real WunderGraph Cosmo router (PULLED image)
│                                       composes + fronts the subgraph; the UI talks to this
└── ingestion-subgraph/      server   — Go gqlgen Apollo Federation v2 subgraph (BUILT image)
                                        mints presigned S3 uploads, dispatches StageRequests
```

| Deployable | Image | Source |
|---|---|---|
| `wundergraph-router` | `ghcr.io/wundergraph/cosmo/router` (pulled) | config only — `graph.yaml` → `wgc router compose` → `router-config.json` |
| `ingestion-subgraph` | `…/classification-service-sandbox/ingestion-subgraph` (built) | `ingestion-subgraph/Dockerfile` (multi-stage Go → distroless) |

**Request path:** UI → `wundergraph-router` (gateway) → `ingestion-subgraph` (subgraph)
→ presign S3 + dispatch `StageRequest:classify` to `classification-classify-queue`
(the connect point with the classification service).

## Run it locally

```bash
# 1) the subgraph (in-memory backend, no AWS)
cd ingestion-subgraph && BACKEND=memory PORT=8099 go run ./cmd/ingestion-subgraph

# 2) the Cosmo router fronting it (listens :3399, reaches the subgraph at :8099)
cd ../wundergraph-router && docker compose up   # then query http://localhost:3399/graphql
```

Recompose the router config after a schema change:
`cd wundergraph-router && wgc router compose -i graph.yaml -o router-config.json`.

See each deployable's own README for details. The shared wire contract is
`libs/pipeline-contracts/go` (baked in via a `replace` directive).
