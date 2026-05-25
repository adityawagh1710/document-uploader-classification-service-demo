# Application Design — Classification Service

> **Consolidated design document.** Cross-references the four detail artifacts in this folder:
> - [`components.md`](./components.md) — component identification (28 components across 5 layers)
> - [`component-methods.md`](./component-methods.md) — method signatures + type aliases
> - [`services.md`](./services.md) — the single `ClassificationService` orchestrator + step-by-step flow
> - [`component-dependency.md`](./component-dependency.md) — dependency matrix + data flow + ESLint enforcement
>
> This file is the **navigable entry point** — read this first.

---

## 1. Design at a Glance

| Decision | Choice | Source |
|---|---|---|
| Architectural style | Hexagonal (Ports & Adapters) | Q1=A |
| Source-tree layout | `src/{domain,ports,adapters,application,handler,shared}` + `infra/` | Q1=A, Q8=A |
| Error handling | Mixed: `Result<T, E>` for expected outcomes; exceptions for unrecoverable | Q2=B |
| Dependency injection | Factory functions with explicit deps; no DI container | Q3=A |
| Schema validation | Zod (with `z.infer` for types) | Q4=A |
| DynamoDB client | AWS SDK v3 `DynamoDBDocumentClient` | Q5=A |
| Logger / Metrics / Tracer | `@aws-lambda-powertools/{logger,metrics,tracer}` | Q6=A |
| IaC | AWS CDK (TypeScript) + `cdk-nag` | Q7=A |
| Project layout | Single `package.json` | Q8=A |
| Service-layer pattern | Single `ClassificationService` orchestrator | Q9=A |
| Module-boundary enforcement | `eslint-plugin-boundaries` + CI lint gate | Q10=A |

---

## 2. Architectural Overview

The service is a single Node.js 20 / TypeScript Lambda that runs as a Step Function task. Inside the Lambda, the source tree is split into **six hexagonal layers**:

```
+---------------------------------------------------------+
|                      handler-entry                      |
|       (lambda.ts — the only wiring point for AWS)       |
+-----+-------------+-----------+---------------------+---+
      |             |           |                     |
      v             v           v                     v
+-----+------+  +---+-----+  +--+----------+  +-------+----+
|  application | adapters |  |   ports     |  |  shared    |
|  (orchestr.) |          |  | (interfaces)|  | (Result,   |
|              | (AWS SDK |  |             |  |  types)    |
|              |  S3/DDB/ |  +-------+-----+  +------------+
|              |  SFN/PT) |          ^
+-----+--------+          +------+   |
      |                          |   |
      v                          |   |
+-----+---------+                |   |
|    domain     |<---------------+   |
| (pure logic)  +--------------------+
+---------------+
```

The structural promise:
- **`domain`** never touches AWS — it's pure logic, unit-testable in milliseconds.
- **`adapters`** never know about `domain` or `application` — they only implement `ports`.
- **`application`** (the orchestrator) composes `domain` + `ports` through factory injection — it never knows which adapter is wired in.
- **`handler-entry`** is the *only* place that knows about both `adapters` and `application` — it builds the dependency graph.
- **`infra`** (CDK) is a separate package tree, never in the runtime import graph.

The boundaries are enforced by `eslint-plugin-boundaries` in CI (see `component-dependency.md` §6 for the rule set).

---

## 3. Unit Mapping

The four units from `execution-plan.md` map to layers as follows:

| Unit | Owns | Tested at |
|---|---|---|
| **classifier-core** | `src/domain/*` (Tier 1/2/3 detectors, OLE2/ZIP parsers, scorer, category mapper, slipsheet decider) + the port *interfaces* that domain depends on (in practice, none — domain is leaf) | unit + PBT |
| **persistence** | `src/adapters/dynamo-content-hashes/`, `src/adapters/dynamo-workspace-config/` + the `ContentHashStore` and `WorkspaceConfigStore` ports | integration (LocalStack) |
| **handler** | `src/application/*` (`ClassificationService`, `InputValidator`, `OutputBuilder`), `src/adapters/s3/`, `src/adapters/step-functions/`, `src/adapters/crypto/`, `src/adapters/powertools/`, `src/handler/lambda.ts` + the `S3Reader`, `S3Streamer`, `Hasher`, `TaskSignaler`, `Logger` ports | unit + integration + smoke |
| **infrastructure** | `infra/*` — `ClassificationLambdaStack`, `ClassificationDataStack`, `ClassificationObservabilityStack` | CDK snapshot tests + integration |

Sequencing for the Construction-phase per-unit loops:

1. **classifier-core** (no deps; lifts whole-test-suite confidence)
2. **persistence** (depends only on table schemas; can develop in parallel with classifier-core)
3. **handler** (composes (1) and (2); contains the orchestrator and the Lambda entry)
4. **infrastructure** (deploys (3); can begin in parallel with handler once IAM scope is known)

---

## 4. Quick "Component → Unit → Requirement" Index

| Component | Layer | Unit | Primary Traces |
|---|---|---|---|
| Tier1FileTypeDetector | domain | classifier-core | FR-1 |
| OLE2Parser | domain | classifier-core | FR-2 |
| Tier2OLE2Detector | domain | classifier-core | FR-2, AC-7 |
| ZIPMarkerParser | domain | classifier-core | FR-3 |
| Tier2ZIPDetector | domain | classifier-core | FR-3, AC-1 |
| Tier3TextDetector | domain | classifier-core | FR-4, AC-8 |
| Scorer | domain | classifier-core | FR-5 |
| CategoryMapper | domain | classifier-core | FR-6 |
| SlipsheetDecider | domain | classifier-core | FR-8, FR-6.1, AC-5, AC-6, AC-10 |
| S3Reader / S3Streamer (P) | ports | (consumed by handler) | NFR-1, NFR-2 |
| Hasher (P) | ports | (consumed by handler) | FR-7, NFR-2 |
| ContentHashStore (P) | ports | (impl. in persistence) | FR-7, FR-7.1, FR-7.2 |
| WorkspaceConfigStore (P) | ports | (impl. in persistence) | NFR-6, §4.4 |
| TaskSignaler (P) | ports | (consumed by handler) | FR-9 |
| Logger (P) | ports | all layers | NFR-7, SECURITY-03 |
| S3Adapter (A) | adapters | handler | NFR-1, NFR-2 |
| NodeCryptoHasher (A) | adapters | handler | NFR-2 |
| DDBContentHashAdapter (A) | adapters | persistence | FR-7, FR-7.1, FR-7.2, AC-3, AC-9, AC-11 |
| DDBWorkspaceConfigAdapter (A) | adapters | persistence | §4.4 |
| StepFunctionAdapter (A) | adapters | handler | FR-9 |
| PowertoolsLoggerAdapter (A) | adapters | handler | NFR-7, SECURITY-03 |
| ClassificationService (S) | application | handler | FR-1..FR-10 (all) |
| InputValidator (S) | application | handler | SECURITY-05 |
| OutputBuilder (S) | application | handler | FR-9, §4.2 |
| LambdaHandler (S) | application | handler | FR-9, FR-10, SECURITY-15 |
| ClassificationLambdaStack (I) | infrastructure | infrastructure | SECURITY-06, SECURITY-07 |
| ClassificationDataStack (I) | infrastructure | infrastructure | SECURITY-01, NFR-10 |
| ClassificationObservabilityStack (I) | infrastructure | infrastructure | SECURITY-14, NFR-7, NFR-8 |

---

## 5. The Single Orchestrator (Key Read)

`ClassificationService.classify(payload)` runs a **13-step linear flow** (`services.md` §1). Each step is named for log/metric/trace correlation. The flow is:

```
(1) validate-input          (Zod against §4.1)
(2) load-workspace-config   (DDB get)
(3) read-detection-window   (S3 ranged GET, 0..4099)
(4) detect-tier1            (file-type)
(5) detect-tier2-ole2       (CLSID; conditional on signature + tier-1 miss)
(6) detect-tier2-zip        (OOXML/ODF/plain; conditional on signature + miss)
(7) detect-tier3-text       (text heuristic; on miss)
(8) score                   (base + ext modifier + content-type modifier, clamped)
(9) map-category            (format → category + subCategory)
(10) decide-slipsheet       (score vs threshold, depth vs maxZipDepth, macro policy)
(11) stream-hash            (SHA-256 over streamed S3 object)
(12) dedup-decision         (4-case logic: new / override / policy-mismatch / clean dup)
(13) build-output           (§4.2 payload)
```

Failure handling is **mixed** (Q2=B): `Result<T, E>` for expected branches (NoMatch, conditional-write-failed, ext-fallback) and exceptions for genuinely unrecoverable conditions, caught at the global handler and converted into `SendTaskFailure` payloads.

Retries are **two-layer** (Q9=C): SDK retries for transient AWS errors, Step Function task retry for true Lambda failures. The orchestrator is idempotent by construction (read-only S3, pure hash, conditional DDB writes).

See `services.md` for the full flow, including each step's port calls, observability hooks, and AC mapping.

---

## 6. Extension Compliance at this Stage

### SECURITY (opted IN)
The following SECURITY rules are *structurally* addressed by Application Design (the rest fire at NFR Design / Infrastructure Design / Code Generation):

| Rule | How Application Design satisfies it |
|---|---|
| SECURITY-03 (App-level logging) | `Logger` port (P-07) + `PowertoolsLoggerAdapter` (A-06) — structured JSON, correlation ID, redaction policy |
| SECURITY-05 (Input validation) | `InputValidator` (S-02) + Zod schema for §4.1 payload |
| SECURITY-06 (Least-privilege IAM) | `ClassificationLambdaStack` (I-01) scopes IAM to specific S3 bucket / DDB tables / State Machine ARNs |
| SECURITY-11 (Secure design) | Security-critical logic (`SlipsheetDecider`, `Tier2OLE2Detector`) isolated as dedicated domain components; defense-in-depth via `quarantineMacros` + `maxZipDepth` + `slipsheetRules` |
| SECURITY-15 (Exception handling) | Global try/catch at `LambdaHandler` (S-04); fail-closed; Result type for expected errors |

Remaining SECURITY rules (01, 02 N/A, 04 N/A, 07, 08, 09, 10, 12 N/A, 13, 14) are addressed in NFR Design + Infrastructure Design + Code Generation per `requirements.md` §10.1.

### PBT (opted IN)
- PBT-01 (Property identification during design): **deferred to Functional Design (per unit)** — pre-identified candidates listed in `requirements.md` §10.2 (round-trip CLSID encoding, scoring monotonicity, dedup idempotency, tier-fallback oracle).
- PBT-09 (Framework selection): **fast-check** — confirmed at NFR Requirements per unit.
- All other PBT rules: deferred to Code Generation per unit.

---

## 7. Open Items Deferred to Construction Phase

| Item | Stage |
|---|---|
| Mixed-endian CLSID byte algorithm details | Functional Design (classifier-core) |
| Conditional-write `UpdateExpression` strings for `content-hashes` | Functional Design (persistence) |
| Tier-specific test fixtures (real `.docx`/`.msg`/`.eml` + synthetic OLE2 + synthetic ZIP) | Code Generation (per unit) |
| Lambda memory / timeout / reserved concurrency values | NFR Requirements (handler unit) |
| CloudWatch alarm thresholds (latency p99, failure rate) | NFR Requirements (handler / infrastructure units) |
| DynamoDB capacity mode (on-demand vs provisioned) | NFR Requirements (persistence) |
| VPC + private endpoint topology | Infrastructure Design (infrastructure) |
| `cdk-nag` rule set + exemptions | Infrastructure Design (infrastructure) |
| PBT property catalogue per domain module | Functional Design (classifier-core), then Code Generation |
| Logging redaction rules (which payload fields are sensitive) | NFR Design (handler unit) |

These are *intentionally* left open here — Application Design fixes the shape of the system; the per-unit Construction loops fill in the parameters.
