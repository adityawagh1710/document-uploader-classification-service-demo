# Integrations — classification-service

How classification-service plugs into the broader Opus 2 system. Maintained as a peer-of-peers index so anyone touching the dispatcher / worker / IAM / bucket-policy surface knows which other services depend on those contracts.

> If you change anything in the "Sends to" sections, also update the consuming repo's `INTEGRATIONS.md`. Both sides MUST stay in sync.

---

## Sends to → `office-conversion-service-demo` (auto-convert pipeline)

**Use case:** When the classifier emits `category=convert` for a document (DOC/DOCX/XLSX/PPTX/RTF/TIFF…), the `/api/classify` route drops a claim-check on the convert SQS queue. A long-lived worker consumes it, calls **office-convert's `POST /v1/convert`** in-cluster with `s3_input` + `s3_output` URIs pointing at our own bucket, then updates the classifications-dev DDB row with terminal state. The Recent table's Conversion column polls this state and renders queued → converting → done (clickable presigned download) → failed.

**Counterpart doc:** [office-conversion-service-demo/INTEGRATIONS.md](https://github.com/adityawagh1710/document-uploader-aspose-total-demo/blob/main/INTEGRATIONS.md)

### Architecture

```
┌─ /api/classify ──┐  SQS msg  ┌─ convert-worker ─┐  HTTP POST   ┌─ office-convert ──┐  S3 GET/PUT  ┌─ classification-ui-dev05 ─┐
│ category=convert ├──────────▶│ EKS Deployment   ├─────────────▶│ /v1/convert       ├─────────────▶│ ui/<docId>/<file>          │
│ → ConvertClaim   │           │ SQS poller       │              │ s3_input/output   │              │ converted/<docId>.pdf      │
│ → DDB queued     │           │ → DDB converting │              │ X-Request-ID      │              └────────────────────────────┘
└──────────────────┘           │ → DDB done|failed│              └───────────────────┘                          ▲
                               └──────────────────┘                                                              │
                                                                                                  presigned GET  │
                                                                                                  (our IRSA)     │
                                                                                              ┌──────────────────┴─┐
                                                                                              │ UI Download PDF btn │
                                                                                              │ /api/runs/[id]      │
                                                                                              └─────────────────────┘
```

### Message contract — `ConvertClaim`

What `/api/classify` puts on the queue (mirror of `worker/src/message.ts` `ConvertClaimSchema` and `src/ports/ConvertDispatcher.ts`):

```jsonc
{
  "pipelineExecutionId": "doc-<uuid>",     // placeholder = documentId today; SFN execution id in prod
  "tenantId": "wks-ui-001",                // = workspaceId (DDB partition key)
  "documentId": "doc-<uuid>",
  "runId": "<ISO-ts>#<documentId>",        // classifications-dev sort key — worker UpdateItem's by it
  "sourceBucket": "classification-ui-dev05",
  "sourceKey": "ui/doc-<uuid>/<filename>",
  "filename": "<filename>",                // drives office-convert format detection
  "subCategory": "office" | "tiff" | "convert-then-ocr" | null,
  "correlationId": "doc-<uuid>"
}
```

### DDB schema additions on `classifications-dev`

Worker writes (UpdateItem); UI reads via `/api/stats` + `/api/runs/<docId>`:

| Attribute | Type | Set by | Note |
|---|---|---|---|
| `convertStatus` | `queued \| converting \| done \| failed \| null` | classify route → worker | `null` = not a convert category |
| `convertDispatch` | `ok \| skipped \| failed \| dwg-excluded` | classify route | reflects SQS SendMessage outcome |
| `convertQueuedAt` | ISO ts | classify route | preserved across worker retries |
| `convertStartedAt` | ISO ts | worker | `if_not_exists()` — first attempt wins |
| `convertCompletedAt` | ISO ts | worker | terminal state only |
| `convertS3Bucket`, `convertS3Key` | string | worker | from office-convert `X-S3-Output-*` headers |
| `convertRequestId` | string | worker | from office-convert `X-Request-ID` — powers the live-progress proxy |
| `convertError` | string (≤500 chars) | worker / watchdog | `office_convert_<status>:<failure_class>` or `format_unsupported:dwg` or `timeout_watchdog` |
| `convertAttempts` | number | worker | from SQS `ApproximateReceiveCount` |

### What office-convert needs from us

| Surface | File | Detail |
|---|---|---|
| IRSA grant on our bucket | (cross-service grant on office-convert's role) | Their role `office-convert-dev-s3` needs `s3:GetObject` on `classification-ui-dev05/ui/*` + `s3:PutObject` on `classification-ui-dev05/converted/*`. Granted by the Sids `ReadClassificationInputs` + `WriteClassificationOutputs` in office-convert's repo (`deploy/iam/office-convert-s3-policy.json`). |
| Bucket allowlist | (Helm values on office-convert side) | Their `s3.inputBucketsAllowlist` AND `s3.outputBucketsAllowlist` must include `classification-ui-dev05`. Applied via their `deploy/helm/office-convert/values-classification-fanout.yaml` overlay. |

### What we provide internally for this pipeline

| Surface | File |
|---|---|
| **CDK queue + DLQ + alarms** | `infra/lib/convert-queue-stack.ts` — `classification-convert-queue-dev` (visibility 30 min) + DLQ (max receive 3) + DLQ-depth alarm + queue-age alarm |
| **Worker IRSA role** | `deploy/iam/convert-worker-irsa-{trust,perms}.json` — SQS poll + DDB UpdateItem + KMS-via-SQS decrypt. No S3 grants (office-convert does that side). |
| **Worker service** | `worker/src/` — SQS poller → office-convert HTTP → DDB UpdateItem. 22-case unit suite. |
| **Worker Helm chart** | `deploy/helm/convert-worker/` — Deployment (Recreate strategy, 120s grace), ConfigMap, IRSA SA. No Service (no inbound). |
| **Dispatcher port + adapter** | `src/ports/ConvertDispatcher.ts` + `src/adapters/sqs-convert-dispatcher/` — mirrors archive-dispatcher pattern |
| **Classify-route fan-out** | `ui/app/api/classify/route.ts` — parallel to `archiveDispatch`; DWG short-circuit baked in |
| **UI Conversion column** | `ui/components/Dashboard.tsx` (`ConvertCell`, `ConvertProgress`) — state-aware rendering + live progress polling |
| **Live-progress proxy** | `ui/app/api/runs/[documentId]/progress/route.ts` — forwards to office-convert `/v1/jobs/<rid>/progress` |
| **Stuck-job watchdog** | `ui/app/api/admin/convert-watchdog/route.ts` + `deploy/k8s/convert-watchdog-cronjob.yaml` — 5-min cron; force-flips `converting` rows older than 35 min to `failed/timeout_watchdog` |
| **Operator runbook** | `deploy/CONVERT_OBSERVABILITY.md` — watchdog apply, SNS alarm wiring, end-to-end verification |

### Required env on the classification-ui pod

For the dispatcher to actually enqueue (else `convertDispatch` silently becomes `skipped`):

```yaml
config:
  CONVERT_QUEUE_URL: "https://sqs.eu-west-1.amazonaws.com/537462380503/classification-convert-queue-dev"
```

Lives in `deploy/helm/classification-ui/values-aws.yaml`. **Forget this and the convert pipeline is silently disabled** — no error surfaces, just `convertDispatch: skipped` on every classify.

### Tested against

| Date | classification HEAD | office-convert state | Result |
|---|---|---|---|
| 2026-05-28 | `feat/auto-convert-integration` | `feat/01` IAM + ConfigMap applied to dev05 | IAM simulator green; office-convert pod env has `classification-ui-dev05` in both allowlists |

---

## Sends to → `zip-extraction-dev-sandbox-v1` (archive fan-out)

**Use case:** When the classifier emits `category=archive`, the `/api/classify` route drops a claim-check on the **sibling team's** SQS queue (`zip-extraction-dev05` in eu-west-1, account 537462380503). Zip-extraction consumes, reads the zip from our bucket, extracts entries, and feeds them back through the classification pipeline (multi-pass).

**No counterpart doc** — zip-extraction is owned by another team and lives outside our repo. The contract is informal but stable.

### Message contract — `ArchiveClaimCheck`

```jsonc
{
  "pipelineExecutionId": "doc-<uuid>",
  "tenantId": "wks-ui-001",
  "documentId": "doc-<uuid>",
  "sourceBucket": "classification-ui-dev05",
  "sourceKey": "ui/doc-<uuid>/<archive.zip>",
  "correlationId": "doc-<uuid>"
}
```

(Note: no `runId`, no `filename`, no `subCategory` — predates the convert flow's contract. The convert claim shape is the more-evolved descendant.)

### What zip-extraction needs from us

| Surface | File | Detail |
|---|---|---|
| Bucket policy grant | `deploy/AWS_TOPOLOGY.md` §3 — bucket policy on `classification-ui-dev05` | Sid `AllowZipExtractionRead`: principal `arn:aws:iam::537462380503:role/zip-extraction-dev05`, `s3:GetObject` on `ui/*`. **Required** — without it the consumer 403s on download. |

### What we provide internally

| Surface | File |
|---|---|
| Dispatcher port + adapter | `src/ports/ArchiveDispatcher.ts` + `src/adapters/sqs-archive-dispatcher/` |
| Classify-route fan-out | `ui/app/api/classify/route.ts` — `archiveDispatch` block |
| Env var | `ZIP_EXTRACTION_QUEUE_URL` — points at `https://sqs.eu-west-1.amazonaws.com/537462380503/zip-extraction-dev05` |
| IRSA grant | `classification-ui-irsa` inline policy Sid `ZipExtractionFanOut` — `sqs:SendMessage` on the queue ARN |

### Tested against

Live verified 2026-05-27. See `aidlc-docs/audit.md` "OPERATIONS — dev05 real-AWS DEPLOY executed + verified" for details.

---

## Adding a new integration

1. Edit this file: add a new "Sends to" or "Consumes from" section.
2. If the counterpart is a service we own, also edit its `INTEGRATIONS.md` to mirror.
3. The technical contract details (message shapes, env vars, IAM Sids, bucket prefixes, HTTP contracts) live HERE. The implementation lives in the linked files (ports, adapters, IAM JSON, Helm chart).
4. Whenever someone changes anything in those linked files, re-read this doc to confirm the cross-service contract isn't silently breaking.
