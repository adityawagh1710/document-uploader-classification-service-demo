# Component Dependencies — Classification Service

> Allowed import directions, data-flow diagrams, and the ESLint rule set that enforces the boundaries.

---

## 1. Layer Dependency Matrix

A `✓` means the row may import from the column; a `✗` means the import would fail ESLint and CI.

| ⬇ from / from ➡ | domain | ports | adapters | application | handler-entry | shared |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **domain** | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **ports** | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **adapters** | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| **application** | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| **handler-entry** | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **infra (separate root)** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Key observations:
- **`domain` is the most restricted layer** — it only sees itself + `shared`. This is what makes unit tests on the classifier modules run in milliseconds with no AWS SDK in the import graph.
- **`ports` may import `domain` types** (e.g., `ContentHashRecord`, `WorkspaceConfig`) but never adapters. Ports are interfaces, not implementations.
- **`adapters` may import `ports` only** — adapters provide port implementations. They must never reach into `domain`, `application`, or `handler-entry`.
- **`application` may import `domain` + `ports`** — it composes them through factory injection. It must never import `adapters` directly; the wiring lives in `handler-entry`.
- **`handler-entry` is the only place that imports `adapters`** — this is the Lambda runtime entry, where dependency factories are called and the dependency graph is built.
- **`infra/` is a completely separate package tree** — it never appears in the runtime import graph; CDK code is build-only.

---

## 2. ASCII Dependency Diagram

```
+---------------------------------------------------------------+
|                  handler-entry (lambda.ts)                    |
|             (the ONLY place that wires adapters)              |
+-----+--------------------+--------------------+---------------+
      |                    |                    |
      v                    v                    v
+-----+--------+   +-------+--------+   +-------+--------+
|  application |   |    adapters    |   |     ports      |<--+
| Classification|  |  S3Adapter     |   |  S3Reader      |   |
|  Service      |  |  DDB Content   |   |  ContentHash   |   |
|  Input/Output |  |  DDB WSConfig  |   |  Workspace     |   |
|  Builder      |  |  StepFunctions |   |  TaskSignaler  |   |
|               |  |  Crypto Hasher |   |  Hasher        |   |
|               |  |  Powertools Lg |   |  Logger        |   |
+-----+---------+  +-------+--------+   +-------+--------+
      |                    |                    ^
      |                    +--implements------->+
      v
+-----+--------+
|    domain    |
|  Tier1 .. 3  |
|  OLE2 parser |
|  ZIP marker  |
|  Scorer      |
|  Category    |
|  Slipsheet   |
+-----+--------+
      |
      v
+-----+-----+
|  shared   |  (Result<T, E>, type aliases, constants)
+-----------+

+---------------------------------------------------------------+
|             infra/  (CDK — separate package tree)             |
|  ClassificationLambdaStack / DataStack / ObservabilityStack   |
+---------------------------------------------------------------+
            (never imported by anything in src/)
```

---

## 3. Communication Patterns

Communication is **always synchronous in-process function calls**. There is no internal event bus, no queue between modules, no async messaging within the Lambda invocation. This is intentional:

- The orchestration is short, linear, and bounded (13 steps in `services.md`).
- An internal bus would add cold-start cost and obscure the trace.
- All async behaviour is at the *port* boundary (S3, DDB, SFN, Step Function task callback) — the orchestrator awaits these directly.

The only **external** asynchronous boundaries are the AWS service calls themselves (which AWS SDK handles).

---

## 4. Data Flow — Happy Path (one classification)

```
Step Function task   ─────►   handler-entry (LambdaHandler)
                                │
                                │ (1) validate input via InputValidator
                                v
                              application (ClassificationService.classify)
                                │
                                │ (2) WorkspaceConfigStore.get(workspaceId)
                                │        │
                                │        v
                                │     adapters.DDBWorkspaceConfigAdapter
                                │        │  (SDK v3 GetItem)
                                │        v
                                │     DynamoDB workspace-config table
                                │
                                │ (3) S3Reader.getRange(0..4099)
                                │        │
                                │        v
                                │     adapters.S3Adapter
                                │        │  (SDK v3 GetObject Range)
                                │        v
                                │     S3 bucket
                                │
                                │ (4..7) Tier1 -> Tier2(OLE2|ZIP) -> Tier3   (pure domain)
                                │ (8)    Scorer.score                         (pure domain)
                                │ (9)    CategoryMapper.map                   (pure domain)
                                │ (10)   SlipsheetDecider.decide              (pure domain)
                                │
                                │ (11) Hasher.sha256( S3Streamer.stream )
                                │        │
                                │        v
                                │     adapters.S3Adapter (stream) + NodeCryptoHasher
                                │
                                │ (12) ContentHashStore.get + putIfAbsent | update | replace
                                │        │
                                │        v
                                │     adapters.DDBContentHashAdapter
                                │        │  (SDK v3 Get / Conditional Put / Update)
                                │        v
                                │     DynamoDB content-hashes table
                                │
                                │ (13) OutputBuilder.build  →  §4.2 payload
                                v
                              handler-entry
                                │
                                │ TaskSignaler.sendTaskSuccess
                                │        │
                                │        v
                                │     adapters.StepFunctionAdapter
                                │        │  (SDK v3 SendTaskSuccess)
                                │        v
                                │     Step Functions State Machine
                                │
                                v
                            (Lambda returns void; SFN advances)
```

Every step emits `Logger.info` and Powertools metric + trace events (per `services.md` Observability).

---

## 5. Data Flow — Failure Path

```
Any step returns Result.error
                │
                │ (unwrap into ClassificationFailure { kind, ... })
                v
              ClassificationService returns Result.error
                │
                │ handler-entry maps kind → errorCode:
                │   - input-validation → "INPUT_VALIDATION_FAILED"
                │   - s3 (object-not-found) → "S3_OBJECT_NOT_FOUND"
                │   - s3 (access-denied)   → "S3_ACCESS_DENIED"
                │   - store (transient/throttled after retries) → THROW so SFN retry triggers
                │   - signal → THROW (so Lambda surfaces the failure)
                │   - unexpected → "UNEXPECTED_ERROR"
                │
                v
              TaskSignaler.sendTaskFailure({ taskToken, error: { code, message } })
                │
                v
              Step Functions branches to ErrorHandler state
```

Unhandled exceptions thrown in domain code are caught at the `LambdaHandler` global try/catch (per SECURITY-15) and produce `errorCode="UNEXPECTED_ERROR"`. **Fail-closed**: a partially-completed classification never produces `SendTaskSuccess`.

---

## 6. Module-Boundary Enforcement Rules (Q10=A)

These rules go in `.eslintrc.cjs` via `eslint-plugin-boundaries`:

```javascript
// .eslintrc.cjs (abridged)
module.exports = {
  plugins: ["boundaries"],
  settings: {
    "boundaries/elements": [
      { type: "domain",        pattern: "src/domain/*" },
      { type: "ports",         pattern: "src/ports/*" },
      { type: "adapters",      pattern: "src/adapters/*" },
      { type: "application",   pattern: "src/application/*" },
      { type: "handler-entry", pattern: "src/handler/*" },
      { type: "shared",        pattern: "src/shared/*" },
    ],
  },
  rules: {
    "boundaries/element-types": ["error", {
      default: "disallow",
      rules: [
        { from: "domain",        allow: ["domain", "shared"] },
        { from: "ports",         allow: ["domain", "ports", "shared"] },
        { from: "adapters",      allow: ["ports", "adapters", "shared"] },
        { from: "application",   allow: ["domain", "ports", "application", "shared"] },
        { from: "handler-entry", allow: ["domain", "ports", "adapters", "application", "shared"] },
        { from: "shared",        allow: ["shared"] },
      ],
    }],
    "no-restricted-imports": ["error", {
      // belt-and-braces — domain must never see AWS SDK
      paths: [
        { name: "@aws-sdk/client-s3",        importNames: ["*"], message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-dynamodb",  importNames: ["*"], message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-sfn",       importNames: ["*"], message: "AWS SDK forbidden in domain; use a port." },
      ],
    }],
  },
  overrides: [
    {
      files: ["src/adapters/**/*.ts", "src/handler/**/*.ts", "infra/**/*.ts"],
      rules: { "no-restricted-imports": "off" },
    },
  ],
};
```

A CI step runs `npm run lint` and fails the build on any boundary violation. This is the structural enforcement of the rules in §1.

---

## 7. Why this layout pays off for testing

| Test tier (per `requirements.md` §7) | Modules under test | LocalStack? | Speed |
|---|---|---|---|
| Pure-logic unit | `domain/*` | No | ms |
| PBT | `domain/*` (via `fast-check`) | No | seconds |
| Integration | `application/*` + `adapters/*` (real SDK against LocalStack endpoint) | Yes (testcontainers) | sub-second per test after warm start |
| Smoke | `handler/*` end-to-end via SAM Local + LocalStack | Yes + Lambda Docker | seconds per test |

The hexagonal layout maps **directly** to the test tiers — no awkward seams between "what's pure" and "what touches AWS".
