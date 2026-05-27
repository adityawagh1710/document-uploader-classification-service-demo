# Design — Auto-convert on `category=convert` → office-convert → store PDF → surface

**Status:** Proposed (research complete; not implemented) · **Date:** 2026-05-27 · **Author:** AI-DLC (with awagh@opus2.com)

## 1. Goal

When the classifier emits `classification.category === "convert"`, automatically run the document through the **office-convert** service (`/home/adityawagh/opus2-workspace/aspose-total`), **store the resulting PDF**, and surface it:
1. as a **"Download PDF"** action in the dashboard's **Recent classifications** (dev05/UI), and
2. (stretch) in **office-convert's Conversion History**.

The design must be **production-shaped, not a dev05 bolt-on** — see §6.

## 2. Current state (researched 2026-05-27)

### Classification service (this repo)
- The classifier is a **pure decision point** — `technical_input.md §1.3` non-goal: *"does not perform conversion"*; `§1.2`: downstream branches (Conversion/OCR/…) are *"selected by the category this service emits."* In production it's a **Step Functions task** that emits `category` + `SendTaskSuccess`.
- A **manual** "Convert to PDF" button already exists (`ui/components/ClassifyForm.tsx:277`, shown when `category==="convert"`): POSTs the file to `ui/app/api/convert/route.ts` → proxies to office-convert `/v1/convert` → **streams the PDF to the browser. It is NOT stored** and is UI-manual only.
- `classifications-dev` DynamoDB table is the **UI-layer** Recent feed (one row per upload); ResultPanel already renders a **presigned "Download original"** (`ui/app/api/runs/[documentId]/route.ts`). These are dashboard constructs — **production has no such table/UI**.

### office-convert (aspose-total) — sibling service
- `POST /v1/convert` — **synchronous HTTP**; multipart `file` (primary) or `s3_input` s3:// URL (**feature-flagged OFF on EKS**); optional `s3_output` sink → `s3://bucket/pdf/{request_id}.pdf` (**also OFF by default**); returns **PDF bytes inline**; `GET /v1/downloads/presign` mints a short-TTL URL.
- **No conversion-history store of any kind** — no DB. The "Conversion History" is **in-memory in the Streamlit UI process** (`office_convert_ui/app.py`, cap 20, lost on restart) and only records conversions **that UI itself ran**.
- **No SQS/queue/Lambda/webhook** — synchronous HTTP only.
- Deployed on dev05 (ns `office-convert-dev`): in-cluster `http://office-convert.office-convert-dev.svc.cluster.local:80`; public `https://office-convert-api-dev-sandbox-v1.dev05.k8s.opus2dev.com`.

## 3. Core principle

**Do NOT trigger conversion from the classify call/path.** That would violate the classifier's pure-decision-point contract and is not how production routes (Step Functions owns downstream branching). Instead: the classifier emits `category=convert`; a **separate, trigger-agnostic convert worker** does the conversion. Only the *trigger* and the *surfacing* differ per environment.

## 4. Architecture — the trigger-agnostic convert worker

A standalone **convert-worker Lambda**, written once, reusable in both environments:

```
input:  { s3Bucket, s3Key, documentId, workspaceId, inputName }
steps:  1. GET object from S3
        2. POST multipart → office-convert /v1/convert   (reuse the existing HTTP contract)
        3. PUT returned PDF → s3://<bucket>/converted/<documentId>.pdf
        4. emit result: { documentId, convertedPdfKey, status, bytes }
```

- **dev05 wiring:** UI `/api/classify`, on `category=convert`, drops an **SQS** message → convert-worker Lambda consumes it → stores PDF → updates the `classifications-dev` row (`convertedPdfKey` + `convertStatus`). Recent table (4 s poll) then shows **"⬇ Download PDF"** via presign.
- **production wiring:** the **Step Functions** convert branch invokes the **same** convert-worker Lambda as a task → stores PDF → the downstream pipeline consumes it (no dashboard).

office-convert is HTTP-only, so **we** own the SQS→HTTP bridge (the worker); office-convert is never an SQS consumer. Use the **multipart path** (fetch from S3, POST bytes) to avoid enabling office-convert's `s3_input`/`s3_output` flags + bucket allowlist + cross-service IRSA. (Enabling `s3_output` is an alternative; not required.)

## 5. Storage procedure

Converted PDFs land at **`s3://classification-ui-dev05/converted/<documentId>.pdf`** (dev05). Production uses the pipeline's output bucket with the same `converted/<documentId>.pdf` convention. The worker sets `ContentType: application/pdf`. Retrieval everywhere is via **presigned GET** (same pattern as "Download original").

## 6. Per-component: dev05 vs production compatibility

| Component | dev05 | prod | Notes |
|---|---|---|---|
| Classifier emits `category=convert` | ✅ | ✅ | unchanged; stays pure |
| **Convert-worker Lambda** (S3 → /v1/convert → store) | ✅ | ✅ | **the reusable core — write once** |
| Trigger | SQS (UI enqueues) | Step Functions task | substitute for the missing state machine on dev05 |
| Store PDF to S3 | ✅ | ✅ | bucket/prefix differ; action identical |
| Recent "Download PDF" button | ✅ | ❌ | `classifications-dev` + Recent feed are **UI-only**; no prod equivalent |
| office-convert Conversion History | ⚠️ build | ⚠️ build | same gap both envs |

**Verdict:** the worker + S3 storage is **production-compatible**; the SQS trigger and the Recent-PDF UI are **dev05 shells** around it. Nothing in the dev05 build is throwaway — the worker carries to prod.

## 7. The office-convert Conversion History gap

office-convert has **no persistent history and no "record a conversion" API** — its UI history is in-memory and only logs UI-initiated conversions, so an externally-triggered conversion won't appear. Options:
- **(a) Skip it** — surface the PDF only in our Recent table (cleanest; no office-convert changes; ~75% of the value).
- **(b) Build persistent history in office-convert** — a history store (DynamoDB/S3-index) + record-on-convert + a GET-history API + UI change to read it. Substantial, cross-repo; arguably the right long-term design but out of scope here.
- **(c) `s3_output` tee** — have the worker pass `s3_output` so office-convert tees the PDF to a shared S3 prefix; still doesn't make it show in office-convert's UI without (b).

Recommended: **(a)** now; treat **(b)** as a separate cross-repo initiative.

## 8. Recommended phasing

1. **Phase 1 (our stack, prod-shaped core):** convert-worker Lambda + SQS trigger from `/api/classify` (dev05) + store to `converted/` + `classifications-dev` row gains `convertedPdfKey`/`convertStatus` + ResultPanel "Download PDF" presign. CDK adds the queue + worker + IAM; `make`/runbook wiring.
2. **Phase 2 (prod):** wire the same worker as the Step Functions convert-branch task when the real pipeline exists.
3. **Phase 3 (optional):** persistent Conversion History in office-convert (option b).

## 9. Open decisions
- Multipart fetch-then-POST (no office-convert config) **vs** enabling `s3_input`/`s3_output` (needs flags + bucket allowlist + office-convert IRSA to our bucket). *Lean: multipart.*
- Retry/failure semantics (SQS DLQ; `convertStatus` = `pending|done|failed` shown in Recent).
- Idempotency (key by `documentId`; converted object overwrite-safe).
- TTL on converted PDFs (mirror the `classifications-dev` TTL? lifecycle rule on `converted/`).

## 10. Non-goals
- Triggering conversion inside the classify path (breaks the pure-decision-point contract).
- Making office-convert consume SQS (it's HTTP-only; we bridge).
- Treating office-convert's in-memory UI history as a system of record.
