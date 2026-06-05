# ingestion-service

The document-uploader **ingestion front door**. *Intended* to deploy as a
**sidecar-pair Pod** of two containers (the same pattern as `office` =
Aspose + orchestrator and `html` = Gotenberg + sidecar) — but today only the
subgraph half runs; the Cosmo gateway is a POC (see below):

```
units/ingestion-service/
├── ingestion-subgraph/      server   — Go gqlgen Apollo Federation v2 subgraph (BUILT image)
│                                       THE live router: the UI talks to this DIRECTLY;
│                                       mints presigned S3 uploads, dispatches StageRequests
└── wundergraph-router/      gateway  — pulled WunderGraph Cosmo router (config only) — POC of the
                                        UI → gateway → subgraph topology; NOT in the live stack/CI/Helm
```

| Deployable | Image | Source |
|---|---|---|
| `wundergraph-router` | `ghcr.io/wundergraph/cosmo/router` (pulled) | config only — `graph.yaml` → `wgc router compose` → `router-config.json` |
| `ingestion-subgraph` | `…/classification-service-sandbox/ingestion-subgraph` (built) | `ingestion-subgraph/Dockerfile` (multi-stage Go → distroless) |

**Request path (live):** UI → `ingestion-subgraph` **directly** → presign S3 + dispatch the
post-classify `StageRequest`. **Intended/POC topology:** UI → `wundergraph-router` (Cosmo
gateway) → `ingestion-subgraph` — the gateway is stood up as a POC (its own
`wundergraph-router/docker-compose.yml`) but is **not** wired into the running stack, CI, or Helm.

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
