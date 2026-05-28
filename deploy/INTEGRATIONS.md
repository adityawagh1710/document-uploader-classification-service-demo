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
| 2026-05-28 (morning) | `feat/auto-convert-integration` | `feat/01` IAM + ConfigMap applied to dev05 | IAM simulator green; office-convert pod env has `classification-ui-dev05` in both allowlists |
| 2026-05-28 (afternoon) | `feat/auto-convert-integration` deployed end-to-end on dev05 | office-convert main image `d535452` + cross-service IAM/ConfigMap live | **8 real Office files converted live**: DOCX 4.7–7.4s, PPT(legacy) 3.7–12.5s, XLSX 19.4s, ODS 0.4s, legacy-DOC 26.4s (xlsx→docx format-retry walked). Synthetic OLE2 failed cleanly with `office_convert_422:input_unprocessable`. attempts=1 across the board, DLQ depth=0. |

### Live verification — what worked end-to-end on real-AWS dev05

- ✓ Worker SQS `ReceiveMessage` via `convert-worker-irsa`
- ✓ Worker HTTP POST to office-convert via in-cluster Service DNS
- ✓ Office-convert `s3:GetObject` on `classification-ui-dev05/ui/*` (proven by successful conversions)
- ✓ Office-convert `s3:PutObject` on `classification-ui-dev05/converted/*` (`s3_output_uploaded` events confirmed)
- ✓ Worker captured office-convert's `X-Request-ID` and `X-S3-Output-{Bucket,Key}` headers, stored on DDB row
- ✓ Worker `dynamodb:UpdateItem` on classifications-dev (success + failure paths)
- ✓ 4xx caller errors correctly terminal (no SQS redrive, no DLQ message)
- ✓ Watchdog CronJob curling `/api/admin/convert-watchdog` — returns 200, scans classifications-dev, reaps stuck rows older than 35 min

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

## Sends to → `email-extraction` (App Runner) (added 2026-05-28 by ukadam@opus2.com)

**Use case:** When the classifier emits `category=email` (typically for `.eml` / RFC 5322 / MHTML inputs), the `/api/classify` route makes a **synchronous HTTP fan-out** to a separate email-extraction service running on AWS App Runner. The service parses the message, returns structured JSON (subject / body / attachments / emitted events / etc.), and that response is cached in-process keyed by classifier `documentId`. Clicking the green "email" badge on the Result panel pops a modal that reads the cache.

**No counterpart doc** — email-extraction is owned by a separate team / repo (App Runner endpoint hard-coded today; URL serves as the contract). If they ever start an `INTEGRATIONS.md`, we mirror.

### Architecture (synchronous, no queue)

```
classify route                              email-extraction (App Runner)
─────────────                               ─────────────────
category=email detected                     POST /upload?tenant=…&document=…&message=…
  ↓                                            body: raw file bytes (application/octet-stream)
  POST to EMAIL_EXTRACTION_URL/upload ──────▶
  ↓                                            parses (subject/body/attachments/events)
  receive JSON response  ◀──────────────────  returns JSON
  ↓
  cache JSON in process-local Map<docId, response>  (ui/lib/email-extractions.ts)
  return {ok, emailDispatch: "ok|failed|skipped", ...} to UI

UI Result panel
─────────────
  user clicks green "email" badge
  ↓
  GET /api/runs/<docId>/email-extraction
  ↓
  cache hit → modal renders subject + body + attachments + Raw JSON
  cache miss → 404 → modal shows "no cached extraction"
```

Differs from convert (async via SQS) and archive (async via SQS) in that email is **synchronous in the classify request path** — adds latency to /api/classify but keeps the UX simple. Acceptable because email parsing is fast (typically <1 s per message).

### Request shape — `POST /upload`

| Query param | Value | Note |
|---|---|---|
| `tenant` | `workspaceId` from the classify form | URL-encoded |
| `document` | `documentId` (classifier-assigned) | URL-encoded |
| `message` | fresh `randomUUID()` per classify call | Lets email-extraction key per-message |
| Body | raw file bytes (Content-Type: `application/octet-stream`) | Same bytes that went to S3 |

### Response shape — cached as-is

Open-ended record (App Runner may add fields):

```jsonc
{
  "tenant_id":           "wks-ui-001",
  "document_id":         "doc-<uuid>",
  "message_id":          "<uuid>",
  "subject":             "…" | null,
  "body_source":         "…" | null,
  "is_html":             true | false,
  "body":                "…" | null,
  "body_key":            "s3-key" | null,
  "metadata_key":        "s3-key" | null,
  "attachment_keys":     ["…"] | null,
  "emitted_events":      <number>,
  "nested_emits":        <number>,
  "attachment_failures": <number>,
  "duplicate_skipped":   true | false,
  "depth_limited":       true | false
}
```

### What email-extraction needs from us

| Surface | Detail |
|---|---|
| **Nothing on our infra side** | App Runner is **public HTTPS**; no IAM grants, no bucket policy. The service trusts the upload contract via its own logic. |
| Outbound from our pod | Egress from `classification-service-sandbox` namespace must reach `*.awsapprunner.com` (dev05 cluster nodes have public egress — verified). |

### What we provide internally

| Surface | File |
|---|---|
| **Env var** | `EMAIL_EXTRACTION_URL` (default baked in: `https://byzxx7ymun.eu-west-1.awsapprunner.com`). Empty string disables the fan-out. |
| **Classify-route fan-out** | `ui/app/api/classify/route.ts` — synchronous POST after the classifier emits `category=email`. Failures don't fail the classification (best-effort; logged + `emailDispatch: "failed"` returned). |
| **In-process cache** | `ui/lib/email-extractions.ts` — `Map<documentId, EmailExtractionResponse>` pinned to `globalThis` (survives Next.js HMR, lost on container restart). DDB persistence is the noted upgrade path. |
| **Cache-read endpoint** | `ui/app/api/runs/[documentId]/email-extraction/route.ts` — GET returns cached JSON or 404. |
| **UI surface** | `ui/components/ResultPanel.tsx` — clickable green "email" badge → modal with subject / body source / attachments / events / Raw JSON. |

### Known limitations

- **Cache is process-local** — UI pod restart loses all entries. A row uploaded before the restart will 404 from `/email-extraction` even though the classify succeeded.
- **Lambda parity not yet there** — the deployed Lambda handler (`src/handler/lambda.ts`) doesn't yet fan out to email-extraction. UI-only fan-out for now (per commit `fc721cf` body — "Out of scope: Lambda handler parity").
- **No retries** — synchronous fetch; if App Runner returns 5xx or times out, the row's `emailDispatch="failed"` is final. Re-upload is the recovery.

### Tested against

| Date | classification HEAD | email-extraction state | Result |
|---|---|---|---|
| TBD | `fc721cf` deployed to dev05 | App Runner endpoint live | Awaiting live end-to-end smoke. UI badge click → modal expected. |

---

## Adding a new integration

1. Edit this file: add a new "Sends to" or "Consumes from" section.
2. If the counterpart is a service we own, also edit its `INTEGRATIONS.md` to mirror.
3. The technical contract details (message shapes, env vars, IAM Sids, bucket prefixes, HTTP contracts) live HERE. The implementation lives in the linked files (ports, adapters, IAM JSON, Helm chart).
4. Whenever someone changes anything in those linked files, re-read this doc to confirm the cross-service contract isn't silently breaking.
