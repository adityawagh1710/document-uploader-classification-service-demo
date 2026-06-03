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
| `units/classification-service` (TS) | `pnpm install && pnpm run build && pnpm run cdk:synth` (pnpm workspace; npm/yarn lockfiles are prohibited per AIDLC `tech-environment.md`) |
| `units/document-uploader-ui` (Next.js) | `pnpm install && pnpm run build` |

## Local pipeline (Docker Compose)

`units/classification-service/docker-compose.yml` brings up the BFF stack
(LocalStack → bootstrap → classification `/classify` → router → UI on `:3000`).
The optional **`pipeline` profile** also starts the convert + zip-extraction
stage services and the Step Functions orchestration:

```
cd units/classification-service && docker compose --profile pipeline up
```

`scripts/bootstrap-localstack.sh` seeds the integration-test resources in
LocalStack (`eu-west-1`): S3 `classification-ui-bucket`; DynamoDB
`content-hashes-ui`/`workspace-config-ui`/`classifications-ui`/`email-extractions-ui`/`pipeline_files`;
SQS `zip-extraction-queue`/`classification-convert-queue`(+dlq); and the two
Step Functions state machines `classification-convert-pipeline` (P1) +
`classification-zip-pipeline` (P2).

## Plans / status

- `WunderGraph_Router_POC_Plan.md` — Go router POC (P0–P6 done; P7 dev05 deploy pending rebuild).
- `MONOREPO_LAYOUT_REFACTOR_PLAN.md` — this layout refactor.
- `Contracts_Baked_POC_Design.md` / `Approach_Pipeline_flowchart.md` — the contracts-baked design (on the `docs/contracts-baked-poc` branch).
- `StepFunctions_Pipeline_Design.md` — SFN orchestration design + recommendation, with the **as-built P1 (convert) + P2 (archive/zip)** flows (§9/§10). Flowchart: `SFN_Pipeline_Flows.pdf`.
- `SFN_Stage_Service_Shared_Contract.md` — the contract a stage service must honour to participate in the SFN task-token protocol.
