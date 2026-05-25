# Requirements Verification Questions — Classification Service

Please answer each question by filling in the letter choice after the `[Answer]:` tag. If none of the options match your needs, choose the **Other** option and describe your preference after the `[Answer]:` tag.

The questions are grouped:

- **A. Category & Format Ambiguities** — resolves open questions in `technical_input.md` §7 and internal inconsistencies in §2.6.
- **B. Operational & Integration Clarifications** — confirms assumptions in §8 and fills NFR gaps.
- **C. Persistence & Lifecycle**
- **D. Extension Opt-Ins** — enable/disable security and property-based-testing extensions.
- **E. Local Development & Testing** — language, local AWS emulation (LocalStack), test framework, dev runner, fixtures, coverage target.

---

## A. Category & Format Ambiguities

## Question 1
**Internal inconsistency: `convert-then-ocr` vs `convert`.** The OLE2 CLSID table in §2.2 maps Word/Excel/PPT/Visio to the category **`convert-then-ocr`**, but §2.6 lists those same formats under category **`convert`**, and the output enum in §4.2 only allows `ocr-direct | media | convert | email | archive | slipsheet` (no `convert-then-ocr`). How should this be resolved?

A) `convert-then-ocr` is a typo in §2.2; the correct category is `convert`. Drop the term entirely.

B) `convert-then-ocr` is a real distinct category and must be added to the output enum. Update §4.2 accordingly.

C) `convert-then-ocr` is a *sub-category* under `convert` (i.e., `category=convert`, `subCategory=convert-then-ocr`). Update the sub-category list.

D) Other (please describe after [Answer]: tag below)

[Answer]:C

## Question 2
**TIFF sub-category precedence.** TIFF appears in both the `image` and `tiff` sub-category lists in §2.6. The working assumption is that `tiff` (the more specific sub-category) wins for `.tif`/`.tiff` files. Confirm or override?

A) Confirm: `tiff` sub-category wins over `image` for `.tif`/`.tiff` files.

B) Override: `.tif`/`.tiff` should always map to sub-category `image`; remove `tiff` from the sub-category list.

C) Override: keep both — `tiff` for `.tif`/`.tiff` files detected by magic-bytes; `image` only when detected by extension fallback.

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 3
**MPP (Microsoft Project) handling.** MPP is listed in §2.2 as a member of the OLE2 family but has no entry in the CLSID lookup table. What is the intended behavior when an OLE2 MPP file is detected?

A) Treat as unknown OLE2 → extension fallback (score 0.70) → `category=convert`, `subCategory=office`.

B) Add an explicit MPP CLSID mapping (please provide CLSID after `[Answer]:`) → `category=convert`, `subCategory=office`.

C) Route MPP to `slipsheet` (not supported downstream).

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: MPP files are rare in document-ingestion pipelines. The OLE2 generic fallback already gives a deterministic 0.70 score, which behaves correctly with the rest of the scoring/threshold logic. Adding a CLSID without a confirmed authoritative value risks miscategorising future MPP variants. Cleanest baseline; can be promoted to (B) later when a vetted CLSID is available.

## Question 4
**`.PPSX` extension in the `office` sub-category.** The `office` sub-category extension list in §2.6 includes `PPT, PPTX, PPTM` but omits `PPSX` (PowerPoint Slideshow), even though PPSX is detected via the ZIP/OOXML tier. Add `PPSX` to the `office` sub-category?

A) Yes — add `PPSX` (and `PPS` for the OLE2 variant) to the `office` sub-category extension list.

B) No — PPSX should map to a different sub-category. (Please specify after `[Answer]:`.)

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `PPSX` (and the OLE2 `PPS`) are functionally PowerPoint presentations; the sub-category list is clearly an omission. Adding them to `office` keeps the downstream `convert` pipeline consistent for all PowerPoint variants (PPT/PPTX/PPSX/PPS/PPTM).

## Question 5
**DOCM / XLSM / PPTM (macro-enabled Office formats).** These are listed in the ZIP/OOXML family under `category=convert`. Should macro-enabled formats follow the same `convert` path as their non-macro counterparts, or be quarantined to `slipsheet` for security?

A) Same `convert` path — treat macro-enabled formats identically to their non-macro siblings.

B) Quarantine — route DOCM/XLSM/PPTM to `slipsheet` with `isForcedSlipsheet=true`.

C) Workspace-policy driven — add a workspace config flag (e.g., `quarantineMacros: bool`) that defaults to false but lets a workspace opt into quarantining.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: Macro-enabled formats have legitimate uses but are a known phishing/malware vector. A workspace-scoped flag (`quarantineMacros`, default `false`) keeps backwards compatibility while letting security-conscious workspaces opt in. This is consistent with the existing pattern of workspace-configurable `threshold`, slipsheet rules, and `maxZipDepth` in NFR-6.

## Question 6
**Slipsheet output schema.** §7 Q6 asks what the slipsheet downstream branch needs from this service beyond `isForcedSlipsheet`. What should the slipsheet payload include?

A) Minimum — only `isForcedSlipsheet=true`, `category=slipsheet`, `documentId`, `workspaceId`. The slipsheet branch handles the rest from raw S3 metadata.

B) Standard — the above plus `detectedFormat` (best-effort), `confidenceScore`, `slipsheetReason` enum (`workspace-policy | max-zip-depth | low-confidence`).

C) Rich — the above plus the file extension, `Content-Type`, original size in bytes, and `parentArchiveDepth`.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Standard payload gives the slipsheet branch enough to render a meaningful placeholder (knows the *reason* for slipsheeting, the *best-effort detected format*, and the *confidence*). Minimum (A) forces the slipsheet branch to re-derive context; Rich (C) bloats the payload with data the slipsheet branch can fetch from S3 metadata on demand.

---

## B. Operational & Integration Clarifications

## Question 7
**Runtime / deployment target.** §6 specifies Node.js. The Step Function task-token callback pattern strongly suggests AWS Lambda. Confirm the deployment target.

A) AWS Lambda (Node.js 20.x or later), one invocation per Step Function task.

B) AWS Lambda but using a containerized image (Lambda container runtime).

C) AWS ECS / Fargate long-running task with a queue listener.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS Lambda (Node.js 20.x+) is the canonical runtime for Step Function task-token callback patterns. Per-document classification is short-lived (sub-second after the 4,100-byte ranged GET), bursty, and benefits from Lambda's auto-scaling. The `file-type` library and small dependency tree fit easily under Lambda's 250 MB layer limit, so containerised Lambda (B) is unnecessary overhead.

## Question 8
**Workspace configuration store.** §6 leaves the workspace config source open (DynamoDB or Parameter Store). Which is authoritative for `threshold`, slipsheet rules, `maxZipDepth`, etc.?

A) AWS Systems Manager **Parameter Store** (one parameter path per workspace, hierarchical keys).

B) AWS **AppConfig** (workspace-scoped configuration profiles).

C) **DynamoDB** — a dedicated `workspace-config` table keyed by `workspaceId`.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: DynamoDB is already in the stack (for `content-hashes`), so reusing it for `workspace-config` keeps IAM, observability, and operational tooling consistent. Workspace config grows with arbitrary slipsheet rules and threshold maps — Parameter Store's 4 KB (standard) / 8 KB (advanced) limit and rate ceiling become a constraint at scale. AppConfig is excellent for application-level config but treats per-workspace records awkwardly. DynamoDB single-table read per cold invocation matches the "read once per invocation" pattern in §8 Assumptions.

## Question 9
**Failure retry policy for transient errors.** §2.9 specifies `SendTaskFailure` on unrecoverable failure, but transient errors (S3 5xx, DynamoDB throttling, network) need a retry strategy. What is the policy?

A) Built-in AWS SDK retries (standard mode, max 3 retries with exponential backoff). On final failure → `SendTaskFailure`.

B) Built-in SDK retries (adaptive mode, max 5 retries). On final failure → `SendTaskFailure`.

C) Built-in SDK retries + Step Function task retry policy (Step Function re-invokes the Lambda). The classification handler is idempotent and safe to re-invoke.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: Two-layer defence. NFR-5 already guarantees classification determinism per `(bytes, extension, contentType, workspaceConfig)`, so re-invocation is naturally idempotent (the `content-hashes` write is a conditional put — second invocation re-derives the same row). SDK retries absorb fast transient failures (S3 5xx, DDB throttling); Step Function retry rescues from true Lambda failures (timeout, OOM, init failure) that the SDK can't see. `SendTaskFailure` is reserved for genuinely unrecoverable cases (e.g., S3 object NotFound).

## Question 10
**Observability — logs, metrics, traces.** NFR-7 requires structured logs sufficient to reconstruct the tier-by-tier decision. What is the broader observability stack?

A) Structured JSON logs to CloudWatch Logs; custom CloudWatch metrics (one per category emitted, plus latency); AWS X-Ray tracing.

B) Structured JSON logs to CloudWatch Logs; **OpenTelemetry** metrics and traces exported via OTLP to a collector (vendor-neutral).

C) Logs only (no custom metrics or traces beyond what AWS provides by default).

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS-native stack matches the rest of the architecture (S3, DynamoDB, Step Functions, Lambda) and gives one-click visibility from the Step Function console down to per-tier classification logs. Custom CloudWatch metrics per category emitted (and per detection tier) make capacity planning and anomaly detection trivial; X-Ray traces pinpoint where the tier-by-tier decision path went. OpenTelemetry (B) is portable but adds a collector dependency that isn't justified for an AWS-only deployment.

## Question 11
**Concurrency model.** Is each S3 object classified by exactly one Lambda invocation, or do you want batching?

A) One invocation per Step Function task — no batching. Concurrency is governed by Lambda reserved concurrency / Step Function map state.

B) Batched — the Lambda accepts an array of task payloads (up to N) and processes them sequentially within one invocation.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The Step Function task-token callback pattern is fundamentally one-token-per-task; batching would force the Lambda to manage multiple task tokens and partial-failure semantics, which complicates the `SendTaskSuccess`/`SendTaskFailure` model. Per-invocation concurrency is cleanly governed by Lambda reserved concurrency and Step Function Map state — both well-understood AWS primitives.

---

## C. Persistence & Lifecycle

## Question 12
**Hash collision policy (§7 Q7).** SHA-256 collisions are cryptographically infeasible, but is byte-length comparison required as a secondary check on duplicate hits?

A) No secondary check — trust SHA-256 uniquely identifies content.

B) Add file-size as a sort-key tiebreaker stored on the `content-hashes` record; on hit, require both hash *and* size match to count as duplicate.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: SHA-256 collisions require ~2^128 work; no real-world adversary or accident reaches them. Adding a byte-length tiebreaker forces a full-stream read (or a HEAD call) every time, which contradicts the streaming-hash design of NFR-2 and adds zero practical safety. If a collision ever did occur, the operational impact (one false short-circuit) is trivial compared to the per-document cost of the extra check.

## Question 13
**Re-classification on workspace policy change (§7 Q8).** If the workspace's slipsheet rules change after some documents are already cached in `content-hashes`, what happens on a future duplicate hit?

A) Cache is authoritative — short-circuit always wins regardless of policy changes (cheapest, most predictable).

B) Cache stores a `policyVersion`; on hit, if `policyVersion` mismatches current workspace policy version, re-run classification and overwrite the record.

C) Cache invalidates automatically when policy changes (workspace owner triggers an invalidation event).

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Stamping each `content-hashes` record with the `policyVersion` it was classified under is cheap (one extra attribute) and self-healing: a hit with a stale `policyVersion` triggers a re-classification, the record is overwritten with the new version, and subsequent identical uploads short-circuit correctly. Option A silently strands documents in stale state; Option C requires an extra invalidation pipeline (and someone reliable enough to fire it).

## Question 14
**`content-hashes` table retention.** Is there a TTL on classification records, or do they live forever?

A) No TTL — records live indefinitely; deletion is manual / out-of-band.

B) TTL configurable per workspace (default: no TTL); record carries an `expiresAt` attribute when set.

C) Fixed TTL — all records expire 365 days after `firstSeenAt`.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Default "no TTL" preserves duplicate-detection value forever; per-workspace override (`expiresAt` attribute, DynamoDB TTL feature) supports workspaces with regulatory retention limits (e.g., GDPR right-to-erasure, eDiscovery hold windows). A single fixed TTL (C) is too rigid for a multi-tenant service that must serve both forever-retain and short-retain customers.

## Question 15
**Override flag semantics on duplicate-hit.** §5 edge case #8 says when `overrideDuplicateCheck=true` and a duplicate is hit, the pipeline continues *and* the existing hash record is **not** rewritten. Confirm — and what about non-override duplicate hits: should anything (e.g., `lastSeenAt`, hit count) be updated on the existing record?

A) Confirm — existing record is fully immutable after first write. Hits do not update anything.

B) Existing record is mostly immutable, but a `lastSeenAt` ISO timestamp and `hitCount` integer are incremented on every duplicate hit (whether override or not).

C) Override hits update nothing; non-override hits update `lastSeenAt` and `hitCount`.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: Override hits should leave the record genuinely untouched (the override caller is asking for a one-off bypass and shouldn't pollute duplicate-tracking semantics). Non-override hits — the normal duplicate path — benefit from `lastSeenAt` (latest sighting timestamp) and `hitCount` (how many duplicates this hash has produced) for operational insight without violating the spec's "do not rewrite" rule on the immutable identity fields (`format`, `firstSeenAt`, `firstDocumentId`).

---

## D. Extension Opt-Ins

## Question 16: Security Extensions
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)

B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: This service is a production-grade ingestion entry point that touches arbitrary user content in S3, persists per-workspace identity data in DynamoDB, signals a privileged Step Function, and processes untrusted binary input (a known attack surface — malformed OLE2, ZIP bombs, malicious macros). Enforcing the security baseline as blocking constraints is the correct posture from day one.

## Question 17: Property-Based Testing Extension
Should property-based testing (PBT) rules be enforced for this project?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)

B) Partial — enforce PBT rules only for pure functions and serialization round-trips (suitable for projects with limited algorithmic complexity)

C) No — skip all PBT rules (suitable for simple CRUD applications, UI-only projects, or thin integration layers with no significant business logic)

X) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: This service is *exactly* the workload PBT was designed for: mixed-endian CLSID parsing (the spec itself calls this out as a known bug source), tier-by-tier scoring with modifiers, deterministic classification across `(bytes, extension, contentType, workspaceConfig)` tuples (NFR-5), and SHA-256 streaming round-trips. Example-based unit tests will miss the bytewise edge cases that property-based generators catch by construction.

---

## E. Local Development & Testing

## Question 18
**Language.** §6 fixes the runtime as Node.js. Should the source be authored in TypeScript or plain JavaScript?

A) TypeScript (strict mode) — compiled to JS for Lambda deploy; type-safety for the data contracts in §4 and the tier/category enums.

B) JavaScript (ES2022+) with JSDoc type annotations — no build step.

C) Plain JavaScript — no type annotations.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The data contracts in §4 (Step Function payloads, category/sub-category enums, the CLSID lookup table, the OLE2 byte-layout constants) are heavily typed by nature. TypeScript catches whole classes of bugs at compile time — wrong category strings, mis-shaped Step Function payloads, missing fields in the `content-hashes` row. Strict-mode TS pairs naturally with PBT (Q17) because property generators get type-checked too. Build overhead is a single `tsc` step that fits cleanly into the Lambda bundling flow.

## Question 19
**Local AWS emulation.** How do integration tests run against S3, DynamoDB, and Step Functions on a developer's laptop?

A) **LocalStack (community edition)** orchestrated via `testcontainers` — starts once per test run, seeded with fixtures, accessed by pointing AWS SDK clients at `http://localhost:4566`. Covers S3 ranged GET, DynamoDB conditional writes, and Step Functions `SendTaskSuccess`/`SendTaskFailure` callback pattern.

B) Service-specific mocks — `aws-sdk-client-mock` for the SDK calls; no real AWS surface. Faster but lower fidelity (no real ranged-GET behaviour, no real conditional-write semantics).

C) Real AWS sandbox account — every developer has personal AWS creds and a dedicated test account. Highest fidelity, slowest dev loop, costs money.

D) Hybrid — `aws-sdk-client-mock` for unit/component tests, LocalStack for the integration tests that exercise the 8 acceptance criteria in §9.

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: LocalStack community edition covers every AWS dependency this service uses (S3 ranged GET, DynamoDB, Step Functions task tokens, Lambda) and runs end-to-end on a laptop with no AWS account required. `testcontainers` keeps the container lifecycle hands-off — one container per test run, shared across the suite. Higher fidelity than SDK mocks (real conditional-write contention, real `SendTaskSuccess` round-trip) at the cost of ~10–30s startup, which is amortised over the run. Pure-logic unit tests (CLSID parsing, scoring math, text heuristic) skip LocalStack entirely and run in milliseconds.

## Question 20
**Test framework.** Which framework runs the unit, property-based, and integration tests?

A) **Vitest** — fast, ESM-native, first-class TypeScript, built-in coverage. Excellent integration with `fast-check` for PBT.

B) **Jest** — most mature Node.js ecosystem, ts-jest for TypeScript. Slower startup but very wide tooling support.

C) **Node.js built-in test runner** (`node --test`) — zero dependencies, lightweight, but thinner ecosystem for snapshots/coverage.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Vitest's ESM-native execution and Vite-powered transforms make TypeScript tests near-instant (no `ts-jest` compile penalty). It pairs cleanly with `fast-check` for the PBT extension (Q17), has first-class concurrent test execution (useful when LocalStack-backed integration tests run alongside fast unit tests), and ships with `c8` coverage out of the box. Jest is the safer-feeling fallback but materially slower for a TypeScript codebase.

## Question 21
**Local dev runner — how does a developer invoke the handler against LocalStack from their machine?**

A) **Direct Node invocation** — a `npm run dev` script that imports the Lambda handler and calls it with a synthetic Step Function task event (JSON file). Fastest inner loop; bypasses Lambda runtime entirely.

B) **AWS SAM Local** (`sam local invoke`) — runs the handler inside the real Lambda Docker runtime, against LocalStack-emulated AWS services. Highest fidelity but slower per-invocation.

C) **serverless-offline** — emulates API Gateway + Lambda. Overkill for a Step-Function-only service.

D) Combined — direct Node invocation for routine dev, SAM Local for pre-PR smoke runs.

E) Other (please describe after [Answer]: tag below)

[Answer]: D — Rationale: 90% of the dev loop is iterating on classification logic, where direct Node invocation gives sub-second feedback (handler in, classification out, no container overhead). SAM Local matters only when you need to validate Lambda-specific behaviour (cold-start init, memory limits, layer resolution, environment-variable wiring). Combining both keeps the day-to-day loop fast while still catching Lambda-runtime regressions before a PR lands.

## Question 22
**Binary fixtures source.** The 8 acceptance criteria in §9 reference real binary samples (`.docx` renamed to `.pdf`, malformed OLE2, etc.). Where do these live?

A) **Committed under `tests/fixtures/`** — small (<100 KB each) real binaries checked into the repo. Reproducible, no network dependency, easy to inspect.

B) **Generated programmatically at test setup** — `officegen`/`docx`/`adm-zip` libraries construct the binaries in `beforeAll`. No binaries in git history.

C) **Fetched from a fixtures S3 bucket** at test setup. Centralised, but adds a network dependency to every test run.

D) Hybrid — synthetic OLE2/ZIP byte sequences generated programmatically (precise byte-level control for PBT shrinks); a small set of real `.docx`/`.pdf`/`.msg` files committed for the AC-1…AC-8 cases.

E) Other (please describe after [Answer]: tag below)

[Answer]: D — Rationale: Property-based generators need precise byte-level control over OLE2 sector sizes, CLSID layouts, and ZIP local file headers — that's only practical with programmatic synthesis. But the acceptance criteria (AC-1: a real `.docx` renamed to `.pdf`; AC-7: a real `.msg`; AC-8: a real `.eml`) need bytes that match what tools like Word and Outlook actually produce — those are committed real files. This hybrid gets the best of both: PBT shrinks find edge cases, real files prove production fidelity.

## Question 23
**Coverage target.** What is the minimum coverage gate for PRs?

A) **90% branch coverage** on classification logic (`src/classifier/**`); 70% on integration glue. Strict, but achievable given the deterministic spec.

B) 80% branch coverage overall, no per-directory split. Standard industry default.

C) 100% branch coverage on pure functions (CLSID parsing, text heuristic, scoring); no gate on integration layer.

D) No coverage gate — rely on PBT and the 8 acceptance criteria alone.

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The classification logic is the high-risk core (a wrong category routes a document down the wrong pipeline branch) and is mostly pure functions where 90% branch coverage is achievable without test-busywork. Integration glue (S3 reads, DynamoDB writes, Step Function callbacks) gets a lower 70% bar because LocalStack-backed integration tests already exercise the happy path and the meaningful failure modes; chasing 90% there typically just tests error-handler shapes. PBT (Q17) covers the bytewise edge cases that line coverage misses by construction.
