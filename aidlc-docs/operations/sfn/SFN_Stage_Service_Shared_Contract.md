# Stage-Service Shared Contract for Step Functions Orchestration

**Audience:** every pipeline stage service **except classification** — office-convert,
html-convert, media-convert, zip-extraction, email-extraction, ocr, pdf-processing,
image/tiff, tiff-to-cog, slipsheet, output-assembly.

**Why this exists:** classification is the entry point (sync `/classify`). Everything
downstream is orchestrated by a Step Functions state machine over the shared
`pipeline-contracts`. For SFN to drive a document through these stages with **no
integration surprises**, each stage must keep a small set of things **common**. This
doc is the checklist. It is written from a real failure: wiring `.docx → office-convert`
broke because office-convert used its **own** LocalStack + a bucket **allowlist**
(`office-convert-in/out`) that rejected the pipeline's bucket — orchestration can't fix
a divergent data plane.

> Source-of-truth contracts live in `libs/pipeline-contracts/` (JSON Schema + codegen).
> Platform mandates live in `document-uploader/aidlc-docs/inception/tech-environment.md`.
> This doc is the SFN-specific slice; promote it into the platform contracts repo.

---

## 0. The orchestration model (so the rest makes sense)

- **Standard** state machine, one execution per document (`executionName = documentId`).
- Each stage is invoked as an **SQS `.waitForTaskToken`** task: SFN drops a `StageRequest`
  (carrying a `taskToken`) on the stage's queue; the stage **worker** does the work and
  calls `SendTaskSuccess` / `SendTaskFailure`. SFN owns retries/timeouts/catch.
- **Two roles per stage** — keep them distinct:
  - **Stage worker** (SQS consumer): holds the task token, talks the envelope, writes the
    claim-check, signals SFN. → owns §2–§6, §8–§9.
  - **Converter service** (e.g. office-convert, Gotenberg, FFmpeg): a pure function over
    S3 in→out. → owns §1 (the data plane) + §5 (error/duration).
  - Heavy bytes never cross the wire — only S3 claim-check pointers do.

---

## 1. Shared S3 / claim-check plane  ← THE one that bit us

Everything that touches bytes must agree on **one** S3 world.

| Must be common | Requirement |
|---|---|
| **Endpoint** | Local: **one** LocalStack (`http://localstack:4566`), not a per-service instance. AWS: same region + account (or cross-account bucket policy granting access). |
| **Region** | Single region per env (`eu-west-1` dev). No per-service region drift. |
| **Bucket(s)** | A stage MUST accept the **pipeline staging bucket** (`classification-ui-bucket` locally / `docuploader-staging-<env>` in AWS). **No allowlist that rejects it.** If you keep your own in/out buckets, grant the pipeline role + the orchestrator read/write on them and accept the pipeline bucket as input. |
| **Key conventions** | Read `source.{bucket,key}` from the claim-check verbatim. Write outputs under an agreed prefix the contract names (e.g. `converted/<documentId>.pdf`, `extracted/…`). Don't invent private prefixes the next stage can't find. |
| **Encryption** | SSE-KMS with the shared per-tenant alias; every reader/writer role gets `kms:Decrypt`/`GenerateDataKey` on it. |
| **Presign host** | If you mint browser-facing download URLs, sign against the shared **public** endpoint (`S3_PUBLIC_ENDPOINT` / `*_S3_PUBLIC_ENDPOINT`), not the in-cluster host. |

**office-convert example (what to change):** `OFFICE_CONVERT_S3_INPUT/OUTPUT_BUCKETS_ALLOWLIST`
must include the pipeline bucket, and `AWS_ENDPOINT_URL_S3` must point at the shared
LocalStack — otherwise it reads the wrong store / 400s on the bucket.

---

## 2. Shared message envelope (the wire contract)

Consume **`StageRequest`** and emit **`StageStatusUpdate`** from `libs/pipeline-contracts`
(don't hand-roll). The mandatory spine on every message:

- `schemaVersion` — **additive-only** evolution; never break existing fields.
- `kind`, `messageId`, `correlationId`, `pipelineExecutionId`
- `tenantId`, `documentId`
- `source` — the **claim-check** `{ bucket, key }`
- `traceparent` — W3C Trace Context, propagated on **every** hop
- `idempotencyKey`
- `taskToken` — the SFN callback token (see §3)
- `stage`, `options` (stage-specific, typed)

Generate your types from the shared JSON Schema (Go `go-jsonschema` / TS `json-schema-to-zod`
/ Py `datamodel-code-generator`) so all stages stay in lockstep. Run the drift gate.

---

## 3. Task-token completion signal (SFN core)

- The stage worker MUST read `taskToken` from the request and, when done, call
  **`states:SendTaskSuccess`** (with the result payload) or **`states:SendTaskFailure`**
  (with `{ error, cause }`). No token signal ⇒ the execution hangs until timeout.
- Converter services that are plain request/response (office-convert) **don't** need to
  know about tokens — the **worker** fronting them holds the token and signals after the
  HTTP call returns. Keep that split.
- SendTaskSuccess output should be small (a status + the output claim-check), not bytes.

---

## 4. Idempotency

SFN **will** retry. Every stage MUST be idempotent on `idempotencyKey` (and/or
`(documentId, stage)`): re-processing the same request must not double-write, double-emit,
or corrupt state. Use conditional writes / dedup the same way classification does on
content-hash.

---

## 5. Uniform error + retryable classification

So SFN `Retry`/`Catch` can branch correctly:

- Emit the shared error envelope `{ code, message, detail, retryable, extensions }`.
- Map your failures to **retryable** (transient: throttling, 5xx, timeout) vs **terminal**
  (bad input, unsupported format → e.g. office-convert's DWG case). Terminal ⇒
  `SendTaskFailure` with a stable `error` code SFN catches and routes to a fail state;
  retryable ⇒ either retry internally or fail in a way SFN's `Retry` re-drives.
- Don't bury failures in a 200 — SFN can't see them.

---

## 6. Bounded duration + heartbeats

- Declare a realistic worst-case duration; SFN sets `TimeoutSeconds` per state (this is
  what **replaces the convert-watchdog** cron).
- For long tasks (office-convert on big PPTX/XLSX), the worker must **either** finish
  within the SQS visibility window **or** send SQS visibility heartbeats / SFN
  `SendTaskHeartbeat` so neither the queue nor the state times the task out mid-flight.
- Stream / bound RAM regardless of input size (platform NFR).

---

## 7. Shared status/DDB conventions (if a stage writes status)

If a stage mutates the activity row (like the convert worker writes `convertStatus`):
- Same table + **key shape**: `workspaceId` (PK) + `runId` = `<ISO-ts>#<documentId>` (SK).
- Use the agreed attribute names (`<stage>Status`, `<stage>S3Bucket/Key`, `<stage>Error`,
  `<stage>StartedAt/CompletedAt`) and conditional updates so a watchdog/retry race is safe.
- Prefer letting **SFN execution state** be the source of truth for "where is this doc";
  the DDB row is a denormalized view for the UI.

---

## 8. IAM / IRSA (no static creds)

Each stage's role needs, at minimum:
- `states:SendTaskSuccess`, `states:SendTaskFailure`, `states:SendTaskHeartbeat` (resource `*` — tokens aren't ARN-scopable).
- `sqs:ReceiveMessage`/`DeleteMessage`/`GetQueueAttributes` on its own queue.
- `s3:GetObject` on the input bucket(s) + `s3:PutObject` on the output prefix.
- `kms:Decrypt`/`GenerateDataKey` on the shared alias.
- The state-machine execution role needs `sqs:SendMessage` to each stage queue it dispatches to.

---

## 9. Observability correlation

- Propagate `traceparent` into every log line + downstream call (HTTP/SQS attrs/SFN input).
- Structured JSON with the required fields: `trace_id`, `span_id`, `tenant_id`,
  `workspace_id`, `document_id`, `execution_id`, `pipeline_stage`. OTLP → Grafana Alloy.
- This is what makes one SFN execution traceable across N services. Strict redaction
  (never log tokens / presigned URLs / customer content).

---

## 10. Naming, queues, region/account

- One token `docuploader` in resource identifiers; per-env suffixes (`-dev`/`-staging`/none).
- The **stage → queue URL** map is shared config (`stages.yaml`); the orchestrator and the
  workers read the same names.
- Same region/account per env, or explicit cross-account resource policies (S3 bucket
  policy, KMS key policy, SQS policy) — otherwise SFN dispatch + S3 reads silently 403.

---

## Per-service Definition of Done (self-check before joining the pipeline)

- [ ] Reads/writes the **shared** S3 (same endpoint+region) and **accepts the pipeline
      staging bucket** (no allowlist rejecting it); writes outputs to the agreed prefix.
- [ ] Consumes `StageRequest` / emits `StageStatusUpdate` from `libs/pipeline-contracts`
      (codegen, not hand-rolled); `schemaVersion` present.
- [ ] Reads `taskToken` and calls `SendTaskSuccess`/`SendTaskFailure`.
- [ ] Idempotent on `idempotencyKey`.
- [ ] Emits the shared error envelope with correct `retryable`.
- [ ] Bounded duration + heartbeats for long work; streams (bounded RAM).
- [ ] Propagates `traceparent`; logs the required correlation fields (OTLP→Alloy).
- [ ] IRSA role has the §8 permissions; no static creds.
- [ ] KMS shared alias access; SSE-KMS on writes.
- [ ] Names follow the convention; queue is in the shared `stages.yaml`.

**If all boxes are checked, the stage drops into the SFN state machine with no bespoke glue.**
The single most common miss (and the one that broke office-convert) is the **shared S3 +
bucket allowlist** in §1 — start there.
