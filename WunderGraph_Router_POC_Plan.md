# WunderGraph Router — Go POC Plan

**Status:** Locked plan · branch `feat/ingestion-go-router`
**Decision locked:** **gqlgen** (GraphQL) + **`log/slog`** (logging)
**Repo acts as:** the `document-uploader` monorepo (this demo)
**Supersedes:** the TS Fastify `ingestion-service/` scaffold (to be replaced)
**Builds on:** [`Contracts_Baked_POC_Design.md`] · [`New_Microservice_Tech_Input.md`] · `aidlc-docs/inception/{vision,tech-environment}.md`

---

## Goal

A basic POC of the **`wundergraph-router` in Go** — **Approach A**: the router exposes a
**GraphQL** API and the existing document-uploader **UI is repointed** from REST `/api/*` to
GraphQL (+ `graphql-transport-ws` for `Document.statusChanged`). Runs locally on **LocalStack**
(mirroring classification) with **classification ↔ ingestion connected end-to-end**, using the
**right wire contracts**, and following **classification's deployment rules + naming**.

## Locked Go stack

| Concern | Locked choice | Notes |
|---|---|---|
| **GraphQL server** | **gqlgen** (`99designs/gqlgen`) | schema-first + codegen; built-in `graphql-transport-ws` subscriptions |
| **Logging** | **`log/slog`** (stdlib) | binding standard; `zap`/`logrus` prohibited (note: the `zip-extraction` Go demo uses `zap` — we deliberately use `slog` per the spec) |
| HTTP / routing | `net/http` (add `chi` only if needed) | gqlgen mounts as a plain `http.Handler`; **no** gin/echo/fiber/gorilla-mux |
| AWS (S3/SQS/DynamoDB) | `aws-sdk-go-v2` | endpoint-configurable for LocalStack |
| WebSocket (subs) | gqlgen's bundled transport | not a separate decision |
| Config | stdlib `os.Getenv` | keep minimal |
| Testing | `testing` + `testify` | matches repo Go conventions |

Deliberately thin — exactly what `tech-environment.md` mandates for Go. **gqlgen is the only framework.**

## Local (LocalStack) + classification ↔ ingestion

- Mirror classification's `docker-compose.yml`: LocalStack `s3,dynamodb,stepfunctions,sqs`, region
  `eu-west-1`, `AWS_ENDPOINT_URL=http://localstack:4566`, a `bootstrap` (aws-cli) container running
  `scripts/bootstrap-localstack.sh`, UI on :3000.
- Add the Go router as a service on the **same LocalStack + bootstrap**.
- **Connect the two locally:** the router dispatches a real `StageRequest` envelope to
  **classification's input queue**; classification consumes it; status flows back (same pattern as
  the existing local `zip-extraction-queue`).
- Local resource naming follows classification's `-ui` suffix style (`classification-ui-bucket`,
  `*-ui` tables, `<stage>-queue`).

## Deployment rules + naming (mirror classification)

Multi-stage **Dockerfile**, **Helm** chart (`deploy/helm`), **k8s** manifests (`deploy/k8s`),
**IRSA** IAM (`deploy/iam`, no static creds), **ECR keep-last-10** lifecycle, push-based CLI deploy.
dev names use the `-dev05` suffix (e.g. `workspace-config-dev`). Follow **classification's demo
naming**, not the binding docuploader-token rule.

## Phased plan + ETA (agent active)

| Phase | Work | ETA |
|---|---|---|
| **P0** | Recon + branch (done); read `deploy/{helm,k8s,iam}`, `ecr-lifecycle-policy.json`, `Dockerfile.lambda`, `scripts/bootstrap-localstack.sh`, naming glossary → copy exact rules | ~0.5 h |
| **P1** | `libs/pipeline-contracts/go` — wire envelope (schemaVersion, claim-check, idempotency, traceparent, StageRequest/StageStatusUpdate/DocumentPipelineEvent) | ~2–3 h |
| **P2** | Go router via **gqlgen**: `workspaces`, `documents`, `createDocument` (presign), `Document.statusChanged` subscription; **`slog`** logging | ~4–5 h |
| **P3** | AWS adapters (S3 presign+claim-check, SQS dispatch, DynamoDB), endpoint-configurable for LocalStack | ~3–4 h |
| **P4** | Local integration: add router to `docker-compose.yml` on the shared LocalStack+bootstrap; router dispatch queue = classification input queue → e2e | ~2–3 h |
| **P5** | UI → GraphQL (Approach A): swap `ui/lib/*` to GraphQL queries/mutations + subscription | ~3–5 h |
| **P6** | Deploy artifacts mirroring classification (Dockerfile/Helm/k8s/IRSA/ECR keep-last-10; `-dev05` names) | ~0.5–1 day |
| **P7** | dev05 deploy (push-based) — **BLOCKED on dev05 rebuild** | ~0.5 day |
| **P8** | Verify local e2e (UI→router→LocalStack→classification→status) + contract tests + build green | ~1–2 h |

**ETA:** local working POC (P0–P5, P8) **~2.5–3 days / ~15–20 h**; deploy artifacts (P6) ~0.5–1 day;
dev05 deploy (P7) ~0.5 day after rebuild. Total ~3.5–4.5 days; wall-clock depends on dev05 rebuild +
network (`go mod`, Docker images).

## dev05

Plan is **local-first** → **zero dev05 dependency** for P0–P5/P8. dev05 is torn down; once rebuilt,
P7 is a quick deploy-and-verify. Not blocked.

## Open items

- ~~Router engine~~ → **LOCKED: gqlgen.**
- ~~Logging~~ → **LOCKED: `log/slog`.**
- **dev05 rebuild timing** — only affects P7.

## Next action

Awaiting "go" to start **P0** (recon of classification's deploy/naming rules) → **P1** (`libs/pipeline-contracts/go`).
