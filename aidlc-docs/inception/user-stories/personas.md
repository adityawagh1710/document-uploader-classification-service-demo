# Personas — Classification Service

> Six personas drive the Classification Service. Two are system personas (job-story-friendly); four are human personas (Connextra-friendly). Each persona owns at least one set of user stories in `stories.md`.

---

## Persona Index

| Code | Persona | Type | Primary FRs/NFRs |
|---|---|---|---|
| PO  | Pipeline Orchestrator System | System | FR-9, FR-10, §4.1, §4.2 |
| WO  | Workspace Operator           | Human  | FR-6.1, FR-7.1, FR-8, NFR-6, NFR-10 |
| DI  | Document Ingestion Owner     | Human  | FR-1, FR-7, NFR-4 |
| DB  | Downstream Branch Maintainer | System | FR-6, FR-8.1, §4.2 |
| SD  | Service Developer            | Human  | NFR-5, NFR-7, §7 (Local Dev), PBT-01…10 |
| SRE | On-Call Site Reliability Engineer | Human | NFR-7, NFR-8, SECURITY-03, SECURITY-14, SECURITY-15 |

---

## 1. Pipeline Orchestrator System (PO)

**Type**: System persona — AWS Step Function State Machine

**Role**: The upstream caller. Holds the task token; submits S3-resident documents for classification; routes the result downstream based on the returned `category` and `subCategory`.

**Goals**
- Get a deterministic, structured classification result for every document, regardless of file shape
- Move documents through the pipeline without manual intervention
- Recover from transient failures without losing task tokens
- Honour duplicate suppression so duplicate work isn't billed downstream

**Decision Authority**
- Decides which Step Function branch to take based on the returned `category`
- Decides whether to retry the Lambda task (uses its own retry policy in addition to SDK retries — Q9=C)
- Surfaces `SendTaskFailure` errors to upstream monitoring

**Frustrations / Failure Modes**
- A classification result missing required fields breaks downstream routing
- Non-deterministic results between retries cause split-brain pipeline state
- Slow classifications eat task-token TTL budget
- Ambiguous error codes make retry-vs-fail decisions hard

**Primary Touchpoints**
- Step Function input payload (§4.1) → Classification Service Lambda
- `SendTaskSuccess` / `SendTaskFailure` callback (FR-9)
- IAM role on the State Machine resource

---

## 2. Workspace Operator (WO)

**Type**: Human persona — platform/product administrator or customer-success engineer

**Role**: Owns workspace-level classification policy. Tunes thresholds, slipsheet rules, archive-depth limits, and macro quarantine. Triggers policy-version bumps when rules change.

**Goals**
- Match classification behaviour to a specific tenant's compliance/security/usability needs
- Roll out policy changes without invalidating duplicate-detection cache unnecessarily
- Prevent abuse vectors (ZIP bombs, macro-borne malware) per-workspace
- Set retention windows on classification metadata to match regulatory requirements

**Decision Authority**
- Sets `threshold`, `maxZipDepth`, `quarantineMacros`, `slipsheetRules`, `hashTtlDays`
- Bumps `policyVersion` when changing policy (triggers self-healing re-classification on next duplicate hit)

**Frustrations / Failure Modes**
- A policy change that silently breaks duplicate suppression for in-flight documents
- No visibility into how many documents are slipsheeting and why
- Default policy values that don't match tenant expectations

**Primary Touchpoints**
- `workspace-config` DynamoDB table (§4.4)
- Slipsheet-reason breakdown in CloudWatch metrics
- The `quarantineMacros` flag (FR-6.1)

---

## 3. Document Ingestion Owner (DI)

**Type**: Human persona — the customer / end-user whose documents flow through the pipeline

**Role**: Uploads documents (directly or indirectly) into S3. Cares about correct routing, no duplicate billing, and visibility into why a document was slipsheeted.

**Goals**
- Trust that the system identifies the right format even when extensions are wrong
- Avoid paying twice for processing the same document
- Have isolation guarantees between their workspace and any other workspace
- Understand when a document was diverted to slipsheet and why

**Decision Authority**
- Decides which workspace a document belongs to
- Decides whether to retry a failed upload

**Frustrations / Failure Modes**
- A `.docx` renamed to `.pdf` misclassified silently routes the document to the wrong branch
- Duplicate documents reprocessed and double-billed
- Cross-workspace leakage (their documents seen in another workspace's dedup cache)
- Slipsheet placeholders without explanation

**Primary Touchpoints**
- S3 bucket uploads (indirect — usually via an upload service)
- Final delivered output (whether the document was converted, extracted, or slipsheeted)

---

## 4. Downstream Branch Maintainer (DB)

**Type**: System persona — the engineer/team owning one of the downstream Step Function branches (`convert`, `ocr-direct`, `email`, `archive`, `media`, `slipsheet`)

**Role**: Consumes the Classification Service's output payload and routes it through their branch's specific processing logic. Treats the output schema as a contract.

**Goals**
- Receive a payload whose shape exactly matches §4.2 every time
- Know which `subCategory` (e.g., `office`, `tiff`, `convert-then-ocr`) to expect
- Know the `slipsheetReason` so the slipsheet branch can render an appropriate placeholder
- Be confident that documents arriving in their branch genuinely belong there (no `archive` payload for a DOCX, no `convert` payload for a true ZIP)

**Decision Authority**
- Defines branch-internal logic based on `category` + `subCategory` combinations
- Can request schema changes (e.g., new sub-categories) but cannot unilaterally change Classification Service behaviour

**Frustrations / Failure Modes**
- Output schema drift breaks branch parsers
- Misclassified documents land in their branch and cause runtime errors
- `slipsheetReason` missing — they can't tell the user why their document was placeholdered

**Primary Touchpoints**
- `SendTaskSuccess` payload (§4.2) — read-only contract

---

## 5. Service Developer (SD)

**Type**: Human persona — engineer building, testing, and maintaining the Classification Service

**Role**: Implements the TypeScript handler, writes unit + PBT + integration tests, runs the local dev loop against LocalStack, ships changes through CI/CD.

**Goals**
- Reproduce production behaviour locally without an AWS account
- Get sub-second feedback on classifier logic changes
- Have confidence that the 11 acceptance criteria pass before pushing a PR
- Use PBT to catch byte-level edge cases (mixed-endian CLSID parsing especially)

**Decision Authority**
- Code structure and module organisation within the service
- Test fixture additions
- Internal refactors

**Frustrations / Failure Modes**
- Slow inner loop (e.g., 30s LocalStack startup on every test)
- Flaky PBT tests without logged seeds (can't reproduce failures)
- Cross-tier behaviour changes that pass unit tests but fail integration tests

**Primary Touchpoints**
- `src/classifier/**` source tree (90% branch coverage gate per Q23=A)
- LocalStack via testcontainers (Q19=A)
- Vitest + `fast-check` (Q20=A, PBT-09)
- SAM Local for pre-PR smoke runs (Q21=D)

---

## 6. On-Call Site Reliability Engineer (SRE)

**Type**: Human persona — engineer responding to alerts and operational issues in production

**Role**: Diagnoses classification failures, investigates duplicate-cache anomalies, replays bad inputs, monitors latency and security events.

**Goals**
- Reconstruct any classification decision from structured logs (NFR-7)
- Replay a failed input deterministically and reach the same outcome (NFR-5)
- See per-category, per-tier, per-workspace metrics for capacity planning
- Get alerted on security-relevant anomalies (auth failures, unusual access patterns)
- Reproduce a PBT failure that surfaced in CI

**Decision Authority**
- Escalation decisions during incidents
- Runbook updates
- Cache invalidation requests (subject to WO approval for policy-version changes)

**Frustrations / Failure Modes**
- Logs that don't carry correlation IDs — can't tie a failure back to a specific document
- Non-deterministic classifications under retry — can't distinguish bug from input
- Missing seeds on PBT failures — can't reproduce the minimal failing case
- Silent errors swallowed by `SendTaskFailure` without context

**Primary Touchpoints**
- CloudWatch Logs (structured JSON, correlation ID = `taskToken` or `documentId`)
- CloudWatch Metrics dashboard (per category, per tier, latency)
- AWS X-Ray traces
- CloudWatch Alarms (latency p99, `SendTaskFailure` rate, auth-failure rate)
- The PBT test artifacts (seeds and shrunk examples per PBT-08)
