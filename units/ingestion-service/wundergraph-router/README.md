# Cosmo router (real WunderGraph) + ingestion subgraph

Spec-faithful build (`tech-environment.md` names **WunderGraph router** as the public
GraphQL gateway). Two pieces:

- **Cosmo Router** — the real WunderGraph gateway, a **pulled third-party image**
  (`ghcr.io/wundergraph/cosmo/router`), like Gotenberg. Composes + fronts the subgraph.
- **ingestion subgraph** — our Go **gqlgen Federation v2** server (`cmd/ingestion-subgraph`),
  exposing `_service{sdl}`/`_entities`. The router routes operations to it.

> Naming note: this unit *builds the subgraph*; the router itself is the pulled Cosmo image
> (no source authored beyond config), mirroring the html/Gotenberg pattern.

> **Status: POC — not in the live path.** The Cosmo router runs **only** via *this*
> directory's `docker-compose.yml`. It is **not** part of the main stack
> (`units/classification-service/docker-compose.yml`), CI, or Helm — those talk to the
> `ingestion-subgraph` **directly** (the live `router` service *is* the subgraph). The
> federation here is nominal: a single subgraph, no `@key` entity joins across subgraphs.

## Run locally (verified)

```bash
# 1. subgraph (Go) on :8099
BACKEND=memory PORT=8099 go run ./cmd/ingestion-subgraph       # or BACKEND=aws + LocalStack

# 2. compose the router config from the subgraph SDL (re-run if the schema changes)
npx --yes wgc router compose -i cosmo/graph.yaml -o cosmo/router-config.json

# 3. the real Cosmo router on :3399, fronting the subgraph
docker compose -f cosmo/docker-compose.yml up
#   query http://localhost:3399/graphql  (playground at http://localhost:3399/)
```

Verified flow: `client → Cosmo router :3399 → gqlgen subgraph :8099` — createWorkspace /
workspaces / createDocument (presigned) / stats all federate through the router (200s).

## dev05

`routing_url` in `graph.yaml` is `localhost:8099` for local (router uses host networking).
On dev05 set it to the subgraph's in-cluster Service URL and re-compose; deploy the Cosmo
router image alongside the subgraph (a sidecar-pair Pod, like html/Gotenberg).
