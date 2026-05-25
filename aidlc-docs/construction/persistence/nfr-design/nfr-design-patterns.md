# NFR Design Patterns — U-2 `persistence`

> Seven patterns translating U-2's NFR Requirements into concrete coding/testing conventions. U-2 inherits Patterns #1–8 from U-1 (`nfr-design-patterns.md`); the patterns below are U-2-specific additions for DDB adapter concerns. Each pattern names the NFR(s) it satisfies, shows the pattern with TypeScript-flavoured pseudocode, and notes the enforcement mechanism.

---

## Pattern P-2-1 — Single shared DDB client lifecycle

**Satisfies**: NFR-6 (config-driven injection), latency budgets from NFR Requirements §2.1 (warm-start amortisation)

**Pattern**:

```typescript
// src/handler/lambda.ts (Lambda entry — outside U-2; shown here for context)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDDBContentHashAdapter } from "@adapters/dynamo-content-hashes/index.js";
import { createDDBWorkspaceConfigAdapter } from "@adapters/dynamo-workspace-config/index.js";

// Module-level singletons — constructed ONCE per cold start
const ddbClient = new DynamoDBClient({
  retryMode: "standard",
  maxAttempts: 3,
});
const ddb = DynamoDBDocumentClient.from(ddbClient);

// Adapters built ONCE; reused across all warm invocations
const contentHashStore = createDDBContentHashAdapter({
  ddb,
  tableName: process.env.CONTENT_HASH_TABLE_NAME!,
  logger,
});
const workspaceConfigStore = createDDBWorkspaceConfigAdapter({
  ddb,
  tableName: process.env.WORKSPACE_CONFIG_TABLE_NAME!,
  logger,
});

export const handler = async (event: TaskPayload) => {
  // adapters injected into orchestrator — no per-invocation construction
};
```

**Why this works**:
- `DynamoDBClient` holds an HTTPS keep-alive socket pool that's reused across all Lambda invocations in the same warm container — first-call latency drops from ~50ms (TLS handshake) to ~5ms (single round-trip).
- The Document Client wrapper is a stateless view; sharing it is safe.
- Both adapters use the same client → one socket pool for the whole Lambda.

**Enforcement**:
- Code review at Lambda entry — singleton pattern is conventional but easy to violate accidentally
- The adapter factory signatures require a `DynamoDBDocumentClient` parameter; constructing one per-call would be visibly weird
- Integration tests verify behaviour with a single shared client (per Pattern P-2-2)

---

## Pattern P-2-2 — LocalStack `globalSetup` for integration tests

**Satisfies**: NFR-4 (workspace isolation testable in CI), NFR Requirements §2.4 (one container per test run)

**Pattern**:

```typescript
// tests/integration/_setup.ts (Vitest globalSetup)
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

declare global {
  // eslint-disable-next-line no-var
  var __LOCALSTACK__: {
    container: StartedTestContainer;
    ddb: DynamoDBDocumentClient;
    contentHashTable: string;
    workspaceConfigTable: string;
  };
}

export async function setup() {
  const container = await new GenericContainer("localstack/localstack:3.7.0")
    .withExposedPorts(4566)
    .withEnvironment({
      SERVICES: "dynamodb",
      DEFAULT_REGION: "us-east-1",
      PERSISTENCE: "0",
    })
    .withWaitStrategy(Wait.forLogMessage("Ready."))
    .start();

  const endpoint = `http://localhost:${container.getMappedPort(4566)}`;
  const ddbClient = new DynamoDBClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    retryMode: "standard",
    maxAttempts: 3,
  });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  await provisionTables(ddb);

  globalThis.__LOCALSTACK__ = {
    container,
    ddb,
    contentHashTable: "content-hashes-test",
    workspaceConfigTable: "workspace-config-test",
  };
}

export async function teardown() {
  await globalThis.__LOCALSTACK__?.container.stop();
}

async function provisionTables(ddb: DynamoDBDocumentClient) {
  // Two CreateTableCommand calls — schemas exactly match U-4's CDK definitions
}
```

`vitest.config.ts` references the file via `globalSetup`:

```typescript
test: {
  globalSetup: ["./tests/integration/_setup.ts"],
}
```

**Enforcement**:
- Vitest enforces the `setup`/`teardown` contract automatically
- Container is stopped after `vitest run` completes; no leaked Docker containers in CI
- Tests reference `globalThis.__LOCALSTACK__` (typed via `declare global`) — TypeScript catches stale usage

---

## Pattern P-2-3 — Per-test UUID `workspaceId`

**Satisfies**: NFR-4 (workspace isolation verified by tests; no cross-test interference under parallel execution)

**Pattern**:

```typescript
// tests/integration/persistence/content-hashes.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, beforeEach, expect } from "vitest";
import { createDDBContentHashAdapter } from "@adapters/dynamo-content-hashes/index.js";

describe("DDBContentHashAdapter (integration)", () => {
  let workspaceId: string;
  let store: ContentHashStore;

  beforeEach(() => {
    workspaceId = `test-${randomUUID()}`;     // fresh per test; no cleanup needed
    store = createDDBContentHashAdapter({
      ddb: globalThis.__LOCALSTACK__.ddb,
      tableName: globalThis.__LOCALSTACK__.contentHashTable,
      logger: silentLogger,
    });
  });

  it("putIfAbsent returns 'written' on first write", async () => {
    const record = buildContentHashRecord({ workspaceId, contentHash: "abc", /* ... */ });
    const result = await store.putIfAbsent(record);
    expect(result).toEqual({ ok: true, value: "written" });
  });

  it("NFR-4: cross-workspace isolation — write to A invisible to B", async () => {
    const wsA = `test-${randomUUID()}`;
    const wsB = `test-${randomUUID()}`;
    await store.putIfAbsent(buildContentHashRecord({ workspaceId: wsA, contentHash: "abc", /* ... */ }));
    const fromB = await store.get({ workspaceId: wsB, contentHash: "abc" });
    expect(fromB).toEqual({ ok: true, value: null });
  });
});
```

**Why this works**:
- `crypto.randomUUID()` is collision-proof and built into Node 20 (no `uuid` dep)
- Parallel tests get distinct `workspaceId`s by construction — no isolation lock needed
- LocalStack runs with `PERSISTENCE=0` (Pattern P-2-2), so re-runs are also fresh

**Enforcement**:
- Convention via test scaffolding template
- The first test under "(integration)" each file MUST follow this pattern; code reviewers check for the `randomUUID()` in `beforeEach`

---

## Pattern P-2-4 — Adapter logging granularity

**Satisfies**: SECURITY-03 (structured logging), NFR-7 (sufficient logs to reconstruct decisions)

**Pattern**:

```typescript
// inside DDBContentHashAdapter.putIfAbsent
async putIfAbsent(record: ContentHashRecord): Promise<Result<PutOutcome, StoreError>> {
  const start = performance.now();
  logger.debug("putIfAbsent.start", {
    workspaceId: record.workspaceId,
    contentHash: record.contentHash,
  });

  try {
    await ddb.send(/* ...PutCommand... */);
    logger.debug("putIfAbsent.ok", {
      workspaceId: record.workspaceId,
      durationMs: Math.round(performance.now() - start),
      outcome: "written",
    });
    return ok("written");
  } catch (e) {
    if (isConditionalCheckFailed(e)) {
      logger.debug("putIfAbsent.race", {
        workspaceId: record.workspaceId,
        durationMs: Math.round(performance.now() - start),
      });
      return ok("already-existed");
    }
    const mapped = mapDDBError(e);
    logger.error("putIfAbsent.error", {
      workspaceId: record.workspaceId,
      durationMs: Math.round(performance.now() - start),
      errorCode: mapped,
      sdkErrorName: (e as Error)?.name,
    });
    return err(mapped);
  }
}
```

**Conventions**:
- Method name + state suffix: `<op>.start`, `<op>.ok`, `<op>.error`, `<op>.race` (race = expected conditional-check-failed outcome)
- All log entries carry `workspaceId` for tenant correlation
- Errors include `errorCode` (our StoreError) and `sdkErrorName` (the AWS SDK class name) for debugging
- NEVER log: full records, contentHash payloads beyond logging the value itself, credentials, raw SDK error objects (could contain credentials in headers)

**Enforcement**:
- Adapter logging template duplicated across all 4 methods in `DDBContentHashAdapter` + the 1 method in `DDBWorkspaceConfigAdapter`
- ESLint `no-restricted-syntax` rule (added in U-2 Code Generation) flags `console.log` outside test files
- The Powertools logger is injected via the `Logger` port; calls outside the port are visible in code review

---

## Pattern P-2-5 — Per-call `AbortSignal` timeout

**Satisfies**: Latency budgets §2.1, defense-in-depth against hung connections

**Pattern**:

```typescript
// inside any adapter method
const command = new GetCommand({
  TableName: this.contentHashTableName,
  Key: { workspaceId, contentHash },
});

const result = await ddb.send(command, {
  abortSignal: AbortSignal.timeout(2_000),    // 2s hard cap
});
```

**Behaviour**:
- After 2s, the SDK throws an `AbortError`
- `mapDDBError` catches it and returns `"transient"` (it's a network-class failure)
- Orchestrator escalates per Q9=C retry policy: SDK already retried 3× within its own timeout budget; this is the outer guard

**Timeout selection rationale**:
- Step Function task budget is typically 10–30s
- 2s hard cap leaves ample room for SDK retry passes (3 attempts × ~500ms each = ~1.5s) before timeout fires
- For p99 ≤ 30ms operations, 2s is 66× the budget — only fires on genuine hangs

**Enforcement**:
- A shared helper `withTimeout(send: SendCallback, ms: number)` wraps every DDB call
- Code review check: every `ddb.send()` call sites must use the helper
- Integration test simulating a hung connection (via LocalStack throttle or NetworkBlocking) verifies the timeout fires within ±100ms

---

## Pattern P-2-6 — Conditional-write race handling

**Satisfies**: SECURITY-15 (fail-safe defaults), NFR-4 (workspace isolation safe under concurrency)

**Pattern** — three methods, three different race semantics:

| Method | On ConditionalCheckFailed | Reason |
|---|---|---|
| `putIfAbsent` | `Result.ok("already-existed")` — not an error | "Row already exists" is an EXPECTED race outcome; orchestrator handles it |
| `updateOnDuplicateHit` | `Result.error("conditional-check-failed")` | Record was deleted between get + update — UNEXPECTED; orchestrator re-reads |
| `replaceOnPolicyMismatch` | `Result.error("conditional-check-failed")` | Another caller already re-classified — UNEXPECTED-but-recoverable; orchestrator re-reads |

The difference between the three methods is whether the conditional-check-failed outcome is a routine signal (putIfAbsent's race-detection) or an alarm (the other two indicate something happened that shouldn't have).

**Enforcement**:
- Unit tests cover all three conditional-check-failed outcomes (each method's race scenario)
- Integration tests with concurrent calls verify the contract (LocalStack supports conditional expression evaluation)
- The orchestrator (U-3 in Code Generation) has its own contract test that re-reads on `"conditional-check-failed"`

---

## Pattern P-2-7 — SDK error name pattern matching

**Satisfies**: SECURITY-15 (every error path mapped explicitly), PBT-U2-004 (error mapping totality)

**Pattern**:

```typescript
// src/adapters/dynamo-content-hashes/error-mapping.ts
export function mapDDBError(error: unknown): StoreError {
  if (!(error instanceof Error)) return "unknown";

  // AWS SDK v3 errors expose `name` matching the AWS error type
  const name = error.name;

  switch (name) {
    case "ConditionalCheckFailedException":
      return "conditional-check-failed";

    case "ProvisionedThroughputExceededException":
    case "ThrottlingException":
    case "RequestLimitExceeded":
      return "throttled";

    case "ResourceNotFoundException":
      return "unknown"; // table missing — infra issue, alarm-worthy

    case "InternalServerError":
    case "ServiceUnavailable":
      return "transient";

    case "TimeoutError":
    case "AbortError":
      return "transient";

    default:
      // Network errors don't have an SDK-specific name
      if (isRetryableNetworkError(error)) return "transient";
      return "unknown";
  }
}

function isRetryableNetworkError(error: Error): boolean {
  const code = (error as Error & { code?: string }).code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EHOSTUNREACH";
}
```

**Why exhaustive matching**:
- Every documented SDK error name has an explicit case
- The `default` case returns `"unknown"` — never silently swallows
- PBT-U2-004 verifies that every documented error name maps to a non-`"unknown"` value

**Enforcement**:
- `@typescript-eslint/switch-exhaustiveness-check` rule is on (per U-1's `.eslintrc.cjs`); a future TypeScript union of SDK error names would force exhaustive coverage
- PBT-U2-004 covers totality on the documented set; new SDK error names added to the spec must be added to the switch + the property

---

## Pattern Summary Table

| # | Pattern | Satisfies | Enforcement |
|---|---|---|---|
| P-2-1 | Single shared DDB client lifecycle | Latency budgets, NFR-6 | Singleton at Lambda init; factory signatures require Document Client; code review |
| P-2-2 | LocalStack `globalSetup` | NFR-4 (testable isolation), Q4=A NFR Reqs | Vitest globalSetup; teardown cleanup; `globalThis.__LOCALSTACK__` typed |
| P-2-3 | Per-test UUID workspaceId | NFR-4 | `crypto.randomUUID()` in beforeEach; collision-proof under parallel runs |
| P-2-4 | Adapter logging granularity | SECURITY-03, NFR-7 | Template duplicated across 5 methods; ESLint `no-restricted-syntax`; Powertools `LOG_LEVEL` |
| P-2-5 | Per-call `AbortSignal.timeout(2s)` | Latency budgets, hang defense | `withTimeout` helper; integration test for hung-connection scenario |
| P-2-6 | Conditional-write race handling | SECURITY-15, NFR-4 | 3 race outcomes documented per-method; unit + integration tests; orchestrator contract test |
| P-2-7 | SDK error name pattern matching | SECURITY-15, PBT-U2-004 | Exhaustive switch; PBT-U2-004 totality property; ESLint switch-exhaustiveness rule |
