# deploy/

DEV05-EKS-CLUSTER deployment artifacts for the **classification-ui** dashboard.
The repo-root `docker-compose.yml` remains the canonical local runtime; this
directory is for the **shared dev cluster** install (namespace
`classification-service-sandbox`).

The classification Lambda itself runs on AWS Lambda, not here — these
manifests cover only the in-cluster Next.js UI + a LocalStack sidecar.

## Layout

```
deploy/
├── README.md                    ← this file
├── helm/
│   └── classification-ui/       ← Helm chart (UI + LocalStack + optional Ingress)
├── scripts/
│   ├── portforward.sh           ← idempotent kubectl port-forward wrapper
│   ├── route53-upsert.sh        ← UPSERTs A-alias INGRESS_HOST → live ALB
│   └── route53-delete.sh        ← DELETEs A-alias (runs BEFORE helm uninstall)
└── logs/                        ← timestamped deploy/undeploy/manifest snapshots (gitignored)
```

## Prerequisites

- `kubectl` configured against `DEV05-EKS-CLUSTER` (account `537462380503`, region `eu-west-1`, profile `opus2-dev`).
- `helm` v3.16+ (v4 also works).
- `aws` CLI with `opus2-dev` SSO credentials.
- `docker` (image build runs via the existing `ui/Dockerfile`).
- Corp VPN active.

Verify with:

```bash
make check-helm check-kubectl check-aws check-docker
```

## Common workflows

All commands run from the **repo root**.

### Deploy

Port-forward mode (no ALB, $0/mo recurring):

```bash
make deploy-dev DEPLOY_IMAGE_TAG=$(git rev-parse --short HEAD)
make pf-start                # background pf to http://localhost:3000
```

Ingress mode (internet-facing ALB + Route 53 A-alias + corp-CIDR allowlist):

```bash
make deploy-dev \
    DEPLOY_IMAGE_TAG=$(git rev-parse --short HEAD) \
    DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com \
    DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79
```

The chart's Ingress mirrors the proven dev05 pattern (argocd → aspose-total →
classification-ui): `scheme: internet-facing` ALB, dual HTTP+HTTPS listeners
with HTTP→HTTPS 301 redirect, fronted by the cluster wildcard ACM cert
`*.dev05.k8s.opus2dev.com`, locked down by an `inbound-cidrs` allowlist of
corp egress IPs. `idle_timeout` is 300 s so 1 GiB streaming uploads don't
stall the ALB. All defaults live in `helm/classification-ui/values.yaml`;
override at install with `--set ingress.<field>=…`.

Refresh the CIDR allowlist from argocd before each deploy if office IPs have
changed:

```bash
kubectl -n argocd get ingress argocd-http-ingress \
  -o jsonpath='{.metadata.annotations.alb\.ingress\.kubernetes\.io/inbound-cidrs}'
```

To share aspose's ALB (drops the per-app LB cost): add
`--set ingress.groupName=office-convert` to the deploy command.

`make deploy-dev` is an idempotent **8-step pipeline**:

1. **undeploy-first** (best-effort if a release exists; skipped on first deploy)
2. **ECR repo ensure** — `aws ecr describe-repositories || create-repository`
3. **ECR login** — `aws ecr get-login-password | docker login`
4. **Image build** — `docker build --platform linux/amd64 -f ui/Dockerfile`
5. **Image push** — `docker push <repo>:<tag>`
6. **Helm upgrade --install** — chart at `deploy/helm/classification-ui/`
7. **Manifest snapshot** — `helm get manifest` → `deploy/logs/manifest-<ts>.yaml`
8. **Route 53 sync** — UPSERTs the A-alias if `DEPLOY_INGRESS_HOST` + `DEPLOY_ROUTE53_ZONE_ID` are set; skipped otherwise

Plus a final **status** print (`kubectl get pods,svc,ingress`). Logs land in `deploy/logs/deploy-<ts>.log`; the rendered manifest is in `deploy/logs/manifest-<ts>.yaml`.

### Tear down

```bash
make undeploy-dev \
    DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com \
    DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79
```

**4-step pipeline:**

1. **route53-cleanup** — DELETEs the A-alias **first**, while the Ingress still holds the ALB DNS name needed for the Route 53 DELETE payload
2. **helm-undeploy** — `helm uninstall <release>`
3. **namespace drop** — `kubectl delete ns <namespace>`

ECR images are retained by design. AWS LBC deprovisions the ALB in ~60 s after `helm uninstall`. Re-running `deploy-dev` allocates a fresh ALB hostname; `route53-upsert.sh` repoints DNS automatically so the bookmarkable FQDN survives any teardown/rebuild cycle.

### Browser access (port-forward, no ALB)

```bash
make pf-start    # spawn detached pf to http://localhost:3000
make pf-status   # PID + port + /api/health probe
make pf-restart
make pf-stop
```

The wrapper walks 10 consecutive local ports if `3000` is taken, kills its own previous instance on re-`start`, and health-probes `/api/health`. State lives in `/tmp/classification-ui-portforward.{pid,port}`; logs in `deploy/logs/portforward.log`.

### Dry-run / inspection

```bash
make helm-lint                                                 # static lint
make helm-template                                             # render → stdout + deploy/logs/manifest-<ts>.yaml
make helm-template DEPLOY_INGRESS_HOST=foo.example.com         # render with Ingress
make manifest-snapshot                                         # helm get manifest from live release
```

## Variables

All defaults live at the top of the Makefile `[deploy]` section.

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_IMAGE_TAG` | `$(git rev-parse --short HEAD)` | ECR tag pushed + helm `--set image.tag` |
| `DEPLOY_NAMESPACE` | `classification-service-sandbox` | K8s namespace + helm `--namespace` |
| `DEPLOY_HELM_RELEASE` | `classification-ui` | Helm release name |
| `DEPLOY_INGRESS_HOST` | *(unset)* | FQDN for ALB. Unset = no Ingress + no Route 53 sync |
| `DEPLOY_ROUTE53_ZONE_ID` | *(unset)* | Hosted zone holding `DEPLOY_INGRESS_HOST`; required when host is set |
| `DEPLOY_AWS_PROFILE` | `opus2-dev` | AWS profile for ECR + Route 53 |
| `DEPLOY_AWS_REGION` | `eu-west-1` | AWS region |
| `DEPLOY_AWS_ACCOUNT_ID` | `537462380503` | Account that owns the ECR repo |
| `DEPLOY_ECR_REPO` | `classification-service-sandbox/classification-service-ui` | ECR repository name (created on first deploy) |

## What the chart ships

`deploy/helm/classification-ui/` contains:

- **UI Deployment** — Next.js dashboard (`ui/Dockerfile` build); `0.2–1 CPU`, `512Mi–1Gi memory`; readiness + liveness probes against `/api/health`
- **UI Service** — `ClusterIP` :80 → :3000
- **LocalStack Deployment** — `localstack/localstack:3.7.0`, S3 + DDB + Step Functions; `0.2–1 CPU`, `512Mi–1Gi memory`; gated by `localstack.enabled` (default `true`)
- **LocalStack Service** — `ClusterIP` :4566
- **ConfigMap** — `AWS_ENDPOINT_URL`, table names, bucket name — consumed via `envFrom` by the UI
- **Namespace** — gated by `namespace.create=true` (default)
- **Ingress** — `internet-facing` ALB with HTTP+HTTPS listeners, HTTP→HTTPS 301 redirect, wildcard ACM cert (`*.dev05.k8s.opus2dev.com`), CIDR-allowlist locked to corp egress IPs, 300 s idle timeout. Conditional on `ingress.enabled=true`; pairs with `route53-upsert.sh` for stable DNS. Group-name `classification-service` (set `ingress.groupName=office-convert` to share aspose's ALB).

The UI lazy-provisions LocalStack on first request (same `ensureLocalStackReady()` code path the local docker-compose uses), so the first hit after a deploy is slow (table + bucket creation). Subsequent hits are fast.

## Known constraints

- Image platform is forced to `linux/amd64` because EKS nodes are x86_64. If you build on Apple Silicon, this triggers an emulated build (~2× slower).
- LocalStack `PERSISTENCE=0` — every pod restart loses tables/objects. Fine for sandbox; trade-off documented in [`/home/adityawagh/.claude/projects/-home-adityawagh-opus2-workspace-classification-service/memory/project_classification_service.md`](memory).
- Route 53 scripts assume the AliasTarget points at an **ALB** (uses `elbv2 describe-load-balancers` to resolve `CanonicalHostedZoneId`). NLB / CLB would need a different lookup.
