# Domain Entities — U-2 `persistence`

> DDB record shapes, port interfaces, and the StoreError discriminator. Entity definitions stay aligned with `requirements.md` §4.3, §4.4 and `application-design/components.md` ports P-04, P-05.

---

## 1. Entity Index

| Entity | Layer | Used By |
|---|---|---|
| `ContentHashRecord` | shared | `DDBContentHashAdapter`, U-3 orchestrator |
| `WorkspaceConfig` | shared | `DDBWorkspaceConfigAdapter`, U-3 orchestrator |
| `ContentHashStore` (port) | ports | implemented by `DDBContentHashAdapter`; consumed by U-3 |
| `WorkspaceConfigStore` (port) | ports | implemented by `DDBWorkspaceConfigAdapter`; consumed by U-3 |
| `StoreError` | shared (cross-cutting, U-2 owns the canonical union) | adapter return values; U-3 orchestrator pattern-matches on |
| `PutOutcome` | local to U-2 | `putIfAbsent` return shape |
| `ContentHashRecordInit` | local to U-2 | input to `buildContentHashRecord` helper |
| `UpdateOnDuplicateHitInput` | local to U-2 | input to `updateOnDuplicateHit` |
| `ReplaceOnPolicyMismatchInput` | local to U-2 | input to `replaceOnPolicyMismatch` |

---

## 2. `ContentHashRecord` (DDB row shape — restated from §4.3)

```typescript
// declared in src/shared/types.ts (U-1 bootstrap)
export interface ContentHashRecord {
  readonly workspaceId: string;         // partition key
  readonly contentHash: string;         // sort key — SHA-256 hex
  readonly firstSeenAt: string;         // ISO-8601, immutable after first write
  readonly firstDocumentId: string;     // immutable
  readonly format: string;              // immutable after first write
  readonly policyVersion: string;       // refreshed only on policy-mismatch overwrite
  readonly lastSeenAt: string;          // updated on every non-override duplicate hit
  readonly hitCount: number;            // incremented on every non-override duplicate hit
  readonly expiresAt?: number;          // TTL — unix seconds; present only when workspace has hashTtlDays set
}
```

**Field rules**:
- `workspaceId` is the DDB partition key; NEVER cross-workspace
- `contentHash` is lowercase SHA-256 hex (64 chars); validated by U-3 before reaching this adapter
- `firstSeenAt === lastSeenAt` on first write; thereafter `lastSeenAt` advances
- `hitCount` starts at 0 on first write
- `expiresAt` (when present) is a unix-seconds integer — DynamoDB TTL operates on this

---

## 3. `WorkspaceConfig` (DDB row shape — restated from §4.4)

```typescript
// declared in src/shared/types.ts (U-1 bootstrap)
export interface WorkspaceConfig {
  readonly workspaceId: string;         // partition key
  readonly policyVersion: string;
  readonly threshold: number;           // ∈ [0, 1]
  readonly maxZipDepth: number;         // ≥ 0
  readonly quarantineMacros: boolean;
  readonly slipsheetRules: Readonly<Record<string, "always-slipsheet">>;
  readonly hashTtlDays: number | null;  // null → no TTL; positive integer → days from firstSeenAt
}
```

**Field rules**:
- `policyVersion` is opaque to U-2; treated as a string. U-3 / Workspace Operator manage versioning policy.
- `threshold` validated upstream (U-3) to be in [0, 1]; U-2 doesn't validate again.
- `slipsheetRules` keys are lowercased format strings; values always `"always-slipsheet"`.
- `hashTtlDays === null` is the explicit "no TTL" signal; the adapter must NOT write an `expiresAt` attribute in this case.

---

## 4. Port Interfaces (located in `src/ports/`)

These ports are bootstrapped by U-2 in its Code Generation phase (they don't exist yet — U-1 only created `Logger`).

### 4.1 `ContentHashStore` (P-04)

```typescript
import type { ContentHashRecord } from "@shared/types.js";
import type { Result } from "@shared/result.js";

export type StoreError =
  | "conditional-check-failed"
  | "throttled"
  | "transient"
  | "not-found"
  | "unknown";

export type PutOutcome = "written" | "already-existed";

export interface ContentHashStore {
  get(input: { workspaceId: string; contentHash: string }):
    Promise<Result<ContentHashRecord | null, StoreError>>;

  putIfAbsent(record: ContentHashRecord):
    Promise<Result<PutOutcome, StoreError>>;

  updateOnDuplicateHit(input: { workspaceId: string; contentHash: string; now: string }):
    Promise<Result<void, StoreError>>;

  replaceOnPolicyMismatch(input: {
    record: ContentHashRecord;
    expectedStalePolicyVersion: string;
  }): Promise<Result<void, StoreError>>;
}
```

### 4.2 `WorkspaceConfigStore` (P-05)

```typescript
import type { WorkspaceConfig } from "@shared/types.js";
import type { Result } from "@shared/result.js";

export interface WorkspaceConfigStore {
  get(workspaceId: string): Promise<Result<WorkspaceConfig, StoreError>>;
}
```

**Note**: `StoreError` is shared between both stores so the orchestrator can pattern-match identically.

---

## 5. `StoreError` Discriminator (canonical enumeration)

| Variant | When | Orchestrator behaviour |
|---|---|---|
| `"conditional-check-failed"` | `putIfAbsent` found existing row; or `updateOnDuplicateHit` found vanished row; or `replaceOnPolicyMismatch` found stale-policy raced | Application-specific: re-read + decide. NOT a retry. |
| `"throttled"` | `ProvisionedThroughputExceededException`, `ThrottlingException`, `RequestLimitExceeded` from SDK | SDK retries should absorb; if surfaced, **throw** so Step Function task retry triggers (per Q9=C requirements). |
| `"transient"` | Network errors, 5xx responses after SDK retries exhausted | Same as throttled — throw so SFN re-invokes. |
| `"not-found"` | `WorkspaceConfigStore.get` found no row for workspaceId | Alarm-worthy — workspace must exist for a valid invocation. `SendTaskFailure` with errorCode `WORKSPACE_NOT_FOUND`. |
| `"unknown"` | `ResourceNotFoundException` (table missing — infra issue) OR any unrecognised SDK error | Escalate — `SendTaskFailure` with errorCode `INTERNAL_ERROR`. |

**Why these five variants** (no more, no less):
- `conditional-check-failed` carries domain meaning the orchestrator needs (race-safe re-read).
- `throttled` vs `transient` are both retry-able but distinguishable so SDK retry tuning can differ.
- `not-found` is genuinely different from `unknown` (workspace missing vs adapter misconfigured).
- `unknown` is the catch-all that must escalate.

PBT-U2-004 verifies the documented SDK error → StoreError mapping is total.

---

## 6. Helper Input Types (local to U-2)

```typescript
// in src/adapters/dynamo-content-hashes/types.ts
export interface ContentHashRecordInit {
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly format: string;
  readonly policyVersion: string;
  readonly firstDocumentId: string;
  readonly now: string;                      // ISO-8601 timestamp from orchestrator
  readonly hashTtlDays: number | null;       // from WorkspaceConfig
}

export interface UpdateOnDuplicateHitInput {
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly now: string;
}

export interface ReplaceOnPolicyMismatchInput {
  readonly record: ContentHashRecord;
  readonly expectedStalePolicyVersion: string;   // the policyVersion that was on the record when we read it
}
```

---

## 7. Case-A/B/C/D Record-Flow Diagram

Reproduced from `services.md` STEP 12 for U-2 reference — each case maps to a specific U-2 adapter method call:

```
Orchestrator: ContentHashStore.get(workspaceId, contentHash)
                 │
                 ├── Result.ok(null) ────► CASE A — first time
                 │       │
                 │       └── ContentHashStore.putIfAbsent(record)
                 │              │
                 │              ├── Result.ok("written") → isDuplicate=false
                 │              ├── Result.ok("already-existed") → race detected; re-enter at the top
                 │              └── Result.error(...) → orchestrator decides
                 │
                 ├── Result.ok(record) AND override flag set ────► CASE B
                 │       │
                 │       └── (no adapter call) — orchestrator continues pipeline with isDuplicate=true,
                 │           record fully immutable per Q15=C of Requirements
                 │
                 ├── Result.ok(record) AND record.policyVersion !== current ────► CASE C
                 │       │
                 │       └── ContentHashStore.replaceOnPolicyMismatch({
                 │              record: rebuiltRecord,
                 │              expectedStalePolicyVersion: oldVersion
                 │           })
                 │              │
                 │              ├── Result.ok → re-classify; isDuplicate=false
                 │              ├── Result.error("conditional-check-failed") → another caller raced; re-read
                 │              └── Result.error(...) → orchestrator decides
                 │
                 └── Result.ok(record) AND policyVersion matches AND no override ────► CASE D
                         │
                         └── ContentHashStore.updateOnDuplicateHit({ workspaceId, contentHash, now })
                                │
                                ├── Result.ok → isDuplicate=true; short-circuit
                                ├── Result.error("conditional-check-failed") → record vanished; re-read
                                └── Result.error(...) → orchestrator decides
```

Every Case touches exactly one adapter method. The adapter never sees the "case" — it just implements the four primitives correctly.

---

## 8. Entities Out of Scope for U-2

For clarity:
- `TaskPayload` — U-3 input contract; U-2 sees only fields it needs (workspaceId, contentHash)
- `ClassificationOutput` — U-3 builds this; U-2 sees neither the input nor the output
- `Logger` port — consumed by U-2 (passed via factory), defined by U-1
- `S3Reader`, `S3Streamer`, `Hasher`, `TaskSignaler` — U-3 ports; U-2 never touches them
