# Business Rules — U-2 `persistence`

> All persistence-layer rules: workspace isolation, conditional-write semantics, error mapping, TTL behaviour, and the PBT property catalogue.

---

## 1. Universal Rules

| Rule ID | Rule | Source |
|---|---|---|
| BR-2-1 | Adapter never throws; always returns `Result<T, StoreError>` (except the documented "should never happen" branch in `computeExpiresAt`) | BR-5 + Q5=A |
| BR-2-2 | Adapter never logs sensitive data; only structural metadata (operation name, workspaceId, error code, durations) | SECURITY-03 |
| BR-2-3 | Every operation MUST be scoped by `workspaceId` (the partition key) — no scans, no GSIs that index across workspaces | NFR-4 |
| BR-2-4 | All DynamoDB operations use the v3 `DynamoDBDocumentClient` (per Application Design Q5=A) — never raw `DynamoDBClient` with manual marshalling | Application Design Q5=A |
| BR-2-5 | The adapter is stateless; no in-process caching of records or config | Q4=A |

---

## 2. Workspace Isolation Rules (NFR-4 enforcement)

| Rule | Behaviour |
|---|---|
| BR-2-WI-1 | Every `GetCommand` includes `Key: { workspaceId, contentHash }` (or `Key: { workspaceId }` for config) — never any other access pattern |
| BR-2-WI-2 | No `ScanCommand` is used in U-2; the adapter exposes no method that could scan across workspaces |
| BR-2-WI-3 | No GSI/LSI is defined that would index outside `workspaceId` — verified at CDK synth time (U-4) |
| BR-2-WI-4 | Integration tests in U-2 explicitly verify cross-workspace isolation: writing record `(workspace=A, hash=X)` MUST be invisible to `get(workspace=B, hash=X)` |

NFR-4 is the highest-priority NFR for U-2 — cross-workspace leakage would be a critical security failure.

---

## 3. Conditional-Write Rules

### BR-2-CW-1 — `putIfAbsent` (Q1=A)
- ConditionExpression: `"attribute_not_exists(contentHash)"`
- Failure path: `ConditionalCheckFailedException` → return `Result.ok("already-existed")` (NOT `Result.error`)
- Success path: row written; return `Result.ok("written")`

### BR-2-CW-2 — `updateOnDuplicateHit` (Q2=B)
- ConditionExpression: `"attribute_exists(contentHash)"`
- UpdateExpression: `"SET lastSeenAt = :now ADD hitCount :one"`
- ExpressionAttributeValues: `{ ":now": <iso>, ":one": 1 }`
- Failure path: any error → `Result.error(mapDDBError(error))`. `conditional-check-failed` here means the record was deleted between the orchestrator's `get` and this `update` — orchestrator re-reads.
- Success path: `Result.ok(undefined)`. The two updated attributes are the ONLY mutations; immutable fields (`format`, `firstSeenAt`, `firstDocumentId`, `policyVersion`) are untouched.

### BR-2-CW-3 — `replaceOnPolicyMismatch` (Q3=A)
- Operation: `PutCommand` (full row replacement)
- ConditionExpression: `"policyVersion = :stalePolicyVersion"`
- ExpressionAttributeValues: `{ ":stalePolicyVersion": <expected old version> }`
- Failure path: `conditional-check-failed` means another caller raced and already overwrote with a new version — orchestrator re-reads.
- Success path: row fully replaced — `firstSeenAt` resets to `now`, `hitCount` resets to 0, all immutable fields take fresh values.

---

## 4. Error Mapping Rules (BR-2-E-* — Q5=A complete table)

| AWS SDK v3 Error name / class | Maps to `StoreError` | Orchestrator typical action |
|---|---|---|
| `ConditionalCheckFailedException` | `"conditional-check-failed"` | Application-specific re-read + re-decide |
| `ProvisionedThroughputExceededException` | `"throttled"` | SDK retries handle; if surfaced → throw → SFN retry |
| `ThrottlingException` | `"throttled"` | Same as above |
| `RequestLimitExceeded` | `"throttled"` | Same as above |
| `ResourceNotFoundException` | `"unknown"` | Infrastructure misconfiguration — escalate via SendTaskFailure |
| `InternalServerError` | `"transient"` | SDK retries handle; if surfaced → throw → SFN retry |
| `ServiceUnavailable` | `"transient"` | Same as InternalServerError |
| Retryable network errors (ECONNRESET, ETIMEDOUT, etc.) | `"transient"` | Same as InternalServerError |
| (anything else) | `"unknown"` | Escalate; log full error details for diagnosis |

**Special case** — `WorkspaceConfigStore.get`:
- Successful response with `Item === undefined` → `Result.error("not-found")` (NOT `"unknown"` — this is a distinct alarm condition)

**Property** (PBT-U2-004): every documented SDK error name above maps to exactly one non-`"unknown"` `StoreError`.

---

## 5. TTL Rules

| Rule | Behaviour |
|---|---|
| BR-2-TTL-1 | When `hashTtlDays === null`, the adapter MUST NOT write an `expiresAt` attribute. DDB silently ignores rows without the TTL attribute. |
| BR-2-TTL-2 | When `hashTtlDays === n` (positive integer), `expiresAt = floor(epochSeconds(firstSeenAt)) + n * 86400` |
| BR-2-TTL-3 | DDB TTL operates on a **best-effort 48-hour window** — actual deletion is delayed; client code must NOT assume strict timeliness |
| BR-2-TTL-4 | On `replaceOnPolicyMismatch`, `expiresAt` is **recomputed** from the new `firstSeenAt` (which is `now`). Old `expiresAt` is discarded. |
| BR-2-TTL-5 | On `updateOnDuplicateHit`, `expiresAt` is **NOT** touched — it remains tied to the original `firstSeenAt`. |

**Property** (PBT-U2-002): `expiresAt` arithmetic verified for arbitrary `(firstSeenAt, ttlDays)` inputs.

---

## 6. ISO-8601 Date Handling Rules

| Rule | Behaviour |
|---|---|
| BR-2-DT-1 | Timestamps are stored as ISO-8601 UTC strings in DDB (e.g., `"2026-05-22T15:32:00.000Z"`) — never as numbers, never as local time |
| BR-2-DT-2 | The orchestrator (U-3) generates `now` and passes it as a string to the adapter — the adapter NEVER calls `Date.now()` or `new Date()` itself |
| BR-2-DT-3 | `computeExpiresAt` parses the ISO string via `Date.parse` and divides by 1000 to get unix seconds; result is `Math.floor(...) + ttlDays * 86400` |
| BR-2-DT-4 | Date parse failure in `computeExpiresAt` is a programmer error (orchestrator must pass valid ISO) — throws `RangeError`. The adapter's entry-point catch translates this to `Result.error("unknown")`. |

**Property** (PBT-U2-003): serialise/deserialise round-trips preserve ISO date strings byte-for-byte.

---

## 7. Concurrency Rules

| Rule | Behaviour |
|---|---|
| BR-2-CR-1 | Concurrent `putIfAbsent` calls for the same key are race-safe — at most one returns `"written"`; the rest return `"already-existed"` |
| BR-2-CR-2 | Concurrent `updateOnDuplicateHit` calls for the same key are atomically serialised by DDB; `hitCount` increments are not lost |
| BR-2-CR-3 | Concurrent `replaceOnPolicyMismatch` calls for the same key with the same `expectedStalePolicyVersion` — at most one succeeds; the rest fail with `conditional-check-failed` |
| BR-2-CR-4 | Adapter methods are referentially safe to call repeatedly with the same input (idempotent at the orchestrator level — the orchestrator may retry after a `transient` failure without corruption) |

---

## 8. PBT Property Catalogue (PBT-01 satisfaction)

The 4 properties from `persistence-functional-design-plan.md` §A.6.1, restated as the testable contract carried into Code Generation:

| ID | Module | Category | Property | PBT rule |
|---|---|---|---|---|
| PBT-U2-001 | `buildContentHashRecord` | Invariant | For any valid `ContentHashRecordInit`, the produced record has `firstSeenAt === lastSeenAt === now`, `hitCount === 0`, immutable fields set to inputs, and `expiresAt` present iff `hashTtlDays !== null` | PBT-03 |
| PBT-U2-002 | `computeExpiresAt` | Invariant | For any valid ISO `firstSeenAt` and `ttlDays > 0`, `computeExpiresAt(firstSeenAt, ttlDays) === Math.floor(epochSeconds(firstSeenAt)) + ttlDays * 86400` (±1 s tolerance) | PBT-03 |
| PBT-U2-003 | `serialiseRecord` ↔ `deserialiseRecord` | Round-trip | `deserialiseRecord(serialiseRecord(record))` deep-equals `record` for any valid `ContentHashRecord` | PBT-02 |
| PBT-U2-004 | `mapDDBError` | Totality | For every documented SDK error name from §4, `mapDDBError` returns a non-`"unknown"` `StoreError` | PBT-03 |

All 4 properties are pure-function tests — no DDB / LocalStack interaction needed. They run alongside U-1's PBT suite in the regular `npm run test:pbt` invocation.

---

## 9. SECURITY Compliance Notes for U-2

| Rule | How U-2 satisfies |
|---|---|
| SECURITY-03 (app logging) | Adapter uses injected `Logger` port; only logs operation name + workspaceId + duration + error code. NEVER logs raw record contents, full payloads, or SDK credentials. |
| SECURITY-05 (input validation) | Adapter assumes the orchestrator validated inputs (workspaceId, contentHash format). The adapter MAY add cheap sanity checks (e.g., non-empty strings) but does not redo full validation. |
| SECURITY-06 (least-privilege IAM) | The Lambda execution role's DDB permissions (defined in U-4 infrastructure) MUST be scoped to the specific table ARNs — `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` on the two named tables; nothing else. NO `Resource: "*"`. |
| SECURITY-09 (hardening) | DDB tables have public access blocked by default; tables created without resource-based policies. |
| SECURITY-10 (supply chain) | AWS SDK v3 packages (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) are exact-pinned in `package.json` when added in U-2's Code Generation. |
| SECURITY-13 (data integrity) | All DDB writes use conditional expressions where appropriate (Q1, Q2, Q3) — no unsafe last-write-wins on critical state. Record overwrites are auditable via DDB Streams (configurable in U-4). |
| SECURITY-15 (fail-safe) | Adapter never throws to its caller; all paths return `Result<T, StoreError>`. Fail-closed: any unknown error → `"unknown"` → orchestrator escalates via SendTaskFailure. |

---

## 10. Cross-cutting Reminders

- **NFR-4 is the highest-priority NFR for U-2** — workspace isolation. Integration tests in U-2's Code Generation phase MUST include explicit cross-workspace isolation tests.
- **DDB Document Client v3 syntax** — `ConditionExpression` strings use placeholders (`:name`); attribute names that collide with DDB reserved words go in `ExpressionAttributeNames` (`#name`). None of our attribute names (`workspaceId`, `contentHash`, `firstSeenAt`, etc.) are reserved, so `ExpressionAttributeNames` is unused in U-2.
- **No `BatchGetItem` / `BatchWriteItem`** — U-2's contract is per-record. Batch operations come with partial-failure semantics that complicate the Result-type plumbing for no current benefit.
