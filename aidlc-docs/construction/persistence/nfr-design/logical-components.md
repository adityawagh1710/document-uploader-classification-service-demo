# Logical Components — U-2 `persistence`

> Per-component NFR-role + pattern embodied + satisfaction mapping. Includes **test infrastructure components as first-class** (LocalStack globalSetup, integration test suite) and configuration components (DDB client construction module).

---

## 1. Source Components (under `src/`)

| Component | Hexagonal Layer | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|---|
| `ContentHashStore` (port interface) | ports | Adapter contract | Result-type plumbing (U-1 P-1) | NFR-4, SECURITY-15 |
| `WorkspaceConfigStore` (port interface) | ports | Adapter contract | Result-type plumbing (U-1 P-1) | NFR-4, NFR-6, SECURITY-15 |
| `DDBContentHashAdapter` | adapters | Wraps DDB for content-hashes | P-2-1 (shared client), P-2-4 (logging), P-2-5 (timeout), P-2-6 (race), P-2-7 (error map) | FR-7, FR-7.1, FR-7.2, NFR-4, NFR-10, SECURITY-03, 06, 15 |
| `DDBWorkspaceConfigAdapter` | adapters | Wraps DDB for workspace-config | Same pattern set | NFR-6, SECURITY-03, 06, 15 |
| `buildContentHashRecord` (pure helper) | adapters (shared/persistence helpers) | Record construction | Pure-function determinism (U-1 P-3) | NFR-5, PBT-U2-001 |
| `computeExpiresAt` (pure helper) | adapters (shared/persistence helpers) | TTL arithmetic | Pure-function determinism (U-1 P-3) | NFR-10, PBT-U2-002 |
| `serialiseRecord` / `deserialiseRecord` (pure helpers) | adapters (shared/persistence helpers) | Type-safe DDB pivots | Pure-function determinism + round-trip | NFR-5, PBT-U2-003 |
| `mapDDBError` (pure helper) | adapters (shared/persistence helpers) | SDK error → StoreError | P-2-7 (SDK error name pattern matching) | SECURITY-15, PBT-U2-004 |
| `isConditionalCheckFailed` (pure helper) | adapters (shared/persistence helpers) | Race-outcome detection | Discriminated narrowing | SECURITY-15 |
| `withTimeout` (helper) | adapters (shared/persistence helpers) | AbortSignal wrapper around `ddb.send` | P-2-5 | Latency budgets §2.1 |

---

## 2. Configuration Components

### 2.1 DDB Client Construction Module

```typescript
// src/adapters/dynamo-client.ts — shared between U-2's two adapters; also used by U-3's handler entry
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface DDBClientConfig {
  readonly endpoint?: string;       // set only for LocalStack tests
  readonly region?: string;         // defaults to AWS_REGION env
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };  // LocalStack only
}

export function createDDBDocumentClient(config: DDBClientConfig = {}): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    retryMode: "standard",
    maxAttempts: 3,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    ...(config.region !== undefined && { region: config.region }),
    ...(config.credentials !== undefined && { credentials: config.credentials }),
  });
  return DynamoDBDocumentClient.from(client);
}
```

- Production caller (U-3 handler entry): `createDDBDocumentClient()` — no overrides
- LocalStack caller (test globalSetup): `createDDBDocumentClient({ endpoint, region, credentials })`
- Pattern P-2-1 single shared client is enforced by *where* `createDDBDocumentClient()` is called (once at Lambda init, not per-request)

---

## 3. Test Infrastructure Components

### 3.1 `tests/integration/_setup.ts` — LocalStack `globalSetup` (Pattern P-2-2)

- Starts LocalStack container with `SERVICES: dynamodb`, `PERSISTENCE: 0`
- Provisions both tables (`content-hashes-test`, `workspace-config-test`) with schemas matching U-4's CDK
- Exposes `globalThis.__LOCALSTACK__` typed via `declare global`
- Teardown stops the container in CI cleanly

### 3.2 `tests/integration/persistence/content-hashes.test.ts` — Integration tests

Tests covering:
- `putIfAbsent` happy path
- `putIfAbsent` race → `Result.ok("already-existed")`
- `updateOnDuplicateHit` increments `hitCount` + refreshes `lastSeenAt`
- `updateOnDuplicateHit` vanished record → `Result.error("conditional-check-failed")` (Pattern P-2-6)
- `replaceOnPolicyMismatch` happy path
- `replaceOnPolicyMismatch` race → `Result.error("conditional-check-failed")` (Pattern P-2-6)
- **NFR-4: cross-workspace isolation** — write to A invisible to `get` against B (Pattern P-2-3)
- TTL: `expiresAt` written iff `hashTtlDays !== null` (Pattern P-2-1 indirectly; BR-2-TTL-*)

### 3.3 `tests/integration/persistence/workspace-config.test.ts` — Integration tests

- `get` returns full WorkspaceConfig
- `get` on missing workspaceId → `Result.error("not-found")`
- Strongly-consistent read verified (write + immediate read sees latest)

### 3.4 `tests/unit/persistence/*.test.ts` — Pure-helper unit tests

- `buildContentHashRecord.test.ts` — covers all input shapes
- `computeExpiresAt.test.ts` — covers timestamp / TTL arithmetic
- `serialise-deserialise.test.ts` — round-trip
- `mapDDBError.test.ts` — every documented SDK error name (Pattern P-2-7)
- `is-conditional-check-failed.test.ts` — discrimination

### 3.5 `tests/pbt/persistence.test.ts` — Property-based tests

- PBT-U2-001: `buildContentHashRecord` invariant
- PBT-U2-002: `computeExpiresAt` invariant
- PBT-U2-003: `serialise` ↔ `deserialise` round-trip
- PBT-U2-004: `mapDDBError` totality

Tests live under `tests/pbt/` per Q6=A (same colocation as U-1's PBT suite). The Vitest `globalSetup` for LocalStack is NOT triggered for PBT tests — they're pure-function tests.

---

## 4. ESLint Rule Additions (U-2-specific)

Append to `.eslintrc.cjs` `overrides` section:

```javascript
{
  files: ["src/adapters/dynamo-*/**/*.ts"],
  rules: {
    // U-2-specific: no console.log; force usage of injected Logger port
    "no-console": "error",
    // Require switch-exhaustiveness on AWS SDK error names
    "@typescript-eslint/switch-exhaustiveness-check": "error",
  },
},
```

The boundary rules already allow `adapters → ports`; no new rule needed there.

---

## 5. Vitest Configuration Updates

Append to existing `vitest.config.ts`:

```typescript
test: {
  // existing config…
  globalSetup: ["./tests/integration/_setup.ts"],
  include: [
    "tests/unit/**/*.test.ts",
    "tests/pbt/**/*.test.ts",
    "tests/integration/**/*.test.ts",   // NEW: include integration tests
    "tests/regression/**/*.test.ts",
  ],
  coverage: {
    // existing thresholds + NEW U-2 thresholds appended per NFR Reqs Q5=A
    thresholds: {
      "src/domain/**": { branches: 90, /* ... */ },
      "src/domain/tier2-ole2/**": { branches: 95, /* ... */ },
      "src/adapters/dynamo-content-hashes/**": { branches: 80, /* ... */ },
      "src/adapters/dynamo-workspace-config/**": { branches: 80, /* ... */ },
    },
  },
  // Integration tests need longer timeout (LocalStack startup + DDB calls)
  testTimeout: 30_000,
}
```

---

## 6. CI Workflow Components (logical — materialised in U-4)

| CI Job | Triggered on | Tool | Gate |
|---|---|---|---|
| `lint` | every PR + push | `eslint .` | Zero errors (covers new U-2 rules) |
| `typecheck` | every PR + push | `tsc --noEmit` | Zero errors |
| `test-unit` | every PR + push | `vitest run tests/unit tests/pbt` | All pass |
| `test-integration` | every PR + push | `vitest run tests/integration` | All pass (needs Docker in runner) |
| `coverage` | every PR + push | `vitest run --coverage` | ≥80% U-2 adapter; ≥90% U-1 domain (existing) |
| `supply-chain` | every PR + nightly | `npm audit --omit=dev --audit-level=high` | Zero high/critical |

GitHub Actions `ubuntu-latest` runners include Docker by default, so `testcontainers` works out-of-the-box.

---

## 7. NFR ↔ Component Coverage Matrix

| NFR / SECURITY / PBT rule | Components that satisfy it |
|---|---|
| NFR-4 (workspace isolation) | `DDBContentHashAdapter` (PK partitioned by workspaceId); `DDBWorkspaceConfigAdapter` (same); cross-workspace integration test (Pattern P-2-3) |
| NFR-5 (determinism) | Pure helpers `buildContentHashRecord`, `computeExpiresAt`, `serialiseRecord`, `deserialiseRecord`, `mapDDBError` |
| NFR-6 (config-driven) | `createDDBDocumentClient` accepts config; adapter factories take table names as deps; no hardcoded magic numbers |
| NFR-7 (structured logging) | Pattern P-2-4 across both adapters' 5 methods |
| NFR-10 (per-workspace TTL) | `computeExpiresAt` (PBT-U2-002); `buildContentHashRecord` writes `expiresAt` iff `hashTtlDays !== null` (BR-2-TTL-*) |
| Latency budgets §2.1 | Pattern P-2-5 (timeout); CloudWatch alarms in U-4 |
| SECURITY-03 (logging) | Pattern P-2-4; injected Logger port; never logs raw records |
| SECURITY-05 (validation) | Adapter sanity checks (non-empty strings); orchestrator does deep validation upstream |
| SECURITY-06 (IAM) | Per-table per-action permissions documented in NFR Reqs §2.6; enforced by `cdk-nag` in U-4 |
| SECURITY-08 (object-level auth) | NFR-4 partition key enforcement |
| SECURITY-10 (supply chain) | Exact-pinned `@aws-sdk/client-dynamodb@3.654.0` + `@aws-sdk/lib-dynamodb@3.654.0`; LocalStack image pin |
| SECURITY-11 (secure design) | Conditional writes (Pattern P-2-6); race-safe by construction |
| SECURITY-13 (integrity) | Conditional writes prevent unsafe last-write-wins on critical state |
| SECURITY-15 (fail-safe) | Result-type plumbing; never throws; unknown errors → `"unknown"` → orchestrator escalates |
| PBT-U2-001 (record construction) | `tests/pbt/persistence.test.ts` |
| PBT-U2-002 (TTL arithmetic) | Same |
| PBT-U2-003 (serialise round-trip) | Same |
| PBT-U2-004 (mapDDBError totality) | Same; Pattern P-2-7 |

Every applicable NFR / SECURITY / PBT rule has a named component satisfying it. No gaps.

---

## 8. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete CDK stack: `content-hashes` table with TTL on `expiresAt`, SSE, on-demand billing | Infrastructure Design (U-4) |
| Concrete CDK stack: `workspace-config` table with SSE, on-demand billing, strong-consistency reads enabled | Infrastructure Design (U-4) |
| `cdk-nag` rule exemptions (if any) | Infrastructure Design (U-4) |
| GitHub Actions workflow `.yml` with `test-integration` job | U-4 Infrastructure Design |
| The full SDK error name set documented in code-comment in `mapDDBError` | Code Generation |
| Tests verifying `withTimeout` fires within ±100ms of the configured 2s | Code Generation |
