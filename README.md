# document-uploader (monorepo)

One repo, many independently-deployed microservices — *monorepo for code,
microservices at runtime*. (This repo also serves as the classification-service
demo; the root was refactored into the `units/` + `libs/` layout — see
`MONOREPO_LAYOUT_REFACTOR_PLAN.md`.)

## Layout

```
aidlc-docs/                         inception docs (vision, tech-environment, units)
libs/
  pipeline-contracts/go             shared wire contract (baked into Go units)
units/
  classification-service/           TS service: src + worker + infra(CDK) + tests + sync /classify HTTP
  document-uploader-ui/             Next.js UI (own unit); talks GraphQL to the router
  ingestion-service/                ingestion front door (sidecar-pair Pod):
    wundergraph-router/             pulled Cosmo gateway (federates the subgraph)
    ingestion-subgraph/             Go gqlgen Federation v2 server over the contract
tools/ci/units.json                 path -> unit -> image map (path-filtered CI)
pnpm-workspace.yaml                 TS workspace (classification-service + ui)
                                    (Go units are standalone modules; each resolves libs/* via a replace directive — go.work omitted due to a machine GOFLAGS=-mod=mod conflict)
CODEOWNERS
```

**Boundary rule:** the only legal cross-unit imports are `libs/*`. No unit imports
another unit.

## Per-unit build

| Unit | Commands |
|---|---|
| `units/ingestion-service` (Go) | `cd ingestion-subgraph && go build ./... && go test ./...`; local: `ingestion-subgraph/deploy/local/docker-compose.yml`; gateway: `wundergraph-router/docker-compose.yml` (see its README) |
| `units/classification-service` (TS) | `npm ci && npm run build && npm run cdk:synth`; UI: `cd ui && npm run build` |

## Plans / status

- `WunderGraph_Router_POC_Plan.md` — Go router POC (P0–P6 done; P7 dev05 deploy pending rebuild).
- `MONOREPO_LAYOUT_REFACTOR_PLAN.md` — this layout refactor.
- `Contracts_Baked_POC_Design.md` / `Approach_Pipeline_flowchart.md` — the contracts-baked design (on the `docs/contracts-baked-poc` branch).
