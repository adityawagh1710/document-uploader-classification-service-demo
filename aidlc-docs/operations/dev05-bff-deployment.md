# dev05 Deployment — Full-BFF 3-Pod Topology

**Status:** deploy artifacts built + validated (helm lint/template, cdk synth) on branch
`feat/classification-dev05-bff-deploy`; **execution is operator-gated** (needs dev05
creds). · **Last updated:** 2026-06-04

This documents how the classification demo deploys to the dev05 EKS cluster in its
current **full-BFF** shape, and **supersedes** the Option-A runbook in
`units/classification-service/deploy/AWS_TOPOLOGY.md` (the in-process UI classifier).

## Topology change: Option A → 3-pod BFF

Previously dev05 ran the UI **in-process** against AWS via its own `classification-ui-irsa`
role (no router; the sync classify engine existed only as the Lambda / in-process). The
repo has since become a full BFF, so dev05 now runs **three pods**:

```
browser ─► ALB ─► document-uploader-ui          (Vite SPA on nginx :80 — NO AWS, NO IRSA)
   │  ▲  ▲           │ same-origin /graphql proxy (nginx) → in-cluster GraphQL
   │  │  │           ▼
   │  │  │        ingestion-subgraph (router)    (IRSA — owns ALL AWS: S3 presign,
   │  │  │           │ in-cluster HTTP /classify    the engine's DDB tables, stage queues)
   │  │  │           ▼
   │  │  │        classification-service-http     (IRSA — S3 read + content-hashes/
   │  │  │                                          workspace-config DDB for the engine)
   │  │  └── presignUpload (GraphQL via the nginx proxy)
   └──┴───── PUT bytes DIRECT to presigned S3 URL (regional endpoint — needs bucket CORS)
```

The UI is now a **browser-direct SPA** served static by nginx: the browser is the GraphQL
client (it calls same-origin `/graphql`, which the UI pod's nginx proxies in-cluster to the
ClusterIP-only router) and it PUTs upload bytes **straight to the presigned S3 URL**. The UI
pod holds no AWS SDK and runs no server logic. The UI **loses** its AWS role entirely;
**two new IRSA roles** appear (router, classify-http); **one new DDB table**
(`email-extractions-dev`) appears.

### UI pod env (Helm ConfigMap, `values-aws.yaml`)
Three keys only (the SPA reads them at container start via the nginx entrypoint):
`GRAPHQL_URL=/graphql` (same-origin), `GRAPHQL_UPSTREAM=http://ingestion-subgraph.<ns>.svc.cluster.local:8080`
(the in-cluster router base the nginx `/graphql` proxy forwards to), and `UPLOAD_REWRITE=""`
(empty on real AWS — the regional S3 endpoint is directly reachable). The container listens
on **:80**; probes hit `/` (static SPA — there is no `/api/health`). One image serves both
local browser-direct (GRAPHQL_UPSTREAM unset → no proxy) and dev05 same-origin (proxy on).

> **Deploy ordering note:** nginx resolves the `GRAPHQL_UPSTREAM` host at startup, so the
> `ingestion-subgraph` **Service** must exist before the UI pod starts. `bff-deploy` deploys
> http → router → UI, so the router Service is always present first (a ClusterIP A-record
> resolves even before the router has ready endpoints — proxied calls just 502 until ready).

### S3 bucket CORS (browser-direct upload)
The cross-origin browser→S3 PUT needs CORS on the staging bucket (`classification-ui-dev05`).
`make bff-deploy` runs `make bucket-cors` automatically (policy in `deploy/s3-cors.json`,
mirroring `scripts/bootstrap-localstack.sh`). Run it standalone with
`make bucket-cors` if you ever recreate the bucket.

## dev05 facts (operator: confirm still current)

| | |
|---|---|
| Account / region / cluster | `537462380503` / `eu-west-1` / `DEV05-EKS-CLUSTER` |
| Namespace | `classification-service-sandbox` |
| OIDC provider id | `4CD18ACA973AEF3E3D289F4092A757EA` (in all `*-irsa-trust.json`) |
| Bucket (out-of-band) | `classification-ui-dev05` |
| DDB tables (CDK `ClassificationData-dev`) | `content-hashes-dev`, `workspace-config-dev`, `classifications-dev`, **`email-extractions-dev`** (new) |
| Document/workspace store | `workspaces-dev`, `documents-dev` (+`workspaceId-index`) |
| Queues | `classification-convert-queue-dev` (ours, CDK) · `zip-extraction-dev05` (external zip service owns it) |
| ECR repos (`…/classification-service-sandbox/…`) | `classification-service-ui`, `ingestion-subgraph`, `classification-convert-worker`, **`classification-service-http`** (new) |
| Route53 / ACM (UI ALB) | zone `Z045669519R5D9D8CKC79` · wildcard cert `…:certificate/fab42f33-7d67-4ecf-b200-38af584485b0` |

## Per-component deploy artifacts

| Component | Image / Dockerfile | Helm chart | IRSA | Make targets |
|---|---|---|---|---|
| **classification-service-http** | `Dockerfile.http` (port 8091) | `deploy/helm/classification-service-http` (ClusterIP) | `deploy/iam/classification-service-http-irsa-{perms,trust}.json` | `http-deploy` / `http-undeploy` |
| **ingestion-subgraph** (router) | `units/ingestion-service/ingestion-subgraph/Dockerfile` (8080) | `…/ingestion-subgraph/deploy/helm/ingestion-subgraph` (ClusterIP) | `…/ingestion-subgraph/deploy/iam/ingestion-subgraph-irsa-{perms,trust}.json` | `router-deploy` / `router-undeploy` |
| **document-uploader-ui** | `units/document-uploader-ui/Dockerfile` (Vite SPA on **nginx :80**) | `deploy/helm/classification-ui` (+`values-aws.yaml`) | none (browser client) | `deploy-dev` (within `bff-deploy`) |
| **convert-worker** | `worker/Dockerfile` | `deploy/helm/convert-worker` | `deploy/iam/convert-worker-irsa-*` | `worker-deploy` |
| **DynamoDB tables** | — | CDK `infra/lib/data-stack.ts` | — | `synth` / `cdk deploy ClassificationData-dev` |

### Router env (Helm ConfigMap, BFF)
`BACKEND=aws`, `DOCUPLOADER_STAGING_BUCKET`, the six tables
(`CONTENT_HASH/CLASSIFICATIONS/WORKSPACE_CONFIG/EMAIL_EXTRACTIONS/WORKSPACES/DOCUMENTS_TABLE_NAME`),
`CLASSIFY_URL` → in-cluster classify-http, `CONVERT_QUEUE_URL` + `ZIP_EXTRACTION_QUEUE_URL`,
and optional `OFFICE_CONVERT_API_URL`. **No `AWS_ENDPOINT_URL`/`S3_PUBLIC_ENDPOINT`** (regional).

### Step Functions are optional on dev05
`STATE_MACHINE_ARN` / `ARCHIVE_STATE_MACHINE_ARN` are **empty by default** — the SFN
pipeline stack isn't on dev05 yet (see `sfn/Dev05_SFN_Enablement_Plan.md`). With them
unset, the router dispatches convert/archive **directly to the queues** (pre-SFN path),
so the BFF is deployable today. Set them (and the router IRSA already grants
`states:StartExecution`) once the state machines exist.

## Namespace lifecycle (the correctness rule)

The three pods **share** `classification-service-sandbox`, so **no chart owns it**:
- `values-aws.yaml` sets `namespace.create=false` → the UI chart renders no Namespace.
- **Deploy:** the namespace is created by the first `helm --create-namespace` (http), then
  router, then UI. No `ns-delete` runs.
- **Undeploy:** uninstall UI → router → http, then drop the namespace **LAST**.
- `make ns-delete` (and the UI-only `undeploy-dev` / pre-deploy `__undeploy-soft`) **refuses**
  to drop the namespace while the router/http releases are still installed — so a stray
  UI-only teardown can't take the siblings down with it.

## Runbook

```bash
cd units/classification-service

# Deploy the whole 3-pod BFF (http → router → UI). DEPLOY_BACKEND=aws is set internally.
make bff-deploy \
  DEPLOY_IMAGE_TAG=$(git rev-parse --short HEAD) \
  HTTP_IRSA_ROLE_ARN=arn:aws:iam::537462380503:role/classification-service-http-irsa \
  ROUTER_IRSA_ROLE_ARN=arn:aws:iam::537462380503:role/ingestion-subgraph-irsa \
  DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com \
  DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79

# Tear it all down (releases first, namespace last):
make bff-undeploy
```

Per-component targets also exist (`http-deploy`, `router-deploy`, `worker-deploy`, …) — see
`make help` (groups: *BFF — classification-service-http*, *BFF — ingestion-subgraph (router)*).

## Operator-gated prerequisites (not doable from the repo)

1. dev05 AWS creds / kubeconfig (or run the commands yourself).
2. Confirm the OIDC provider id matches the cluster (`aws eks describe-cluster … oidc.issuer`).
3. Create the IAM roles from the JSON, with trust + perms:
   - `classification-service-http-irsa` ← `deploy/iam/classification-service-http-irsa-*.json`
   - `ingestion-subgraph-irsa` ← `…/ingestion-subgraph/deploy/iam/ingestion-subgraph-irsa-*.json` (now grants all six tables, both queues, SFN StartExecution)
4. `cdk deploy ClassificationData-dev` (creates the new `email-extractions-dev` table).
5. ECR repos auto-create on first `*-image-push`; the `classification-ui-dev05` bucket is
   out-of-band (its browser-upload CORS is applied by `make bucket-cors`, which `bff-deploy` runs).

## Cross-references
- `units/classification-service/deploy/AWS_TOPOLOGY.md` — **superseded** (Option-A in-process UI).
- `sfn/StepFunctions_Pipeline_Design.md`, `sfn/Dev05_SFN_Enablement_Plan.md` — SFN orchestration (optional on dev05 today).
- `local-docker-images.md` — local image-name convention across the 3 demo repos.
