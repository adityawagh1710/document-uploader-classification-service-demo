# Classification test harness

Next.js 14 harness that wraps `ClassificationService` for **interactive local testing** and **dev EKS smoke checks**. Modeled after the office-convert reference dashboard, scaled for the simpler classification flow (sub-second per doc, no long-running jobs). The "LocalStack" KPI tile auto-switches to "DynamoDB" when `CLASSIFIER_AWS_MODE=true` (dev05); the tables-count sub becomes `present/expected` so out-of-account tables don't inflate it.

```
┌───────────────────────────────────────────────────────────────┐
│  📄 Classification test harness                     LIVE ▮▮▮ │
├───────────────────────────────────────────────────────────────┤
│ [Service OK] [DynamoDB 12ms · 3/3] [Total 47] [Errs 0] [Succ %]│
│                                                               │
│ Detection tier breakdown                                      │
│ [file-type 28] [ole2 4] [zip 9] [text 3] [ext-fallback 3]    │
│                                                               │
│ Workspace seeder                Classify a file               │
│  (form)                          (upload + hints + result)    │
│                                                               │
│ Recent classifications (table with format/tier/cat/score/...) │
└───────────────────────────────────────────────────────────────┘
```

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20.0 | `node --version` |
| npm | ≥ 10 | `npm --version` |
| Docker (for compose path) | ≥ 24.x, daemon running | `docker info` |
| kubectl (for EKS path) | matches cluster | `kubectl version --client` |
| aws CLI (optional) | v2 | `aws --version` |

---

## 2. Three ways to run

| Mode | When to use |
|---|---|
| **A. Local dev (`npm run dev`)** | Tightest feedback loop; HMR for UI changes |
| **B. Local Docker Compose** | Full container parity; verifies the image builds |
| **C. Dev EKS deploy** | Smoke test from the cluster's network egress; shared link for the team |

---

## 3. Mode A — Local `npm run dev`

### 3.1 Start LocalStack

```bash
docker run --rm -d \
  --name classification-ui-localstack \
  -p 4566:4566 \
  -e SERVICES=s3,dynamodb,stepfunctions \
  -e DEFAULT_REGION=us-east-1 \
  -e PERSISTENCE=0 \
  localstack/localstack:3.7.0

# Wait for ready
until curl -fsS http://localhost:4566/_localstack/health | grep -q '"s3": "available"'; do sleep 1; done
echo "LocalStack ready"
```

### 3.2 Install + run

```bash
cd ui
npm install
npm run dev
```

UI: <http://localhost:3000>

The first request to `/api/health` triggers idempotent provisioning of the S3 bucket + DDB tables. No manual `aws dynamodb create-table` needed.

### 3.3 Drive a classification end-to-end

1. **Open** <http://localhost:3000>
2. **Seed a workspace** in the left form (defaults to `wks-ui-001`, threshold `0.5`, `quarantineMacros=false`). Click **Seed workspace**.
3. **Pick a file** in the right form. Optionally set extension/content-type hints. Click **Classify**.
4. The result panel shows pills for `tier · category · format · dedup · slipsheetReason` plus the raw JSON.
5. Re-upload the same file — the dedup pill flips from `new` to `dup` and `dedup.isDuplicate=true`.

Fixtures already in the repo at `tests/fixtures/<id>/`:

- `tests/fixtures/ac-1-docx-renamed-pdf/` — DOCX with renamed `.pdf` extension (Tier 2 ZIP detection)
- `tests/fixtures/ac-2-ole2-nonstandard-sector/` — OLE2 file with non-standard sector size (Tier 2 OLE2 CLSID)
- `tests/fixtures/ac-7-msg/` — Outlook MSG
- `tests/fixtures/ac-8-eml/` — RFC 5322 email

### 3.4 Stop

```bash
docker stop classification-ui-localstack
# Ctrl+C the next dev process
```

---

## 4. Mode B — Local Docker Compose

This builds the production-style standalone Next bundle into an image and runs it next to LocalStack.

```bash
# IMPORTANT: build context is the repository root, NOT ui/, because the
# UI imports from ../src.
docker compose -f ui/docker-compose.yml up --build
```

UI: <http://localhost:3000>
LocalStack health: <http://localhost:4566/_localstack/health>

### 4.1 What's running

| Container | Port | Purpose |
|---|---|---|
| `ui` | 3000 | Next.js standalone server (API routes + dashboard) |
| `localstack` | 4566 | S3 + DynamoDB + Step Functions mocks |

The `ui` container waits for `localstack` to become healthy before starting (`depends_on: condition: service_healthy`).

### 4.2 Logs

```bash
docker compose -f ui/docker-compose.yml logs -f ui
docker compose -f ui/docker-compose.yml logs -f localstack
```

### 4.3 Tear down

```bash
docker compose -f ui/docker-compose.yml down
```

---

## 5. Mode C — Dev EKS deploy

### 5.1 Build + push the image

```bash
# Pick the registry your dev EKS cluster can pull from (ECR, GHCR, GAR, etc).
export REGISTRY=<your-registry-host>/<your-repo>

# Build context = repository root (so ../src is in scope)
docker build -f ui/Dockerfile -t $REGISTRY/classification-service-ui:dev .

# Push
docker push $REGISTRY/classification-service-ui:dev
```

If using ECR:

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 5.2 Substitute the image reference in `k8s/20-ui.yaml`

```bash
sed -i "s|IMAGE_REGISTRY/classification-service-ui:dev|$REGISTRY/classification-service-ui:dev|" ui/k8s/20-ui.yaml
```

### 5.3 Apply

```bash
kubectl apply -f ui/k8s/00-namespace.yaml
kubectl apply -f ui/k8s/10-localstack.yaml
kubectl apply -f ui/k8s/20-ui.yaml

# Wait for rollout
kubectl -n classification-ui rollout status deploy/localstack
kubectl -n classification-ui rollout status deploy/classification-ui
```

### 5.4 Open it

**Option 1 — port-forward (no ingress required, quickest):**

```bash
kubectl -n classification-ui port-forward svc/classification-ui 3000:80
```

Then open <http://localhost:3000>.

**Option 2 — Ingress (AWS Load Balancer Controller):**

```bash
# Edit ui/k8s/30-ingress.yaml — set `host:` to your real dev hostname.
kubectl apply -f ui/k8s/30-ingress.yaml

# Wait for the ALB to be provisioned, then get the address:
kubectl -n classification-ui get ingress classification-ui -w
```

### 5.5 Logs from the pod

```bash
kubectl -n classification-ui logs -f deploy/classification-ui
kubectl -n classification-ui logs -f deploy/localstack
```

### 5.6 Tear down

```bash
kubectl delete -f ui/k8s/   # deletes the whole namespace + everything in it
```

---

## 6. Pointing at real AWS instead of LocalStack

The UI talks to AWS endpoints exclusively through the `AWS_ENDPOINT_URL` env var. To target real AWS:

1. **Local**: unset `AWS_ENDPOINT_URL` and set normal AWS creds (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID/SECRET`).
2. **EKS**: remove `AWS_ENDPOINT_URL` from `k8s/20-ui.yaml` ConfigMap and attach an IRSA-bound ServiceAccount to the Deployment with permissions for the dev DDB tables + S3 bucket. Update `CONTENT_HASH_TABLE_NAME` / `WORKSPACE_CONFIG_TABLE_NAME` / `UI_S3_BUCKET` to match the real resources from `infra/lib/data-stack.ts`.

> **Warning:** doing this writes real DDB rows + S3 objects in the dev account. Use a dedicated workspaceId like `wks-ui-test-001` so test rows are easy to filter and clean up.

---

## 7. API contract

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ready, endpoint, tables, latencyMs }` |
| `GET` | `/api/stats` | — | `{ total, errors, byTier, byCategory, byFormat, recent[] }` |
| `GET` | `/api/workspaces` | — | `{ workspaces[] }` |
| `POST` | `/api/workspaces` | `WorkspaceConfig` partial | `{ workspace }` |
| `POST` | `/api/classify` | multipart `file`+`workspaceId`+hints | `{ ok, result, elapsedMs, documentId, objectKey, inputName }` |

The `classify` endpoint:

1. Uploads the file to S3 (`s3://${UI_S3_BUCKET}/ui/<documentId>/<inputName>`)
2. Constructs a `TaskPayload` matching `src/shared/types.ts`
3. Calls `service.classify(payload)` directly (bypasses the Lambda handler's SFN-callback wrapper since this is a UI, not a Step Functions invocation)
4. Records a counter snapshot for the dashboard

---

## 8. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `getaddrinfo ENOTFOUND localstack` (local dev) | Mode A expects LocalStack on `localhost:4566`. If you started compose first, port 4566 is already taken — `docker ps`, stop the compose stack |
| UI shows `LocalStack: error` | `curl -fsS http://localhost:4566/_localstack/health` — fix the LocalStack container first |
| `Classify` returns 422 with `"store: not-found"` | Workspace wasn't seeded. Use the workspace form first, or check the workspaceId matches |
| `Classify` returns 422 with `"s3: object-not-found"` | The UI's S3 upload silently failed earlier. Check `/api/health` → tables list should include `content-hashes-ui` + `workspace-config-ui`; check Docker logs for an upload error |
| Compose build fails: `Cannot find module '@svc/...'` | Build context must be the **repository root**, not `ui/`. The compose file already sets `context: ..` — make sure you're running `docker compose -f ui/docker-compose.yml ...` from the repo root, not from `ui/` |
| EKS pod CrashLoopBackOff with `EACCES` | The Dockerfile runs as `node` (uid 1000). If your registry's image scanner injected a wrapper that requires root, switch the `USER` line in the Dockerfile or scrub the wrapper |
| EKS readiness probe failing | `kubectl -n classification-ui logs deploy/classification-ui` — usually LocalStack isn't ready yet; the UI's `/api/health` returns 503 until it is. Check `kubectl -n classification-ui get pods` for the localstack pod status |
| Hot reload not working in mode A | Restart `npm run dev`. The classifier wiring caches a singleton; HMR only refreshes the React tree, not the server module graph |

---

## 9. CI parity (when ready)

```bash
cd ui
npm run typecheck
npm run lint
npm run build
```

The repo's main test suite (`npm test` from the root) is **separate** from this UI and remains the authority for service correctness. The UI exists only to drive the same code interactively.
