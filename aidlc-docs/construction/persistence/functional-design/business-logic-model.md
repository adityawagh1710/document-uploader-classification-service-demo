# Business Logic Model — U-2 `persistence`

> Per-method algorithm specifications for `DDBContentHashAdapter` and `DDBWorkspaceConfigAdapter`. Each method names the AWS SDK v3 command, the exact `ConditionExpression` / `UpdateExpression` strings, and the error-mapping path.

---

## 1. `DDBContentHashAdapter.get(input)`

**Purpose**: Read a content-hash record for a `(workspaceId, contentHash)` key.

**Algorithm**:

```
get({ workspaceId, contentHash }):

  command := new GetCommand({
    TableName: this.contentHashTableName,
    Key: { workspaceId, contentHash },
    ConsistentRead: false,    // eventually consistent — saves cost; dedup correctness is not strict-consistency-critical
  })

  try:
    response := await ddb.send(command)
    if response.Item == undefined:
      return Result.ok(null)
    return Result.ok(deserialiseRecord(response.Item))
  catch (e):
    return Result.error(mapDDBError(e))
```

**Notes**:
- Eventually consistent reads are fine because: (a) the conditional writes in `putIfAbsent` / `replaceOnPolicyMismatch` provide the strict-consistency guarantee for the *write* path; (b) a stale read on the *read* path at worst leads to a duplicate `putIfAbsent` attempt that fails with `conditional-check-failed` (handled by orchestrator as a re-read).
- `deserialiseRecord` is a pure helper validating the row shape matches `ContentHashRecord`.

---

## 2. `DDBContentHashAdapter.putIfAbsent(record)`

**Purpose**: First-time insert with a strict "row must not exist" guard (Q1=A).

**Algorithm**:

```
putIfAbsent(record):

  item := {
    workspaceId:        record.workspaceId,
    contentHash:        record.contentHash,
    firstSeenAt:        record.firstSeenAt,
    firstDocumentId:    record.firstDocumentId,
    format:             record.format,
    policyVersion:      record.policyVersion,
    lastSeenAt:         record.lastSeenAt,
    hitCount:           record.hitCount,
    ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {})
  }

  command := new PutCommand({
    TableName: this.contentHashTableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(contentHash)",
    ReturnValuesOnConditionCheckFailure: "ALL_OLD",
  })

  try:
    await ddb.send(command)
    return Result.ok("written")
  catch (e):
    if isConditionalCheckFailed(e):
      return Result.ok("already-existed")    // not an error — a race signal
    return Result.error(mapDDBError(e))
```

**Notes**:
- `ConditionExpression: attribute_not_exists(contentHash)` — canonical AWS form per Q1=A.
- `ReturnValuesOnConditionCheckFailure: "ALL_OLD"` is useful for diagnostic logging when races occur.
- "already-existed" returned as `Result.ok` (not `Result.error`) because it's an expected outcome, not a failure — the orchestrator handles it by re-reading.
- `expiresAt` field is included **only** when set (per `hashTtlDays === null` rule). DDB TTL silently ignores rows without the TTL attribute.

---

## 3. `DDBContentHashAdapter.updateOnDuplicateHit(input)`

**Purpose**: Atomic increment of `hitCount` + refresh of `lastSeenAt`, with fail-closed protection against vanished records (Q2=B).

**Algorithm**:

```
updateOnDuplicateHit({ workspaceId, contentHash, now }):

  command := new UpdateCommand({
    TableName: this.contentHashTableName,
    Key: { workspaceId, contentHash },
    UpdateExpression: "SET lastSeenAt = :now ADD hitCount :one",
    ConditionExpression: "attribute_exists(contentHash)",
    ExpressionAttributeValues: {
      ":now": now,
      ":one": 1,
    },
  })

  try:
    await ddb.send(command)
    return Result.ok(undefined)
  catch (e):
    return Result.error(mapDDBError(e))
```

**Notes**:
- `attribute_exists(contentHash)` is the fail-closed guard from Q2=B — if the record was deleted between the orchestrator's `get` and this `update`, the operation fails with `conditional-check-failed` rather than silently creating a partial row.
- `ADD hitCount :one` is atomic at the DDB level; no race possible between concurrent increments.
- The immutable fields (`format`, `firstSeenAt`, `firstDocumentId`, `policyVersion`) are not in the `UpdateExpression` — they remain untouched.

---

## 4. `DDBContentHashAdapter.replaceOnPolicyMismatch(input)`

**Purpose**: Atomic overwrite when `policyVersion` mismatches current workspace config, with race-safety against concurrent re-classifications (Q3=A).

**Algorithm**:

```
replaceOnPolicyMismatch({ record, expectedStalePolicyVersion }):

  item := serialiseRecord(record)   // same shape as putIfAbsent

  command := new PutCommand({
    TableName: this.contentHashTableName,
    Item: item,
    ConditionExpression: "policyVersion = :stalePolicyVersion",
    ExpressionAttributeValues: { ":stalePolicyVersion": expectedStalePolicyVersion },
  })

  try:
    await ddb.send(command)
    return Result.ok(undefined)
  catch (e):
    return Result.error(mapDDBError(e))
```

**Notes**:
- `ConditionExpression: policyVersion = :stalePolicyVersion` — only overwrite if the row's current `policyVersion` is the one the orchestrator saw when it decided to re-classify.
- If a concurrent invocation already overwrote the row (with a newer `policyVersion`), our condition fails (`conditional-check-failed`) and the orchestrator re-reads + re-decides (which lands on Case D — clean duplicate hit — and short-circuits).
- The new record fully replaces the old one: `firstSeenAt` resets to `now`, `hitCount` resets to 0, immutability fields take new values from the re-classification result.

---

## 5. `DDBWorkspaceConfigAdapter.get(workspaceId)`

**Purpose**: Read workspace config; missing record is `not-found` (alarm-worthy).

**Algorithm**:

```
get(workspaceId):

  command := new GetCommand({
    TableName: this.workspaceConfigTableName,
    Key: { workspaceId },
    ConsistentRead: true,    // strong consistency on policy reads — avoids racing with policy updates
  })

  try:
    response := await ddb.send(command)
    if response.Item == undefined:
      return Result.error("not-found")
    return Result.ok(deserialiseConfig(response.Item))
  catch (e):
    return Result.error(mapDDBError(e))
```

**Notes**:
- `ConsistentRead: true` here because policy reads are infrequent (once per Lambda invocation) and the orchestrator's policy-version self-healing relies on seeing the canonical current value.
- `not-found` is treated as `Result.error` (not `Result.ok(null)`) because every invocation MUST have a valid workspace config — a missing config means the workspace hasn't been provisioned and the invocation cannot proceed.

---

## 6. Helper Functions

### 6.1 `buildContentHashRecord(input: ContentHashRecordInit): ContentHashRecord`

**Purpose**: Pure factory building a brand-new record (used by orchestrator before calling `putIfAbsent`).

```
buildContentHashRecord({ workspaceId, contentHash, format, policyVersion, firstDocumentId, now, hashTtlDays }):

  base := {
    workspaceId,
    contentHash,
    firstSeenAt:     now,
    firstDocumentId,
    format,
    policyVersion,
    lastSeenAt:      now,
    hitCount:        0,
  }

  if hashTtlDays != null:
    return { ...base, expiresAt: computeExpiresAt(now, hashTtlDays) }

  return base
```

**Property** (PBT-U2-001): for any valid input, `firstSeenAt === lastSeenAt === now`, `hitCount === 0`, immutable fields set to inputs.

### 6.2 `computeExpiresAt(firstSeenAtIso: string, ttlDays: number): number`

**Purpose**: Pure conversion `(ISO timestamp, days) → unix seconds`.

```
computeExpiresAt(firstSeenAtIso, ttlDays):
  epochMs := Date.parse(firstSeenAtIso)
  if isNaN(epochMs): throw RangeError    // never expected — orchestrator passes valid ISO
  return Math.floor(epochMs / 1000) + ttlDays * 86400
```

**Property** (PBT-U2-002): `expiresAt === Math.floor(epochSeconds(firstSeenAtIso)) + ttlDays * 86400` (±1s tolerance for sub-second rounding).

**Note on `throw`**: This is a helper called only from inside the adapter's already-typed entry points. The orchestrator passes ISO strings it constructed itself, so this is a "should never happen" branch. The adapter's caller path catches and maps to `StoreError`.

### 6.3 `serialiseRecord(record: ContentHashRecord): Record<string, unknown>` and `deserialiseRecord(item: Record<string, unknown>): ContentHashRecord`

**Purpose**: Type-safe pivots between the typed record and DDB's `Record<string, unknown>`. Round-trippable.

**Property** (PBT-U2-003): `deserialiseRecord(serialiseRecord(record)) === record` for any valid `ContentHashRecord`. ISO date strings are passed through verbatim (no re-formatting).

### 6.4 `mapDDBError(error: unknown): StoreError`

**Purpose**: Pure pattern-match from AWS SDK v3 error shapes to `StoreError`.

```
mapDDBError(error):
  if !(error is Error): return "unknown"
  name := (error as any).name ?? ""

  switch name:
    case "ConditionalCheckFailedException":     return "conditional-check-failed"
    case "ProvisionedThroughputExceededException":
    case "ThrottlingException":
    case "RequestLimitExceeded":                 return "throttled"
    case "ResourceNotFoundException":            return "unknown"   // table missing — infra issue
    case "InternalServerError":
    case "ServiceUnavailable":                   return "transient"
    default:
      // network errors don't have an SDK error name; check code/message
      if isRetryableNetworkError(error):         return "transient"
      return "unknown"
```

**Property** (PBT-U2-004): for every documented SDK error name, `mapDDBError` returns a non-`"unknown"` value (the function is total on documented inputs).

### 6.5 `isConditionalCheckFailed(error: unknown): boolean`

Helper to distinguish "row already existed" (Result.ok) from genuine errors (Result.error) inside `putIfAbsent`.

```
isConditionalCheckFailed(error):
  return error instanceof Error && (error as any).name === "ConditionalCheckFailedException"
```

---

## 7. Method Composition Diagram

```
Orchestrator (U-3)
       │
       │ owns: ContentHashStore interface + WorkspaceConfigStore interface
       │       (defined by U-2 in src/ports/)
       ▼
+----------------------------------+
| ContentHashStore (port)          |
|   .get                           |
|   .putIfAbsent                   |
|   .updateOnDuplicateHit          |
|   .replaceOnPolicyMismatch       |
+--------------+-------------------+
               │ implemented by
               ▼
+----------------------------------+
| DDBContentHashAdapter            |  ──► AWS SDK v3 DynamoDBDocumentClient
|   (uses: buildContentHashRecord, |       │
|          computeExpiresAt,        |       └──► PutCommand, UpdateCommand, GetCommand
|          serialiseRecord,         |
|          deserialiseRecord,       |
|          mapDDBError)             |
+----------------------------------+

+----------------------------------+
| WorkspaceConfigStore (port)      |
|   .get                           |
+--------------+-------------------+
               │ implemented by
               ▼
+----------------------------------+
| DDBWorkspaceConfigAdapter        |  ──► AWS SDK v3 DynamoDBDocumentClient
|   (uses: deserialiseConfig,       |       │
|          mapDDBError)             |       └──► GetCommand
+----------------------------------+
```

All arrows are synchronous async calls. The adapter never logs sensitive data (per SECURITY-03) — it only logs structural metadata (operation name, workspace ID, error code) via the injected `Logger`.
