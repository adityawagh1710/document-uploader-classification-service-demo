# Functional Design Plan — U-2 `persistence`

> Per-unit Construction stage 1/5. U-2 is the **DynamoDB adapter layer** owning two tables:
> - `content-hashes` (PK `workspaceId`, SK `contentHash`) — the dedup index with policy-version self-healing
> - `workspace-config` (PK `workspaceId`) — the per-tenant policy lookup
>
> Detailed business logic for U-2 is mostly about getting the **DynamoDB `UpdateExpression` and `ConditionExpression` strings exactly right** — these are easy to get subtly wrong, and integration tests against LocalStack catch most issues. The 6 questions below resolve the remaining ambiguities.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Functional Design Questions

### Question 1 — `ContentHashStore.putIfAbsent` exact ConditionExpression
On the first-time write of a new content-hash record, we need a conditional write that fails (returns `Result.error("conditional-check-failed")`) when the row already exists. Choose the condition:

A) **`attribute_not_exists(contentHash)`** — DynamoDB's idiomatic "row doesn't exist" check. SK-attribute presence is the canonical existence test inside a partitioned table.

B) `attribute_not_exists(workspaceId) AND attribute_not_exists(contentHash)` — belt-and-braces; verbose but unambiguous.

C) `attribute_not_exists(firstSeenAt)` — checks an arbitrary always-present-on-existing-rows attribute. Works but less self-documenting.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `attribute_not_exists(contentHash)` is the canonical AWS-documented form for "row doesn't exist" in a composite-PK table. DynamoDB evaluates this against the row identified by `(workspaceId, contentHash)`, so the condition is intrinsically scoped to the partition. Option B is redundant since the PK uniquely identifies the row. Option C makes the intent opaque.

### Question 2 — `updateOnDuplicateHit` — atomic UpdateExpression for non-override hit
When a non-override duplicate-hash hit lands, we need to increment `hitCount` and refresh `lastSeenAt` while preserving immutable fields. Choose the UpdateExpression shape:

A) **`SET lastSeenAt = :now ADD hitCount :one`** with `ExpressionAttributeValues: { ":now": <iso>, ":one": 1 }`, no ConditionExpression (the record exists by virtue of being a duplicate hit).

B) Same SET/ADD but with `ConditionExpression: attribute_exists(contentHash)` — protect against the race where the record was deleted between get and update.

C) `SET lastSeenAt = :now, hitCount = if_not_exists(hitCount, :zero) + :one` — more verbose; handles the case where `hitCount` was never set on the original row.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Option A is fine in the happy path but DynamoDB's `ADD` operation creates the attribute if it doesn't exist — so if a record was *manually* deleted between the get and the update, we'd silently re-create a partial record with no `firstSeenAt`/`format` (data corruption). Option B's `ConditionExpression: attribute_exists(contentHash)` makes the update **fail closed**: if the record vanished, we return `Result.error("conditional-check-failed")` and the orchestrator can decide. This is the SECURITY-15 fail-safe-default principle applied to persistence.

### Question 3 — `replaceOnPolicyMismatch` — overwrite-with-condition
When a duplicate hit lands but the cached `policyVersion` differs from current workspace policy, we re-classify and overwrite. Choose the write strategy:

A) **`PutItem` with `ConditionExpression: policyVersion = :stalePolicyVersion`** — only succeed if no concurrent re-classification raced us. Resets `lastSeenAt`/`hitCount` to fresh values.

B) `UpdateExpression: SET format=:f, policyVersion=:pv, firstSeenAt=:now, lastSeenAt=:now, hitCount=:zero, firstDocumentId=:doc REMOVE expiresAt` — explicit field-by-field update. Same semantics as A.

C) `PutItem` without any condition — last-write-wins. Simpler but loses race-safety.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `PutItem` with `ConditionExpression` is the cleanest race-safe form — it atomically swaps the whole record. If a concurrent invocation already updated `policyVersion` to the current one, our conditional check fails (`conditional-check-failed`), the orchestrator retries the dedup-decision path, and the second pass goes through Case D (clean duplicate hit) instead. The alternative (B) is mostly equivalent but requires us to enumerate every attribute, which is fragile when the schema grows. Last-write-wins (C) creates a window where the record could be partially populated by two racing callers.

### Question 4 — `WorkspaceConfigStore.get` caching strategy
The orchestrator calls `WorkspaceConfigStore.get(workspaceId)` exactly once per invocation. Should the adapter add an in-process cache?

A) **No in-process cache for U-2** — the adapter is stateless; it issues one `GetItem` per call. The orchestrator (U-3) is responsible for calling once per invocation.

B) **Lazy per-process cache** — Lambda warm-start cache; first call hits DDB, subsequent calls within the same warm container return the cached value. Faster but invites staleness when policy changes.

C) **Short TTL (e.g., 60s) in-process cache** — middle ground. Adds complexity.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: U-2 is an adapter — it shouldn't decide caching policy. The orchestrator already calls `get` exactly once per invocation (per `services.md` STEP 2). Per-process caching (B) would silently mask the policy-version self-healing in FR-7.1 — a Lambda warm container could serve stale config for hours, defeating the whole point. If we ever need cache, the right place is at the orchestrator with explicit `policyVersion` invalidation, not at the adapter.

### Question 5 — Error mapping: AWS SDK errors → `StoreError` codes
DDB throws specific SDK errors (`ConditionalCheckFailedException`, `ProvisionedThroughputExceededException`, `ResourceNotFoundException`, transient network errors, `ThrottlingException`, etc.). Choose the mapping table:

A) **Explicit per-error mapping** — `ConditionalCheckFailedException → "conditional-check-failed"`, `ProvisionedThroughputExceededException | ThrottlingException | RequestLimitExceeded → "throttled"`, `ResourceNotFoundException → "unknown"` (alarm worthy), retryable-network-error → `"transient"`, anything else → `"unknown"`. AWS SDK v3 errors carry a `$metadata.errorCode` and `name` we can switch on.

B) Catch-all: anything → `"unknown"`. Simplest; loses retry signal.

C) Just throw — let the orchestrator handle SDK-specific errors. Breaks the Result-type contract.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The whole point of the `StoreError` discriminator is to give the orchestrator a typed handle for retry decisions (NFR-10's two-layer retry per Q9=C: SDK retries first, Step Function task retry second, `SendTaskFailure` last). The orchestrator decides differently on `throttled` (let the SDK retry layer absorb) vs `conditional-check-failed` (specific application path: re-read + decide) vs `unknown` (escalate). Catch-all (B) breaks this discrimination. Throwing (C) breaks the never-throw contract from BR-5 (the contract applies to domain code, but persistence adapters are the entry point to the AWS world and should still translate to typed errors).

### Question 6 — PBT properties for U-2 (PBT-01 mandatory)
Per PBT-01, every unit with business logic must enumerate testable properties during Functional Design. Confirm the proposed catalogue (much thinner than U-1 because the adapter logic is mostly thin glue):

A) **Accept the proposed 4-property catalogue below.**

B) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: U-2 is thin adapter glue — most behaviour is verified by integration tests against real (LocalStack) DDB. The 4 proposed PBT properties cover the algorithmic parts that exist outside the I/O surface (ISO timestamp formatting, deterministic record construction, hash-collision-impossibility assumption modelled as a property).

#### A.6.1 — Proposed PBT Property Catalogue for U-2

| ID | Module | Category | Property | PBT rule |
|---|---|---|---|---|
| PBT-U2-001 | `ContentHashRecord` factory (helper inside DDBContentHashAdapter) | Invariant | For any `(workspaceId, contentHash, format, policyVersion, documentId, now)`, the constructed record has `firstSeenAt === lastSeenAt === now`, `hitCount === 0`, immutable fields set | PBT-03 |
| PBT-U2-002 | TTL computation | Invariant | When `hashTtlDays` is `n`, `expiresAt` (unix seconds) equals `epochSeconds(firstSeenAt) + n*86400` (within ±1 s tolerance for date rounding) | PBT-03 |
| PBT-U2-003 | ISO-8601 serialisation | Round-trip | `parse(format(date)) === date` for any valid date passed to the helper | PBT-02 |
| PBT-U2-004 | Error code mapping | Totality | Every AWS SDK error type in the documented set maps to exactly one `StoreError` value (no SDK error is silently dropped) | PBT-03 |

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — Domain Entities
- [x] B1. Create `aidlc-docs/construction/persistence/functional-design/domain-entities.md`:
  - DDB record shapes for both tables (already documented in `requirements.md` §4.3 + §4.4; this restates with U-2 implementation details)
  - `ContentHashStore` + `WorkspaceConfigStore` port interfaces (referenced from `component-methods.md`)
  - `StoreError` discriminated union with full enumeration
  - `PutOutcome` enum (`"written" | "already-existed"`)
  - Helper types: `ContentHashRecordInit` (constructor input), `UpdateOnDuplicateHitInput`, `ReplaceOnPolicyMismatchInput`
  - Relationship diagram: how records flow through the dedup decision tree (Cases A/B/C/D from `services.md` STEP 12)

### Phase 2 — Business Logic Model
- [x] B2. Create `aidlc-docs/construction/persistence/functional-design/business-logic-model.md`:
  - **`DDBContentHashAdapter` per-method algorithm specifications**:
    - `get` — `GetItem` + null-check + record reconstruction
    - `putIfAbsent` — `PutItem` with `ConditionExpression: attribute_not_exists(contentHash)` (Q1=A)
    - `updateOnDuplicateHit` — `UpdateItem` with `SET lastSeenAt = :now ADD hitCount :one` + `ConditionExpression: attribute_exists(contentHash)` (Q2=B)
    - `replaceOnPolicyMismatch` — `PutItem` with `ConditionExpression: policyVersion = :stalePolicyVersion` (Q3=A)
  - **`DDBWorkspaceConfigAdapter` per-method**:
    - `get` — `GetItem` + Result.error("unknown") on missing record (alarm-worthy)
  - **Helper functions**:
    - `buildContentHashRecord(input)` — pure function building the record value
    - `computeExpiresAt(firstSeenAtIso, ttlDays)` — pure function
    - `mapDDBError(error)` — pure error mapping (Q5=A)
  - Pseudocode + flow diagrams per method

### Phase 3 — Business Rules
- [x] B3. Create `aidlc-docs/construction/persistence/functional-design/business-rules.md`:
  - **Universal rules** — adapter never throws; always returns `Result<T, StoreError>`; never logs sensitive data
  - **Workspace isolation rules** — every operation MUST scope by `workspaceId` (the partition key); never use scan operations
  - **Conditional write rules** — Q1, Q2, Q3 spec'd here with the exact AWS SDK v3 syntax
  - **Error mapping table** — Q5=A complete table
  - **TTL rules** — `expiresAt` computed only when `hashTtlDays` is set in workspace config
  - **PBT property catalogue** — the 4 properties from A.6.1
  - **NFR-4 enforcement** — all reads/writes use the partition key; integration tests verify cross-workspace isolation

### Phase 4 — Validation
- [x] B4. Verify every public method on `ContentHashStore` and `WorkspaceConfigStore` has an algorithm specification.
- [x] B5. Verify all 4 PBT properties map to a specific assertion in code.
- [x] B6. Verify Q1–Q5 answers are referenced in the business rules.

### Phase 5 — Wrap-up
- [x] B7. Update `aidlc-docs/aidlc-state.md` — U-2 Functional Design marked Completed.
- [x] B8. Update `aidlc-docs/audit.md`.
- [x] B9. Present the 2-option completion message ("🔧 Functional Design Complete - persistence").

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
