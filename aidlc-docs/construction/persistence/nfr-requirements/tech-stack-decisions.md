# Tech Stack Decisions — U-2 `persistence`

> New runtime dependencies introduced by U-2 + DDB client configuration + LocalStack integration. Inherits everything from U-1's tech-stack-decisions.md.

---

## 1. Service-Level Decisions Inherited

| Concern | Choice | Source |
|---|---|---|
| Runtime | Node.js 20.x LTS | U-1 |
| Language | TypeScript strict-plus | U-1 |
| Test framework | Vitest | U-1 |
| PBT framework | fast-check | U-1 |
| Project layout | Single `package.json` | U-1 |
| Module-boundary enforcement | `eslint-plugin-boundaries` | U-1 |
| DynamoDB client abstraction | AWS SDK v3 `DynamoDBDocumentClient` | Application Design Q5=A |
| Capacity mode | On-demand | This stage Q2=A |
| SDK retry mode | `standard`, `maxAttempts: 3` | This stage Q3=A |

---

## 2. U-2 Runtime Dependencies (exact pins)

Added to `package.json` `dependencies` during U-2's Code Generation phase.

| Package | Version | Pin Strategy | Why this choice / version |
|---|---|---|---|
| `@aws-sdk/client-dynamodb` | `3.654.0` | **Exact** | Pinned for reproducibility. AWS SDK v3 ships breaking changes in minor versions periodically (e.g., bundler-related shape changes), so exact pinning ensures CI matches local; major-version upgrades go through a deliberate PR. |
| `@aws-sdk/lib-dynamodb` | `3.654.0` | **Exact** | The Document Client wrapper. MUST match the `client-dynamodb` major version. |

**Why both?** `@aws-sdk/client-dynamodb` is the low-level marshalled client; `@aws-sdk/lib-dynamodb` is the Document Client wrapper that handles `Record<string, unknown>` ↔ DDB AttributeValue automatically. Per Application Design Q5=A, we use the Document Client for ergonomics.

---

## 3. U-2 Dev / Test Dependencies (caret pins)

Added to `devDependencies` during U-2's Code Generation phase.

| Package | Version | Pin Strategy | Rationale |
|---|---|---|---|
| `testcontainers` | `^10.13.0` | Caret | LocalStack container orchestration; stable v10.x line; supports custom Docker image versions for LocalStack |
| `@types/node` | `^20.14.0` | Caret | Node 20 type definitions; needed for `crypto.randomUUID` and `node:test` runner helpers (if used) |

LocalStack itself is not an npm dep — it's a Docker image pulled by `testcontainers` at test-run time.

---

## 4. LocalStack Configuration

### 4.1 Image Pin
```typescript
// tests/integration/_setup.ts (created in U-2 Code Generation)
const LOCALSTACK_IMAGE = "localstack/localstack:3.7.0";
```

Pinned at minor version. Major upgrades (e.g., LocalStack 4.x) get a deliberate PR.

### 4.2 Container Spec
```typescript
const container = await new GenericContainer(LOCALSTACK_IMAGE)
  .withExposedPorts(4566)
  .withEnvironment({
    SERVICES: "dynamodb",
    DEFAULT_REGION: "us-east-1",
    PERSISTENCE: "0",                 // ephemeral; each test run starts fresh
  })
  .withWaitStrategy(Wait.forLogMessage("Ready."))
  .start();
```

### 4.3 SDK Client for LocalStack Tests
```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
  region: "us-east-1",
  endpoint: `http://localhost:${container.getMappedPort(4566)}`,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  retryMode: "standard",
  maxAttempts: 3,
});
export const ddb = DynamoDBDocumentClient.from(ddbClient);
```

### 4.4 SDK Client for Production
```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
  retryMode: "standard",
  maxAttempts: 3,
  // no endpoint override; SDK auto-discovers region from Lambda env
});
export const ddb = DynamoDBDocumentClient.from(ddbClient);
```

The production client config and the LocalStack client config differ only in `endpoint` + `credentials`. A helper in `src/handler/lambda.ts` (created in U-3 Code Generation) constructs the production variant.

---

## 5. Vitest Coverage Threshold Updates

Append to the existing `vitest.config.ts` `coverage.thresholds` map:

```typescript
thresholds: {
  // existing U-1 thresholds
  "src/domain/**": { branches: 90, functions: 90, lines: 90, statements: 90 },
  "src/domain/tier2-ole2/**": { branches: 95, functions: 95, lines: 95, statements: 95 },

  // new U-2 thresholds (Q5=A)
  "src/adapters/dynamo-content-hashes/**": { branches: 80, functions: 80, lines: 80, statements: 80 },
  "src/adapters/dynamo-workspace-config/**": { branches: 80, functions: 80, lines: 80, statements: 80 },
}
```

The 95% threshold for "pure helpers" is enforced indirectly — the helpers are in the `adapters/dynamo-content-hashes/` folder; the 80% directory threshold is generous but the helpers' tests will naturally hit ~100% because they're trivially testable.

---

## 6. Package.json Excerpt (after U-2 Code Generation)

```jsonc
{
  "dependencies": {
    "file-type": "21.0.0",
    "@aws-sdk/client-dynamodb": "3.654.0",
    "@aws-sdk/lib-dynamodb": "3.654.0"
  },
  "devDependencies": {
    // existing U-1 dev deps
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "fast-check": "^3.19.0",
    "eslint": "^8.57.0",
    "eslint-plugin-boundaries": "^4.2.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    // new U-2 dev deps
    "testcontainers": "^10.13.0",
    "@types/node": "^20.14.0"
  }
}
```

---

## 7. Supply Chain Hygiene (SECURITY-10)

| Practice | Configuration |
|---|---|
| Lockfile committed | `package-lock.json` |
| Exact-pinned AWS SDK | `@aws-sdk/client-dynamodb@3.654.0`, `@aws-sdk/lib-dynamodb@3.654.0` |
| LocalStack image pinned | `localstack/localstack:3.7.0` |
| Vulnerability scan | `npm audit --omit=dev --audit-level=high` (existing CI gate) |
| SBOM | `npm sbom` (existing CI gate) |
| Trusted registries | npm public registry; Docker Hub for LocalStack (consider verified mirror in production) |

---

## 8. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Final `vitest.config.ts` after merging thresholds | NFR Design |
| `tests/integration/_setup.ts` global LocalStack setup | NFR Design (logical) + Code Generation (concrete) |
| DDB client factory module location and naming | Code Generation |
| AWS SDK v3 error name catalogue for `mapDDBError` exhaustiveness test | Code Generation |
| CDK stack: `content-hashes` TTL attribute = `expiresAt`, on-demand billing, SSE | Infrastructure Design |
| CDK stack: `workspace-config` on-demand billing, SSE | Infrastructure Design |
| `cdk-nag` rule exemptions (if any) | Infrastructure Design |
