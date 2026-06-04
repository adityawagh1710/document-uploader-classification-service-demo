# document-uploader-demo-poc (monorepo)
## Classification service 

One repo, many independently-deployed microservices — *monorepo for code,
microservices at runtime*. (This repo also serves as the classification-service
demo; the root was refactored into the `units/` + `libs/` layout — see
`aidlc-docs/operations/monorepo/MONOREPO_LAYOUT_REFACTOR_PLAN.md`.)

## Layout

```
aidlc-docs/                         inception docs (vision, tech-environment, units)
libs/
  pipeline-contracts/go             shared wire contract (baked into Go units)
units/
  classification-service/           TS service: src + worker + infra(CDK) + tests + sync /classify HTTP
  document-uploader-ui/             Next.js UI (own unit); talks GraphQL to the router
  ingestion-service/                ingestion front door (the BFF/router):
    ingestion-subgraph/             Go gqlgen Federation v2 server — THE live router the UI calls
    wundergraph-router/             pulled Cosmo gateway config — POC only (not in the live stack/CI/Helm)
tools/ci/units.json                 path -> unit -> image map (path-filtered CI)
pnpm-workspace.yaml                 TS workspace (classification-service + ui)
                                    (Go units are standalone modules; each resolves libs/* via a replace directive — go.work omitted due to a machine GOFLAGS=-mod=mod conflict)
CODEOWNERS
```

**Boundary rule:** the only legal cross-unit imports are `libs/*`. No unit imports
another unit.

## Tech stack & frameworks

Frameworks/tooling follow the platform spec `tech-environment.md` (the binding tier).
All TS units are a **pnpm** workspace (npm/yarn lockfiles are prohibited); Go units are
standalone modules resolving `libs/*` via a `replace` directive.

| Unit | Lang | Framework / runtime | Logging | Tests |
|---|---|---|---|---|
| `classification-service` | TS (Node) | **fastify 5** — sync `/classify` HTTP server (`src/handler/http-server.ts`); **plus** an AWS **Lambda** handler (`src/handler/lambda.ts`, invoked by the runtime, no HTTP server). Infra: **CDK** (`aws-cdk-lib`) | **pino 10** (Powertools fully removed) | vitest + property-based (fast-check) |
| `classification-service/worker` | TS (Node) | SQS consumer for the convert stage; `@aws-sdk/client-sfn` for the task-token signal | structured JSON (`worker/src/logger.ts`) | vitest |
| `document-uploader-ui` | TS | **Next.js 15 / React 19** (standalone); **pure router client — zero `@aws-sdk`** | — | cypress e2e |
| `ingestion-service/ingestion-subgraph` | Go | **gqlgen** Apollo Federation v2 over `net/http`; `aws-sdk-go-v2` (incl. `service/sfn`) — **the live BFF/router the UI calls directly** | **slog** | go test |
| `ingestion-service/wundergraph-router` | — | pulled **Cosmo** gateway image — **POC only; not in the live runtime, CI, or Helm** (the live stack talks to the subgraph directly; single subgraph, no real federation join yet) | — | — |

**AIDLC conformance (done):** TS units npm→**pnpm**; classification logging Powertools→**pino**;
the `/classify` server `node:http`→**fastify**; UI Next 14→**15** / React 19; the Go router
already conformant (gqlgen + slog + aws-sdk-go-v2). See `aidlc-docs/aidlc-state.md`
"Architecture Evolution (2026-06-03)".

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
cd units/classification-service
make pipeline-images                 # retag sibling office-convert/zip-extraction images
docker compose --profile pipeline up
```

> The `pipeline` profile consumes the **office-convert** and **zip-extraction**
> images that are built and owned by their sibling repos. No image name is
> shared across repos — build those images in their own repos first, then
> `make pipeline-images` retags them into this repo's `classification-pipeline/*`
> namespace (see `scripts/pipeline-images.sh`).

`scripts/bootstrap-localstack.sh` seeds the integration-test resources in
LocalStack (`eu-west-1`): S3 `classification-ui-bucket`; DynamoDB
`content-hashes-ui`/`workspace-config-ui`/`classifications-ui`/`email-extractions-ui`/`pipeline_files`;
SQS `zip-extraction-queue`/`classification-convert-queue`(+dlq); and the two
Step Functions state machines `classification-convert-pipeline` (P1) +
`classification-zip-pipeline` (P2).

## Integrating a new stage

Stages are declared in **`units/classification-service/stages.registry.json`** — the
single source of truth. Each entry becomes a queue + a Step Functions state machine
(`sqs:sendMessage.waitForTaskToken`); the runtime is identical whether the service is
an in-monorepo `unit` or an own-repo `external` service (only `source.type` differs).
After editing the registry, regenerate the LocalStack bootstrap block:

```
cd units/classification-service && node scripts/gen-stages.mjs   # also: --summary | --compose <stage> | --check
```

New teams: start with **`ONBOARDING.md`** (repo root) — the integration guide for both
delivery models, the task-token contract, and the local test loop.

## Plans / status

- `aidlc-docs/operations/wundergraph/WunderGraph_Router_POC_Plan.md` — Go router POC (P0–P6 done; P7 dev05 deploy pending rebuild).
- `aidlc-docs/operations/monorepo/MONOREPO_LAYOUT_REFACTOR_PLAN.md` — this layout refactor (executed; archived).
- `Contracts_Baked_POC_Design.md` / `Approach_Pipeline_flowchart.md` — the contracts-baked design (on the `docs/contracts-baked-poc` branch).
- `aidlc-docs/operations/sfn/StepFunctions_Pipeline_Design.md` — SFN orchestration design + recommendation, with the **as-built P1 (convert) + P2 (archive/zip)** flows (§9/§10). Flowchart: `aidlc-docs/operations/sfn/SFN_Pipeline_Flows.pdf`.
- `aidlc-docs/operations/sfn/SFN_Stage_Service_Shared_Contract.md` — the contract a stage service must honour to participate in the SFN task-token protocol.
- `aidlc-docs/operations/sfn/Dev05_SFN_Enablement_Plan.md` — scoping for taking the SFN pipelines to EKS dev05 (the "7th workstream" on top of the BFF deploy): CDK `ClassificationPipelineStack`, router/worker/zip IRSA grants, Helm env. Code-on-branch; execution operator-gated.
- `ONBOARDING.md` + `units/classification-service/stages.registry.json` (+ `scripts/gen-stages.mjs`) — config-driven stage registry and the integration guide for adding a stage by either delivery model (in-monorepo `unit` / own-repo `external`).
