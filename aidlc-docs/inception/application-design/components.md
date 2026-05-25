# Components — Classification Service

> Per `application-design-plan.md` (Q1=A Hexagonal, Q3=A factory injection, Q10=A ESLint boundary enforcement). Components are grouped by hexagonal layer; each carries its hexagonal role (`domain`, `ports`, `adapters`, `application`, `infrastructure`) and its owning **unit** from the execution plan (`classifier-core`, `persistence`, `handler`, `infrastructure`).

---

## Component Index

| ID | Component | Layer | Unit | Purpose |
|---|---|---|---|---|
| C-01 | Tier1FileTypeDetector | domain | classifier-core | Wraps the `file-type` library (Tier 1 match) |
| C-02 | OLE2Parser | domain | classifier-core | Pure mixed-endian CLSID parser (used by Tier 2 OLE2) |
| C-03 | Tier2OLE2Detector | domain | classifier-core | OLE2 CLSID disambiguation (Tier 2) |
| C-04 | ZIPMarkerParser | domain | classifier-core | Pure ZIP local file header scanner |
| C-05 | Tier2ZIPDetector | domain | classifier-core | ZIP container disambiguation — OOXML / ODF / plain (Tier 2) |
| C-06 | Tier3TextDetector | domain | classifier-core | Text heuristic — XML / HTML / EML / DXF / CSV / TXT (Tier 3) |
| C-07 | Scorer | domain | classifier-core | Confidence score: base + extension modifier + content-type modifier, clamped to [0,1] |
| C-08 | CategoryMapper | domain | classifier-core | Maps detected format → category + subCategory |
| C-09 | SlipsheetDecider | domain | classifier-core | Combines score, depth, policy, format to decide slipsheet diversion + reason |
| P-01 | S3Reader | ports | classifier-core (consumer) | Port — ranged read of S3 object bytes |
| P-02 | S3Streamer | ports | handler (consumer) | Port — streaming read of S3 object for SHA-256 |
| P-03 | Hasher | ports | handler (consumer) | Port — streaming SHA-256 |
| P-04 | ContentHashStore | ports | persistence + handler | Port — get / conditional-put / update on `content-hashes` |
| P-05 | WorkspaceConfigStore | ports | persistence + handler | Port — read workspace-config record |
| P-06 | TaskSignaler | ports | handler (consumer) | Port — `SendTaskSuccess` / `SendTaskFailure` |
| P-07 | Logger | ports | all layers (consumer) | Port — structured logging with correlation ID |
| A-01 | S3Adapter | adapters | handler | Implements `S3Reader` + `S3Streamer` against AWS S3 (SDK v3) |
| A-02 | NodeCryptoHasher | adapters | handler | Implements `Hasher` via `crypto.createHash('sha256')` streaming |
| A-03 | DDBContentHashAdapter | adapters | persistence | Implements `ContentHashStore` against DynamoDB `content-hashes` (Document Client) |
| A-04 | DDBWorkspaceConfigAdapter | adapters | persistence | Implements `WorkspaceConfigStore` against DynamoDB `workspace-config` (Document Client) |
| A-05 | StepFunctionAdapter | adapters | handler | Implements `TaskSignaler` via SFN client (SDK v3) |
| A-06 | PowertoolsLoggerAdapter | adapters | handler | Implements `Logger` via `@aws-lambda-powertools/logger` |
| S-01 | ClassificationService | application | handler | The single orchestrator — composes all domain modules via ports |
| S-02 | InputValidator | application | handler | Zod schema for §4.1; converts unknown payload → typed `TaskPayload` |
| S-03 | OutputBuilder | application | handler | Constructs the §4.2 `SendTaskSuccess` payload from classification result |
| S-04 | LambdaHandler | application | handler | Lambda entry point — bootstraps deps, wraps with Powertools (Metrics, Tracer), calls `ClassificationService.classify`, signals via `TaskSignaler` |
| I-01 | ClassificationLambdaStack | infrastructure | infrastructure | CDK stack — Lambda function, IAM role (least-privilege per SECURITY-06), VPC config (per SECURITY-07) |
| I-02 | ClassificationDataStack | infrastructure | infrastructure | CDK stack — `content-hashes` + `workspace-config` DynamoDB tables (encryption-at-rest per SECURITY-01, TTL for content-hashes) |
| I-03 | ClassificationObservabilityStack | infrastructure | infrastructure | CDK stack — CloudWatch log groups (retention ≥ 90 days per SECURITY-14), custom metric namespace, alarms (latency p99, failure rate, auth failures), X-Ray service map |

---

## Layer Boundaries (enforced via `eslint-plugin-boundaries`, Q10=A)

Allowed import directions:

```
domain      ← may import from:  shared
ports       ← may import from:  domain, shared
adapters    ← may import from:  ports, shared    (NEVER from domain, application, handler)
application ← may import from:  domain, ports, shared
handler     ← may import from:  application, ports, adapters, shared
infra       ← (separate package tree under infra/; never imported by src/)
```

Domain code stays pure: no AWS SDK imports, no I/O. Adapters know nothing about other adapters or about the application orchestrator. The orchestrator (`ClassificationService`) sees only ports. The Lambda entry point (`LambdaHandler`) is the only place where adapters are instantiated and wired into the orchestrator via the factory function.

---

## Per-Component Detail

### Domain Layer (classifier-core unit)

#### C-01 — Tier1FileTypeDetector
- **Purpose**: Run the `file-type` library against the 4,100-byte detection window.
- **Responsibilities**: Invoke `file-type.fromBuffer`; return Tier 1 result with `{ ext, mime }` or NoMatch.
- **Interfaces**: `detect(buffer: Uint8Array): Tier1Result`
- **Traces**: FR-1 (Tier 1)

#### C-02 — OLE2Parser
- **Purpose**: Pure byte-level CLSID extraction from the OLE2 directory sector.
- **Responsibilities**: Read sector size at offset 30; read directory sector ID at offset 48; compute directory byte offset; bounds-check vs 4,100-byte window; read CLSID at bytes 80–95 with mixed-endian decoding.
- **Interfaces**: `parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError>`
- **Traces**: FR-2 (CLSID parsing), edge cases #1 #2

#### C-03 — Tier2OLE2Detector
- **Purpose**: Disambiguate OLE2 family via CLSID lookup.
- **Responsibilities**: Detect OLE2 signature; invoke `OLE2Parser`; look up CLSID in the FR-2 mapping; return Tier 2 result or extension fallback.
- **Interfaces**: `detect(buffer: Uint8Array, extension: string | null): Tier2OLE2Result`
- **Traces**: FR-2, edge case #3

#### C-04 — ZIPMarkerParser
- **Purpose**: Pure ZIP local-file-header scanner — finds the first few entry filenames and the optional `mimetype` entry.
- **Interfaces**: `scanEntries(buffer: Uint8Array, maxEntries: number): ZIPEntry[]`
- **Traces**: FR-3 (ZIP entry detection)

#### C-05 — Tier2ZIPDetector
- **Purpose**: Disambiguate ZIP container family — OOXML / ODF / plain ZIP.
- **Responsibilities**: Detect ZIP signature; invoke `ZIPMarkerParser`; apply FR-3 rules (`[Content_Types].xml` first → OOXML; `mimetype` uncompressed → ODF; else plain ZIP).
- **Interfaces**: `detect(buffer: Uint8Array): Tier2ZIPResult`
- **Traces**: FR-3, edge case #4

#### C-06 — Tier3TextDetector
- **Purpose**: Text heuristic for non-binary buffers.
- **Responsibilities**: Screen for binary bytes (excluding ESC); evaluate signatures in fixed priority — XML, HTML, EML, DXF, CSV, TXT.
- **Interfaces**: `detect(buffer: Uint8Array): Tier3Result`
- **Traces**: FR-4, edge case #5

#### C-07 — Scorer
- **Purpose**: Confidence score arithmetic.
- **Responsibilities**: Apply base score per match type, then extension modifier (+0.05 / −0.15 / 0), then content-type modifier (+0.05 / −0.10 / 0); clamp to [0, 1].
- **Interfaces**: `score(input: ScoringInput): number` where `ScoringInput = { matchType, extension, detectedFormat, contentType }`
- **Traces**: FR-5

#### C-08 — CategoryMapper
- **Purpose**: Map detected format string to `category` + `subCategory`.
- **Responsibilities**: Apply FR-6 mapping table; honour Q2=A precedence (`tiff` wins over `image`); honour Q4=A `PPSX`/`PPS` in `office`; emit `convert-then-ocr` sub-category for the OLE2 Office formats per Q1=C.
- **Interfaces**: `map(detectedFormat: string, detectionTier: DetectionTier): { category, subCategory } | null`
- **Traces**: FR-6

#### C-09 — SlipsheetDecider
- **Purpose**: Decide whether to divert to slipsheet and which reason applies.
- **Responsibilities**: Apply `score > threshold` rule (FR-5); check `parentArchiveDepth ≥ maxZipDepth` (FR-8); check `quarantineMacros` + format (FR-6.1); produce `SlipsheetDecision { slipsheet, reason }`.
- **Interfaces**: `decide(input: SlipsheetInput): SlipsheetDecision`
- **Traces**: FR-5, FR-6.1, FR-8, FR-8.1, edge cases #7 #9 #13

---

### Ports Layer

#### P-01 — S3Reader
- **Purpose**: Read a byte range from an S3 object.
- **Interface**: `getRange(input: { bucket, key, start, end }): Promise<Result<Uint8Array, S3Error>>`
- **Traces**: NFR-1

#### P-02 — S3Streamer
- **Purpose**: Stream an S3 object for hashing.
- **Interface**: `stream(input: { bucket, key }): AsyncIterable<Uint8Array>`
- **Traces**: NFR-2

#### P-03 — Hasher
- **Purpose**: Compute SHA-256 over a streamed input.
- **Interface**: `sha256(stream: AsyncIterable<Uint8Array>): Promise<string>` (hex-encoded)
- **Traces**: FR-7, NFR-2

#### P-04 — ContentHashStore
- **Purpose**: Persist + read classification records.
- **Interfaces**:
  - `get(input: { workspaceId, contentHash }): Promise<Result<ContentHashRecord | null, StoreError>>`
  - `putIfAbsent(record: ContentHashRecord): Promise<Result<PutOutcome, StoreError>>` (conditional write)
  - `updateOnDuplicateHit(input: { workspaceId, contentHash, now: ISO8601 }): Promise<Result<void, StoreError>>` (increments `hitCount`, sets `lastSeenAt`)
  - `replaceOnPolicyMismatch(record: ContentHashRecord): Promise<Result<void, StoreError>>` (used in self-healing re-classification path)
- **Traces**: FR-7, FR-7.1, FR-7.2

#### P-05 — WorkspaceConfigStore
- **Purpose**: Read workspace policy for an invocation.
- **Interface**: `get(workspaceId: string): Promise<Result<WorkspaceConfig, StoreError>>`
- **Traces**: NFR-6, §4.4

#### P-06 — TaskSignaler
- **Purpose**: Complete the Step Function task.
- **Interfaces**:
  - `sendTaskSuccess(input: { taskToken, output }): Promise<Result<void, SignalError>>`
  - `sendTaskFailure(input: { taskToken, error: { code, message } }): Promise<Result<void, SignalError>>`
- **Traces**: FR-9

#### P-07 — Logger
- **Purpose**: Structured-JSON logging with correlation ID + sensitive-field redaction.
- **Interface**: `info(msg, ctx?) | warn(msg, ctx?) | error(msg, ctx?) | debug(msg, ctx?)` — context includes `documentId`, `workspaceId`, `tier`, `score`, etc.
- **Traces**: NFR-7, SECURITY-03

---

### Adapters Layer

#### A-01 — S3Adapter
- **Purpose**: AWS S3 SDK v3 implementation of `S3Reader` and `S3Streamer`.
- **Responsibilities**: Issue `GetObjectCommand` with `Range` header; convert stream errors to `Result<_, S3Error>` typed errors; instrument with X-Ray via Powertools Tracer.
- **Traces**: P-01, P-02, NFR-1, NFR-2

#### A-02 — NodeCryptoHasher
- **Purpose**: Streaming SHA-256 via Node's `crypto` module — never buffers the full file.
- **Traces**: P-03, NFR-2

#### A-03 — DDBContentHashAdapter
- **Purpose**: DynamoDB Document Client implementation of `ContentHashStore`.
- **Responsibilities**: Conditional writes (`ConditionExpression: attribute_not_exists(contentHash)`); atomic updates for `lastSeenAt`/`hitCount`; policy-version mismatch handling via `UpdateExpression`.
- **Traces**: P-04, FR-7.1, FR-7.2

#### A-04 — DDBWorkspaceConfigAdapter
- **Purpose**: DynamoDB Document Client read of workspace-config; in-memory caching for the invocation.
- **Traces**: P-05

#### A-05 — StepFunctionAdapter
- **Purpose**: AWS Step Functions SDK v3 implementation of `TaskSignaler`.
- **Traces**: P-06, FR-9

#### A-06 — PowertoolsLoggerAdapter
- **Purpose**: Wrap `@aws-lambda-powertools/logger` behind the domain-facing `Logger` port. Propagates correlation ID (`documentId`) via Powertools' context.
- **Responsibilities**: Apply redaction rules per SECURITY-03 — never log raw S3 bytes, full input payloads (only field names/sizes), or secrets.
- **Traces**: P-07, SECURITY-03

---

### Application Layer (handler unit)

#### S-01 — ClassificationService
- **Purpose**: The single orchestrator that runs the linear classification flow.
- **Responsibilities**: Composes ports (S3Reader, Hasher, ContentHashStore, WorkspaceConfigStore, TaskSignaler) with domain modules (tiers, scorer, mapper, slipsheet decider) into the §4.1 → §4.2 flow.
- **Interface**: `classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>>`
- **Traces**: FR-1..FR-10

#### S-02 — InputValidator
- **Purpose**: Validate incoming Step Function task event against the §4.1 schema.
- **Responsibilities**: Zod schema; failure → typed `InputValidationFailure` for the global handler to convert into `SendTaskFailure` with `errorCode="INPUT_VALIDATION_FAILED"`.
- **Traces**: SECURITY-05

#### S-03 — OutputBuilder
- **Purpose**: Build the §4.2 `SendTaskSuccess` payload from a `ClassificationOutput`.
- **Responsibilities**: Ensure `slipsheetReason` is non-null iff `isForcedSlipsheet=true`; ensure `subCategory` only set when `category=convert`; stamp `policyVersion`.
- **Traces**: FR-9, §4.2

#### S-04 — LambdaHandler
- **Purpose**: Lambda runtime entry point.
- **Responsibilities**: Build the dependency graph (call factory functions for ports/adapters), call `InputValidator`, call `ClassificationService.classify`, call `OutputBuilder` on success, signal via `TaskSignaler`. Global try/catch converts unhandled exceptions to `SendTaskFailure` per FR-10 (with SECURITY-15 fail-closed defaults).
- **Traces**: FR-9, FR-10, SECURITY-15

---

### Infrastructure Layer (infrastructure unit)

#### I-01 — ClassificationLambdaStack
- **Purpose**: CDK stack provisioning the Lambda function and its IAM role.
- **Responsibilities**:
  - Node.js 20.x runtime, ARM64 architecture
  - Memory + timeout tuned at NFR Requirements stage (per unit)
  - IAM role with least-privilege per SECURITY-06 — scoped to specific S3 bucket ARNs, specific DDB table ARNs, specific State Machine ARN
  - Reserved concurrency (governs Q11=A per-invocation model)
  - Optional VPC + private endpoints per SECURITY-07
  - cdk-nag rules wired

#### I-02 — ClassificationDataStack
- **Purpose**: CDK stack provisioning the two DynamoDB tables.
- **Responsibilities**:
  - `content-hashes` — PK `workspaceId` (S), SK `contentHash` (S); SSE enabled (SECURITY-01); TTL attribute `expiresAt` (NFR-10)
  - `workspace-config` — PK `workspaceId` (S); SSE enabled
  - On-demand billing mode by default
  - Point-in-time recovery enabled
  - Block public access; no resource-based policies allowing cross-account by default

#### I-03 — ClassificationObservabilityStack
- **Purpose**: CDK stack provisioning logs, metrics, alarms, X-Ray, and dashboards.
- **Responsibilities**:
  - CloudWatch log group with retention ≥ 90 days (SECURITY-14); log group locked against deletion by the Lambda role
  - Custom EMF metrics namespace
  - Alarms: `SendTaskFailure` rate > 1% over 5m; latency p99 > Xms; auth-failure rate > 0
  - X-Ray service map subscription
  - CloudWatch Dashboard with per-`workspaceId` / per-`category` / per-`detectionTier` breakdowns (per US-SRE-003)
