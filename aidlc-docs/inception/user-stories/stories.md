# User Stories — Classification Service

> **Conventions** (per approved `story-generation-plan.md`):
> - **Hybrid grouping**: persona first, feature second (Q1=D)
> - **Format**: Connextra for human personas, Job Story for system personas (Q4=C)
> - **AC style**: Given/When/Then (Q5=A)
> - **Traceability**: inline `Traces:` line per story + end-of-file matrix (Q6=C)
> - **Story ID**: `US-{persona-code}-###` where code ∈ {PO, WO, DI, DB, SD, SRE} (Q8=B)
> - **INVEST**: pragmatic; exceptions flagged inline (Q9=B)
> - **Coverage**: happy-path + operational + negative-path (Q7=A)

---

## 1. Pipeline Orchestrator System (PO)

### US-PO-001 — Submit a document for classification
**When** a new file lands in the S3 bucket and the State Machine emits a task,
**I want** to invoke the Classification Service Lambda with the task payload defined in §4.1,
**So that** I receive a structured classification result that tells me which downstream branch to take.

**Acceptance Criteria**
- **Given** an S3 object referenced by `(bucket, key)` and a valid `taskToken`,
  **When** the Classification Service is invoked with the §4.1 payload,
  **Then** it reads no more than 4,100 bytes from S3 for detection (NFR-1) and returns a `SendTaskSuccess` with the §4.2 payload.

**Traces:** FR-1, FR-9, NFR-1, §4.1, §4.2

---

### US-PO-002 — Receive a complete, contract-compliant success payload
**When** classification succeeds,
**I want** the `SendTaskSuccess` payload to include every required field (`category`, `subCategory`, `detectedFormat`, `confidenceScore`, `detectionTier`, `contentHash`, `isDuplicate`, `isForcedSlipsheet`, `slipsheetReason` when applicable, `documentId`, `workspaceId`, `policyVersion`),
**So that** my downstream branches can route on a stable schema without nullability guesswork.

**Acceptance Criteria**
- **Given** any successful classification,
  **When** `SendTaskSuccess` is called,
  **Then** the payload conforms to the JSON schema in §4.2 — `category` is one of the 6 enum values, `subCategory` is one of `office | image | tiff | html | convert-then-ocr | null`, `detectionTier` is one of the 5 enum values, and `slipsheetReason` is non-null iff `isForcedSlipsheet=true`.

**Traces:** FR-9, §4.2

---

### US-PO-003 — Receive a structured failure on unrecoverable error
**When** the Classification Service cannot recover from an error (e.g., S3 object NotFound, malformed input payload, both retry layers exhausted),
**I want** to receive a `SendTaskFailure` with a structured error code and human-readable message,
**So that** I can decide whether to escalate, alert, or drop the task without ambiguity.

**Acceptance Criteria**
- **Given** an S3 object that does not exist at `(bucket, key)`,
  **When** the service attempts the ranged GET,
  **Then** `SendTaskFailure` is called with `errorCode="S3_OBJECT_NOT_FOUND"` and a message containing the bucket and key.
- **Given** a malformed input payload missing a required field (e.g., `workspaceId`),
  **When** input validation runs,
  **Then** `SendTaskFailure` is called with `errorCode="INPUT_VALIDATION_FAILED"` and a message identifying the missing field.

**Traces:** FR-9, FR-10, SECURITY-05, SECURITY-15

---

### US-PO-004 — Bypass duplicate suppression when override flag is set
**When** my task payload sets `context.overrideDuplicateCheck=true`,
**I want** the Classification Service to continue the pipeline even on a duplicate-hash hit and leave the existing cache record fully untouched,
**So that** I can force reprocessing for diagnostic or policy-override scenarios without polluting the duplicate-tracking history.

**Acceptance Criteria**
- **Given** a document whose hash already exists in `content-hashes` and `overrideDuplicateCheck=true`,
  **When** classification runs,
  **Then** the response carries `isDuplicate=false` (or `isDuplicate=true` with override flag echoed — implementation choice documented in code-gen plan), the pipeline continues, and the existing record is not modified (no `lastSeenAt`, no `hitCount` change).

**Traces:** FR-7.2, AC-3 (override variant), edge case #8

---

## 2. Workspace Operator (WO)

### US-WO-001 — Configure the classification threshold per workspace
As a **Workspace Operator**, I want to set a per-workspace `threshold` value (default 0.5) that controls when a low-confidence result routes to slipsheet, so that I can tune classification strictness to match my tenant's accuracy expectations.

**Acceptance Criteria**
- **Given** a workspace with `threshold=0.7` in `workspace-config`,
  **When** a document classifies with a final score of 0.65,
  **Then** the document routes to `category=slipsheet`, `slipsheetReason="low-confidence"`.
- **Given** the same workspace,
  **When** a document classifies with a final score of 0.7 (equal to threshold),
  **Then** the document also routes to `category=slipsheet` (rule is `score > threshold`, not `≥`).

**Traces:** FR-5, NFR-6, AC-6, edge case #7

---

### US-WO-002 — Set `maxZipDepth` to defend against ZIP-bomb attacks
As a **Workspace Operator**, I want to set `maxZipDepth` per workspace so that documents nested too deep inside archives are diverted to slipsheet instead of being recursively expanded, so that I can protect my tenant from compression-bomb denial-of-service attempts.

**Acceptance Criteria**
- **Given** a workspace with `maxZipDepth=5`,
  **When** a document arrives with `context.parentArchiveDepth=5`,
  **Then** the service emits `category=slipsheet`, `isForcedSlipsheet=true`, `slipsheetReason="max-zip-depth"` — and does NOT emit `category=archive`.

**Traces:** FR-8, AC-5, edge case #9, SECURITY-11

---

### US-WO-003 — Enable macro quarantine for security-sensitive workspaces
As a **Workspace Operator** working with a security-sensitive tenant, I want to set `quarantineMacros=true` so that any DOCM / XLSM / PPTM document is force-diverted to slipsheet instead of being converted, so that macro-borne malware never reaches downstream processing.

**Acceptance Criteria**
- **Given** a workspace with `quarantineMacros=true`,
  **When** a `.docm` file is classified,
  **Then** the service emits `category=slipsheet`, `isForcedSlipsheet=true`, `slipsheetReason="workspace-policy"`, `detectedFormat="docm"`.
- **Given** a workspace with `quarantineMacros=false` (default),
  **When** the same `.docm` file is classified,
  **Then** the service emits `category=convert`, `subCategory=office`, `detectedFormat="docm"`.

**Traces:** FR-6.1, AC-10, edge case #13, SECURITY-11

---

### US-WO-004 — Configure per-workspace retention on `content-hashes`
As a **Workspace Operator** subject to regulatory data-retention limits, I want to set `hashTtlDays` on my workspace so that classification metadata expires automatically after the configured period, so that I stay compliant with right-to-erasure and eDiscovery hold requirements.

**Acceptance Criteria**
- **Given** a workspace with `hashTtlDays=90` in `workspace-config`,
  **When** a new `content-hashes` record is written,
  **Then** the record carries an `expiresAt` attribute set to `firstSeenAt + 90 days`, and DynamoDB TTL eventually deletes the record after that timestamp passes.
- **Given** a workspace with `hashTtlDays` unset,
  **When** a new record is written,
  **Then** no `expiresAt` attribute is set and the record persists indefinitely.

**Traces:** NFR-10, §4.3, Q14=B

---

### US-WO-005 — Trigger a policy-version bump that self-heals stale cache entries
As a **Workspace Operator**, I want any change to workspace policy to bump `policyVersion`, so that cached classifications under the old policy are re-classified on next duplicate hit instead of silently honouring stale rules.

**Acceptance Criteria**
- **Given** a `content-hashes` record with `policyVersion="v1"` and a workspace whose current `policyVersion="v2"`,
  **When** the same document is uploaded again (duplicate hash),
  **Then** the service re-classifies under `v2`, overwrites the record with `policyVersion="v2"`, and returns `isDuplicate=false`.
- **Given** the same record but with workspace `policyVersion="v1"` (unchanged),
  **When** the same document is uploaded again,
  **Then** the service short-circuits with `isDuplicate=true` and does not re-classify.

**Traces:** FR-7.1, AC-9, edge case #12

---

## 3. Document Ingestion Owner (DI)

### US-DI-001 — Correct classification regardless of file extension
As a **Document Ingestion Owner**, I want my files to be classified by their true binary format rather than by file extension, so that an accidentally or maliciously renamed file (e.g., `.docx` saved as `.pdf`) still routes to the correct branch.

**Acceptance Criteria**
- **Given** a real `.docx` file whose extension has been renamed to `.pdf`,
  **When** the file is classified,
  **Then** the service emits `detectedFormat="docx"`, `category=convert`, `subCategory=office`, `detectionTier="zip-marker"`, and applies the −0.15 extension-contradiction modifier so the final score reflects the conflict.

**Traces:** FR-1, FR-5, FR-6, AC-1, edge case #6

---

### US-DI-002 — Avoid being charged twice for the same document
As a **Document Ingestion Owner**, I want byte-identical re-uploads within my workspace to short-circuit without advancing the Step Function, so that I'm not billed for processing the same content twice.

**Acceptance Criteria**
- **Given** a file already classified in my workspace (record exists in `content-hashes`),
  **When** I upload a byte-identical copy,
  **Then** the service returns `isDuplicate=true` and the Step Function does not advance to downstream branches.
- **Given** the duplicate hit,
  **When** the response is logged,
  **Then** the cached record's `lastSeenAt` is updated to the current ISO-8601 timestamp and `hitCount` is incremented by 1 (immutable fields untouched).

**Traces:** FR-7, FR-7.2, AC-3, AC-11

---

### US-DI-003 — Workspace isolation across tenants
As a **Document Ingestion Owner**, I want my classification metadata to be invisible to other workspaces, so that two workspaces uploading the same file each proceed independently and neither sees the other's processing history.

**Acceptance Criteria**
- **Given** workspace A and workspace B each upload byte-identical files,
  **When** both classifications run,
  **Then** both workspaces receive `isDuplicate=false` on the first upload and the `content-hashes` table has two separate records partitioned by `workspaceId`.

**Traces:** NFR-4, AC-4

---

### US-DI-004 — Understand why a document was placeholdered
As a **Document Ingestion Owner**, I want any slipsheet output to carry a clear reason code, so that when a slipsheet placeholder is presented in my workflow I can tell whether it was due to workspace policy, archive depth, or low-confidence detection.

**Acceptance Criteria**
- **Given** any document routed to `category=slipsheet`,
  **When** the slipsheet branch receives the §4.2 payload,
  **Then** `slipsheetReason` is set to exactly one of `"workspace-policy" | "max-zip-depth" | "low-confidence"` and the slipsheet branch can render the corresponding user-visible explanation.

**Traces:** FR-8, FR-8.1, AC-5, AC-6, AC-10

---

## 4. Downstream Branch Maintainer (DB)

### US-DB-001 — Consume `category=convert` with reliable `subCategory`
**When** my `convert` branch receives a Step Function event,
**I want** the payload to carry a non-null `subCategory` (one of `office | image | tiff | html | convert-then-ocr`),
**So that** I can dispatch to the right conversion engine without inspecting `detectedFormat` myself.

**Acceptance Criteria**
- **Given** a `.docx`, `.pdf`-renamed-from-`.docx`, `.rtf`, `.html`, or `.tif` file,
  **When** classification completes successfully and `category=convert`,
  **Then** `subCategory` is set to the corresponding entry from the FR-6 mapping (e.g., `office` for `.docx`, `tiff` for `.tif`, `html` for `.html`).
- **Given** a `.tif` file,
  **When** classification completes,
  **Then** `subCategory=tiff` (the specific sub-category wins over `image` per AC for Q2=A).

**Traces:** FR-6, AC-1, AC-2, edge case #10

---

### US-DB-002 — Consume `category=email` for both MSG and EML
**When** my `email` branch receives a Step Function event,
**I want** to receive both Outlook `.msg` (detected via OLE2 CLSID) and plain `.eml` (detected via text heuristic) under the same `category=email`,
**So that** my branch has a single entrypoint for all email formats.

**Acceptance Criteria**
- **Given** an `.msg` file,
  **When** classified,
  **Then** the payload carries `category=email`, `detectedFormat="msg"`, `detectionTier="ole2-clsid"`.
- **Given** an `.eml` file with ≥2 RFC 5322 headers in the first 1 KB,
  **When** classified,
  **Then** the payload carries `category=email`, `detectedFormat="eml"`, `detectionTier="text-heuristic"`.

**Traces:** FR-2, FR-4, FR-6, AC-7, AC-8

---

### US-DB-003 — Consume `category=archive` only for genuine archive ZIPs
**When** my `archive` branch receives a Step Function event,
**I want** to receive only ZIP files that lack OOXML or ODF markers,
**So that** my branch never has to disambiguate ZIP-family Office documents at runtime.

**Acceptance Criteria**
- **Given** a `.zip` file with no `[Content_Types].xml` first entry and no uncompressed `mimetype` entry,
  **When** classified,
  **Then** the payload carries `category=archive`, `detectedFormat="zip"`.
- **Given** a `.docx` (ZIP with `[Content_Types].xml` first),
  **When** classified,
  **Then** the payload carries `category=convert`, `subCategory=office` — NOT `archive`.

**Traces:** FR-3, FR-6, edge case #4

---

### US-DB-004 — Consume slipsheet payloads with full reason and context
**When** my `slipsheet` branch receives a Step Function event,
**I want** the payload to include `isForcedSlipsheet=true`, `slipsheetReason`, best-effort `detectedFormat`, and `confidenceScore`,
**So that** I can render an explanatory placeholder appropriate to the cause without re-fetching anything from S3.

**Acceptance Criteria**
- **Given** a document slipsheeted due to `maxZipDepth` exceeded,
  **When** my branch receives the payload,
  **Then** `slipsheetReason="max-zip-depth"`, `category="slipsheet"`, `isForcedSlipsheet=true`, and `confidenceScore` is the best-effort score before diversion.
- **Given** a document slipsheeted due to low confidence,
  **When** my branch receives the payload,
  **Then** `slipsheetReason="low-confidence"` and `detectedFormat` is the best-effort detected format string (may be `null` if no tier produced a result).

**Traces:** FR-8, FR-8.1, AC-5, AC-6, AC-10

---

### US-DB-005 — Consume `ocr-direct` and `media` for direct-routing formats
**When** my `ocr-direct` or `media` branch receives a Step Function event,
**I want** to receive only formats detected by the Tier 1 `file-type` library mapped to my category per FR-6,
**So that** I never have to handle formats outside my contract.

**Acceptance Criteria**
- **Given** a PDF, JPEG, PNG, or BMP file,
  **When** classified,
  **Then** the payload carries `category=ocr-direct`, `detectionTier="file-type"`.
- **Given** a GIF, MP3 (with ID3), WAV, OGG, MP4, or MOV file,
  **When** classified,
  **Then** the payload carries `category=media`, `detectionTier="file-type"`.

**Traces:** FR-1, FR-6

---

## 5. Service Developer (SD)

### US-SD-001 — Run the service locally against LocalStack
As a **Service Developer**, I want to start LocalStack via `testcontainers` and invoke the handler directly with a synthetic Step Function event, so that I can iterate on classifier logic in a sub-second feedback loop without an AWS account.

**Acceptance Criteria**
- **Given** a fresh checkout with `npm install` completed,
  **When** I run `npm run dev -- ./tests/fixtures/sample.docx`,
  **Then** the handler executes against a LocalStack-emulated S3 + DynamoDB + Step Functions endpoint and prints the §4.2 payload to stdout within 5 seconds (excluding LocalStack startup).
- **Given** LocalStack is already running,
  **When** I re-run the same command,
  **Then** the round-trip completes in under 1 second.

**Traces:** §7 (Local Dev), Q19=A, Q21=D

---

### US-SD-002 — Run unit tests on pure-logic modules without LocalStack
As a **Service Developer**, I want pure-logic modules (CLSID parsing, ZIP marker scan, text heuristic, scoring math) to be unit-testable without any AWS emulation, so that my inner feedback loop stays in milliseconds.

**Acceptance Criteria**
- **Given** a TypeScript change to `src/classifier/ole2.ts`,
  **When** I run `npm run test:unit`,
  **Then** Vitest executes the unit suite without starting LocalStack and reports results in under 2 seconds for the full suite.

**Traces:** §7.1, NFR-5, Q20=A

---

### US-SD-003 — Verify all 11 acceptance criteria end-to-end against LocalStack
As a **Service Developer**, I want the AC-1…AC-11 acceptance criteria from `requirements.md` to run as integration tests against LocalStack with seeded fixtures, so that PR-gating gives confidence before deploy.

**Acceptance Criteria**
- **Given** the integration test fixture set (real binaries committed under `tests/fixtures/`),
  **When** I run `npm run test:integration`,
  **Then** LocalStack starts (once), test fixtures are uploaded to LocalStack S3, the `content-hashes` and `workspace-config` tables are created, all 11 ACs execute as Vitest test cases, and the suite passes.

**Traces:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, §7.1
**Note:** INVEST exception — this story aggregates 11 ACs. Splitting per-AC would create noise; the per-AC tests already exist as discrete test cases inside the integration suite.

---

### US-SD-004 — Run property-based tests for byte-level invariants
As a **Service Developer**, I want `fast-check` property-based tests for CLSID mixed-endian round-trip, scoring monotonicity, and dedup idempotency, so that byte-level edge cases the spec explicitly flags as bug-prone are caught by generation rather than by example.

**Acceptance Criteria**
- **Given** the PBT suite under `tests/pbt/`,
  **When** I run `npm run test:pbt`,
  **Then** `fast-check` runs at least these properties: (PBT-02) canonical CLSID hex → 16-byte on-disk → canonical hex is identity; (PBT-03) `clamp(base + ext_mod + ct_mod, 0, 1)` always returns a value in [0, 1] for any inputs in domain; (PBT-04) `dedup(dedup(record)) = dedup(record)` for any record; on failure the seed and shrunk minimal example are printed.

**Traces:** PBT-01, PBT-02, PBT-03, PBT-04, PBT-08, NFR-5

---

### US-SD-005 — Pre-PR smoke test against the Lambda runtime
As a **Service Developer**, I want to run the handler inside the actual Lambda Docker runtime (via SAM Local) against LocalStack before opening a PR, so that I catch runtime regressions (cold start, layer wiring, env vars) that direct Node invocation can't surface.

**Acceptance Criteria**
- **Given** a successful unit + integration test run,
  **When** I run `npm run test:smoke`,
  **Then** SAM Local invokes the handler inside the Lambda Docker container against the same LocalStack endpoint, the §4.2 payload is returned, and the exit code is 0.

**Traces:** Q21=D, §7.1 (smoke tier)

---

## 6. On-Call Site Reliability Engineer (SRE)

### US-SRE-001 — Investigate a `SendTaskFailure` from structured logs alone
As an **On-Call SRE**, I want every `SendTaskFailure` event to be reconstructable from CloudWatch Logs using a correlation ID (`taskToken` or `documentId`), so that I can diagnose production failures without needing additional traces or re-runs.

**Acceptance Criteria**
- **Given** a `SendTaskFailure` event in production,
  **When** I search CloudWatch Logs by `documentId`,
  **Then** I see structured JSON log entries for: input payload (with sensitive fields redacted per SECURITY-03), S3 ranged-GET attempt, each detection tier outcome, the scoring decomposition (base + modifiers), and the error code/message that triggered `SendTaskFailure`.

**Traces:** NFR-7, SECURITY-03, SECURITY-15

---

### US-SRE-002 — Replay a failed input deterministically
As an **On-Call SRE**, I want classification to be deterministic for a given `(bytes, extension, contentType, workspaceConfig, policyVersion)` tuple, so that I can replay the failing input against the same code and reach the same outcome — distinguishing input-driven failures from non-deterministic bugs.

**Acceptance Criteria**
- **Given** a previously failed classification with all five tuple values captured in logs,
  **When** I replay the input via `npm run replay -- <documentId>`,
  **Then** the local run produces a `detectedFormat`, `category`, `subCategory`, `confidenceScore`, and `detectionTier` identical to what was logged in production.

**Traces:** NFR-5

---

### US-SRE-003 — Inspect per-workspace duplicate-cache metrics
As an **On-Call SRE**, I want CloudWatch metrics broken down by category, detection tier, and workspace for cache-hit rate, classification latency, and `SendTaskFailure` count, so that I can detect anomalies (e.g., one workspace suddenly hitting 90% slipsheet) before they escalate.

**Acceptance Criteria**
- **Given** the service is running in production,
  **When** I open the CloudWatch dashboard,
  **Then** I see at minimum: a count per `category` emitted, a count per `detectionTier`, p50/p99 latency, `SendTaskFailure` rate, and a stacked breakdown of `slipsheetReason` codes — each dimensioned by `workspaceId`.

**Traces:** NFR-8, SECURITY-14

---

### US-SRE-004 — Receive alerts on security-relevant anomalies
As an **On-Call SRE**, I want CloudWatch alarms configured for authorization failures, latency p99 breaches, `SendTaskFailure` rate spikes, and unusual S3 access patterns, so that security and reliability incidents page me proactively instead of being noticed by customers.

**Acceptance Criteria**
- **Given** the CloudWatch alarms defined in infrastructure-as-code,
  **When** the `SendTaskFailure` rate exceeds 1% over a 5-minute window,
  **Then** PagerDuty (or equivalent) receives a page with the alarm name, the triggering metric, and a link to the dashboard.
- **Given** the alarms,
  **When** a request fails an IAM authorization check (unauthorized S3 object access),
  **Then** an alarm fires within 1 minute.

**Traces:** SECURITY-14, NFR-8

---

### US-SRE-005 — Reproduce a CI-discovered PBT failure from the logged seed
As an **On-Call SRE** (or developer triaging a CI failure), I want every PBT failure in CI to log the seed and shrunk minimal failing input, so that I can reproduce the exact failure locally without re-running the entire generator search.

**Acceptance Criteria**
- **Given** a PBT failure in CI,
  **When** I look at the CI logs,
  **Then** I see the failing property name, the random seed, and the shrunk minimal failing input.
- **Given** the logged seed,
  **When** I run `npm run test:pbt -- --seed=<seed>` locally,
  **Then** the same property fails with the same minimal input.

**Traces:** PBT-08

---

## Traceability Matrix

> Maps every Story ID to the Functional Requirements, Non-Functional Requirements, Acceptance Criteria, edge cases, and extension rules it covers.

### By Story
| Story | Traces |
|---|---|
| US-PO-001 | FR-1, FR-9, NFR-1, §4.1, §4.2 |
| US-PO-002 | FR-9, §4.2 |
| US-PO-003 | FR-9, FR-10, SECURITY-05, SECURITY-15 |
| US-PO-004 | FR-7.2, AC-3 (override variant), edge case #8 |
| US-WO-001 | FR-5, NFR-6, AC-6, edge case #7 |
| US-WO-002 | FR-8, AC-5, edge case #9, SECURITY-11 |
| US-WO-003 | FR-6.1, AC-10, edge case #13, SECURITY-11 |
| US-WO-004 | NFR-10, §4.3 |
| US-WO-005 | FR-7.1, AC-9, edge case #12 |
| US-DI-001 | FR-1, FR-5, FR-6, AC-1, edge case #6 |
| US-DI-002 | FR-7, FR-7.2, AC-3, AC-11 |
| US-DI-003 | NFR-4, AC-4 |
| US-DI-004 | FR-8, FR-8.1, AC-5, AC-6, AC-10 |
| US-DB-001 | FR-6, AC-1, AC-2, edge case #10 |
| US-DB-002 | FR-2, FR-4, FR-6, AC-7, AC-8 |
| US-DB-003 | FR-3, FR-6, edge case #4 |
| US-DB-004 | FR-8, FR-8.1, AC-5, AC-6, AC-10 |
| US-DB-005 | FR-1, FR-6 |
| US-SD-001 | §7, Q19, Q21 |
| US-SD-002 | §7.1, NFR-5, Q20 |
| US-SD-003 | AC-1..AC-11, §7.1 |
| US-SD-004 | PBT-01..PBT-04, PBT-08, NFR-5 |
| US-SD-005 | §7.1 (smoke), Q21 |
| US-SRE-001 | NFR-7, SECURITY-03, SECURITY-15 |
| US-SRE-002 | NFR-5 |
| US-SRE-003 | NFR-8, SECURITY-14 |
| US-SRE-004 | SECURITY-14, NFR-8 |
| US-SRE-005 | PBT-08 |

### By Requirement — Coverage Audit

**Functional Requirements:**
| FR | Covered By |
|---|---|
| FR-1   | US-PO-001, US-DI-001, US-DB-005 |
| FR-2   | US-DB-002 |
| FR-3   | US-DB-003 |
| FR-4   | US-DB-002 |
| FR-5   | US-WO-001, US-DI-001 |
| FR-6   | US-DI-001, US-DB-001, US-DB-002, US-DB-003, US-DB-005 |
| FR-6.1 | US-WO-003 |
| FR-7   | US-DI-002 |
| FR-7.1 | US-WO-005 |
| FR-7.2 | US-PO-004, US-DI-002 |
| FR-7.3 | (covered transitively by US-DI-002; no dedicated story — implementation detail) |
| FR-8   | US-WO-002, US-DI-004, US-DB-004 |
| FR-8.1 | US-DI-004, US-DB-004 |
| FR-9   | US-PO-001, US-PO-002, US-PO-003 |
| FR-10  | US-PO-003 |

**Non-Functional Requirements:**
| NFR | Covered By |
|---|---|
| NFR-1 | US-PO-001 |
| NFR-2 | (covered transitively by US-DI-002 — streaming hash; design-level concern) |
| NFR-3 | (covered transitively by US-PO-001; design-level concern) |
| NFR-4 | US-DI-003 |
| NFR-5 | US-SD-002, US-SD-004, US-SRE-002 |
| NFR-6 | US-WO-001 |
| NFR-7 | US-SRE-001 |
| NFR-8 | US-SRE-003, US-SRE-004 |
| NFR-9 | (covered transitively by US-PO-001; architectural choice) |
| NFR-10 | US-WO-004 |

**Acceptance Criteria:**
| AC | Covered By |
|---|---|
| AC-1  | US-DI-001, US-DB-001, US-SD-003 |
| AC-2  | US-DB-001, US-SD-003 |
| AC-3  | US-PO-004, US-DI-002, US-SD-003 |
| AC-4  | US-DI-003, US-SD-003 |
| AC-5  | US-WO-002, US-DI-004, US-DB-004, US-SD-003 |
| AC-6  | US-WO-001, US-DI-004, US-DB-004, US-SD-003 |
| AC-7  | US-DB-002, US-SD-003 |
| AC-8  | US-DB-002, US-SD-003 |
| AC-9  | US-WO-005, US-SD-003 |
| AC-10 | US-WO-003, US-DI-004, US-DB-004, US-SD-003 |
| AC-11 | US-DI-002, US-SD-003 |

**Extension Rules (enabled):**
| Rule | Covered By |
|---|---|
| SECURITY-03 | US-SRE-001 |
| SECURITY-05 | US-PO-003 |
| SECURITY-11 | US-WO-002, US-WO-003 |
| SECURITY-14 | US-SRE-003, US-SRE-004 |
| SECURITY-15 | US-PO-003, US-SRE-001 |
| PBT-01..PBT-04, PBT-08 | US-SD-004, US-SRE-005 |

> **Note:** SECURITY-01, SECURITY-02 (N/A), SECURITY-04 (N/A), SECURITY-06, SECURITY-07, SECURITY-08, SECURITY-09, SECURITY-10, SECURITY-12 (N/A), SECURITY-13 are infrastructure/code-level constraints rather than user-visible stories — they are enforced at Application Design / Infrastructure Design / Code Generation stages per `requirements.md` §10.1.

### Persona Coverage
| Persona | Story Count |
|---|---|
| Pipeline Orchestrator (PO) | 4 |
| Workspace Operator (WO) | 5 |
| Document Ingestion Owner (DI) | 4 |
| Downstream Branch Maintainer (DB) | 5 |
| Service Developer (SD) | 5 |
| On-Call SRE (SRE) | 5 |
| **Total** | **28** |
