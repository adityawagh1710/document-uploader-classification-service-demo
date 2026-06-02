# dev05 Deployment — Resource Reference

**Deployed:** 2026-05-27 · **Topology:** Option A (UI in-process classifier → real DynamoDB + S3 via IRSA; no Lambda/Step Functions) · **Image:** `276ccae` (= main HEAD at deploy)
**Account:** `537462380503` · **Region:** `eu-west-1` · **AWS profile:** `opus2-dev` (SSO Admins)

> Note: the ALB inbound allowlist + any personal egress IP are intentionally NOT recorded here (this file is git-tracked, repo is public). The home-IP allowlist runtime step lives in session memory.

---

## 🌐 Application URLs (public, via ALB — locked to the 14-CIDR corp allowlist)

| What | URL |
|------|-----|
| Dashboard | https://classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com/ |
| Health | https://classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com/api/health |
| Target info | https://classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com/api/target |
| API docs (Swagger) | https://classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com/docs |
| OpenAPI spec | https://classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com/openapi.yaml |

- **ALB hostname:** `k8s-classificationser-787f311ad1-1995562468.eu-west-1.elb.amazonaws.com`
- **ALB resolved IPs (at deploy):** `54.155.147.96`, `54.194.61.213`
- **TLS:** wildcard ACM cert `*.dev05.k8s.opus2dev.com` (`arn:aws:acm:eu-west-1:537462380503:certificate/fab42f33-7d67-4ecf-b200-38af584485b0`)
- Access is allowlisted to corp CIDRs. From a non-allowlisted IP it times out. Fallback = port-forward (needs the `HOSTNAME=0.0.0.0` fix — see Known Issues).

## ☸️ Kubernetes (EKS: `DEV05-EKS-CLUSTER`)

- **Namespace:** `classification-service-sandbox`
- **Deployment / Service / Ingress:** `classification-ui`
- **ServiceAccount:** `classification-ui` (IRSA-annotated)
- **Cluster API:** https://4CD18ACA973AEF3E3D289F4092A757EA.gr7.eu-west-1.eks.amazonaws.com
- **OIDC issuer:** https://oidc.eks.eu-west-1.amazonaws.com/id/4CD18ACA973AEF3E3D289F4092A757EA
- **EKS console:** https://eu-west-1.console.aws.amazon.com/eks/home?region=eu-west-1#/clusters/DEV05-EKS-CLUSTER
- **Local access (after HOSTNAME fix):** `make pf-start` → http://localhost:3000

## 🗄️ DynamoDB tables

| Table | ARN | Console |
|-------|-----|---------|
| `content-hashes-dev` (dedup ledger) | `arn:aws:dynamodb:eu-west-1:537462380503:table/content-hashes-dev` | https://eu-west-1.console.aws.amazon.com/dynamodbv2/home?region=eu-west-1#table?name=content-hashes-dev |
| `workspace-config-dev` (policy) | `arn:aws:dynamodb:eu-west-1:537462380503:table/workspace-config-dev` | https://eu-west-1.console.aws.amazon.com/dynamodbv2/home?region=eu-west-1#table?name=workspace-config-dev |
| `classifications-dev` (Recent feed) | `arn:aws:dynamodb:eu-west-1:537462380503:table/classifications-dev` | https://eu-west-1.console.aws.amazon.com/dynamodbv2/home?region=eu-west-1#table?name=classifications-dev |

Seeded workspace: `wks-ui-001`.

## 🪣 S3

- **Bucket:** `classification-ui-dev05` (private; Block Public Access on) — uploads under `ui/<documentId>/<filename>`
- **ARN:** `arn:aws:s3:::classification-ui-dev05`
- **Console:** https://eu-west-1.console.aws.amazon.com/s3/buckets/classification-ui-dev05?region=eu-west-1

## 🔐 IAM (IRSA)

- **Role:** `arn:aws:iam::537462380503:role/classification-ui-irsa` (inline policy `classification-ui-access`)
- **Trust:** `system:serviceaccount:classification-service-sandbox:classification-ui` via the cluster OIDC provider
- **Console:** https://us-east-1.console.aws.amazon.com/iam/home#/roles/classification-ui-irsa

## 📦 ECR

- **Repo:** `537462380503.dkr.ecr.eu-west-1.amazonaws.com/classification-service-sandbox/classification-service-ui`
- **Deployed tag:** `276ccae`
- **Console:** https://eu-west-1.console.aws.amazon.com/ecr/repositories/private/537462380503/classification-service-sandbox/classification-service-ui?region=eu-west-1

## ☁️ CloudFormation

- **Stack:** `ClassificationData-dev` (`arn:aws:cloudformation:eu-west-1:537462380503:stack/ClassificationData-dev/c3dd6b60-59a5-11f1-a799-0a6da1225479`)
- **Bootstrap:** `CDKToolkit` (created in eu-west-1 during this deploy)
- **Console:** https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks?filteringText=ClassificationData-dev

## 🌎 Route 53

- **Hosted zone:** `dev05.k8s.opus2dev.com` (`Z045669519R5D9D8CKC79`)
- **Record:** `classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com` → A-alias → ALB (change id `C103186122RBWZIAKM1DK`)
- **Console:** https://us-east-1.console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/Z045669519R5D9D8CKC79

## 🐙 Source

- **Repo:** https://github.com/adityawagh1710/document-uploader-classification-service-demo
- **Merged commit (main):** `276ccae`
- **Runbook:** `deploy/AWS_TOPOLOGY.md` · **Deploy logs:** `deploy/logs/deploy-20260527-141549.log` + `manifest-20260527-141549.yaml`

---

## ✅ Verified (2026-05-27, via in-cluster + presigned)

health `ready:true` (aws:eu-west-1) · target `backend:real-aws` · classify pdf→ocr-direct · `content-hashes-dev` + `classifications-dev` rows written · S3 object present · presigned download HTTP 200 (`%PDF`).

## ⚠️ Known issues / follow-ups

1. **`make pf-start` (port-forward) broken** — Next.js standalone binds to the pod IP (K8s sets `HOSTNAME`=pod name), not loopback. ALB + probes work; port-forward (loopback) is refused. **Fix:** add `HOSTNAME: "0.0.0.0"` to the UI deployment env (chart `config`), `helm upgrade`. Restores port-forward as the IP-independent access path.
2. **Public URL is CIDR-gated** — non-allowlisted IPs time out. Add your egress `/32` as a runtime annotation on the Ingress `alb.ingress.kubernetes.io/inbound-cidrs` (wipes on next `make deploy-dev`). Past sessions also hit a corp split-tunnel routing issue reaching the ALB public IPs even when allowlisted.

## 🔧 Teardown (if needed)

```bash
make undeploy-dev DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79
# data persists — delete explicitly if desired:
#   npx cdk destroy ClassificationData-dev --profile opus2-dev
#   aws s3 rb s3://classification-ui-dev05 --force --profile opus2-dev
#   aws iam delete-role-policy --role-name classification-ui-irsa --policy-name classification-ui-access --profile opus2-dev && aws iam delete-role --role-name classification-ui-irsa --profile opus2-dev
```
