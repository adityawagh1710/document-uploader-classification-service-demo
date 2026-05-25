# NFR Requirements Plan — U-2 `persistence`

> Per-unit Construction stage 2/5. U-2 is a thin DynamoDB adapter unit — NFR scope is narrower than U-1 but covers DDB-specific concerns (latency, capacity mode, SDK retries, LocalStack patterns).
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Requirements Questions

### Question 1 — DynamoDB latency budgets (per adapter operation)
The adapter wraps 4 distinct DDB operations. Set p99 budgets per operation (measured at the adapter boundary; SDK + DDB included, but Lambda cold-start excluded).

A) **Strict per-operation budgets**: `get` ≤ 20 ms p99; `putIfAbsent` ≤ 30 ms p99 (conditional write costs more); `updateOnDuplicateHit` ≤ 30 ms p99; `replaceOnPolicyMismatch` ≤ 30 ms p99; `WorkspaceConfigStore.get` ≤ 20 ms p99.

B) **Single 50 ms p99 budget for all operations** — simpler; loses operation-specific signal.

C) **No explicit budgets** — measure first, set baselines in Build and Test.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: DDB's published p99 for single-item ops on a hot partition is ~10 ms; with SDK + network we should budget 2× that for safety. Per-operation budgets (A) catch regressions specific to one path (e.g., a future bug in the conditional-write retry loop blows only `putIfAbsent`). Single global budget (B) hides which operation regressed. Both budgets are well above LocalStack's typical sub-millisecond response so integration tests will pass; the budgets serve as production-environment regression detectors.

### Question 2 — DynamoDB capacity mode
Both `content-hashes` and `workspace-config` need a capacity mode at table creation time (U-4's CDK). Choose mode.

A) **On-demand (PAY_PER_REQUEST)** for both tables — auto-scales; no capacity planning; right for variable workloads. Higher per-request cost but zero cold-spinup penalty.

B) **Provisioned with auto-scaling** for both — lower steady-state cost; requires capacity planning; subject to scale-up latency on bursts.

C) **Hybrid** — on-demand for `content-hashes` (variable workload — depends on customer document volume); provisioned for `workspace-config` (read-mostly, low-traffic — predictable cost).

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Both tables fit DynamoDB's "use on-demand" guidance: variable workload that can spike during customer batch uploads, no clear baseline traffic floor, and we want zero scale-up latency on bursts (the document-ingestion pipeline does not want classification to queue behind a DDB scale-up event). The cost delta vs provisioned is small at our scale and entirely offset by not needing capacity planning. Option C's hybrid sounds appealing but introduces operational complexity (two billing modes, two scaling stories) for marginal savings on workspace-config.

### Question 3 — AWS SDK v3 retry mode + max attempts
The SDK v3 has 3 retry modes: `legacy`, `standard`, `adaptive`. Choose for U-2's clients.

A) **`standard` mode with `maxAttempts: 3`** — exponential backoff (50ms, 100ms, 200ms); proven default; matches Q9=C of Requirements.

B) **`adaptive` mode with `maxAttempts: 5`** — client-side rate limiting; smoother under throttling; ~3× slower worst-case retry budget. Better for high-throughput workloads.

C) **`standard` mode with `maxAttempts: 1` (no retries)** — relies entirely on Step Function task retry. Riskier for transient blips.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Standard mode with 3 attempts matches the two-layer retry chosen at the service level (Requirements Q9=C: SDK retries first, SFN task retry second). Adaptive (B) is great for sustained high-throughput workloads but our per-Lambda-invocation pattern (one classification = at most ~4 DDB calls) doesn't benefit from adaptive's client-side rate limiting. No-retry (C) leaks transient blips into SFN retries, which are heavier (full Lambda re-invocation including cold-start risk).

### Question 4 — LocalStack integration testing patterns
The integration test tier (per `requirements.md` §7) uses LocalStack via `testcontainers`. Choose the test setup pattern.

A) **One LocalStack container per test run** (shared across all integration tests via `beforeAll` global setup), with each test using a **unique workspaceId** to isolate from other tests. Maximum throughput.

B) **One LocalStack container per test file** — stronger isolation between files; ~10× slower since LocalStack startup is ~30s.

C) **One LocalStack container per test case** — strongest isolation; impractically slow.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: One container per run + workspaceId isolation gives both speed and correctness. Per-test `workspaceId` (e.g., `test-${uuid()}`) ensures no cross-test interference, which works because U-2's NFR-4 (workspace isolation) is the design guarantee being tested. Per-file containers (B) cost 30s startup per file × 5 files = 2.5 min of pure wait time, which makes the dev loop painful. Per-case (C) is absurd. The chosen pattern is also what `requirements.md` §7.1 already implies.

### Question 5 — Coverage targets for U-2
U-2 has less pure logic than U-1 — most behaviour lives in DDB calls verified by integration tests. Choose coverage targets.

A) **80% branch coverage on `src/adapters/dynamo-content-hashes/**` + `src/adapters/dynamo-workspace-config/**`** (lower than U-1's 90% because the bulk of execution paths are DDB-mocked SDK calls covered by integration tests, not unit branches). Pure helpers (`buildContentHashRecord`, `computeExpiresAt`, `mapDDBError`) covered to 95%.

B) Same 90% threshold as U-1 — uniform across all units.

C) 70% on adapter code + integration test counts as coverage.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Coverage thresholds should reflect what coverage instrumentation actually measures. Unit tests of `buildContentHashRecord`/`computeExpiresAt`/`mapDDBError` (pure functions) hit every branch — 95% is achievable. The adapter methods themselves are mostly "build command → send → translate error" — there are few real branches to cover, so chasing 90% on adapter code produces test-busywork (mocking every SDK error variant individually). 80% is the realistic gate; integration tests against LocalStack catch the meaningful production behaviour. Per-directory thresholds (matching the U-1 pattern from NFR Requirements Q5=A) keep the highest bar on the highest-value code.

### Question 6 — DynamoDB IAM scope (locked here for U-4 to implement)
U-2's runtime needs a specific IAM permission set. Document the exact actions and resource scope to be implemented by U-4 (SECURITY-06).

A) **Per-table, per-action least privilege**:
- On `content-hashes` table ARN: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`
- On `workspace-config` table ARN: `dynamodb:GetItem` only
- No `Resource: "*"`; no `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:BatchWriteItem`, `dynamodb:DeleteItem` — none are needed by U-2's contract.

B) Broader: `dynamodb:*` on both tables — simpler but violates SECURITY-06.

C) Per-table, all `dynamodb:*Item` actions on both tables — middle ground.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: SECURITY-06 mandates "specific actions" + "specific resource identifiers". Option A enumerates exactly the actions U-2 uses in its 4 methods (no scans, no queries, no batch ops per BR-2-WI-2 and the BR-2 universal rules). Adding `DeleteItem` would be wrong — U-2 has no delete capability by design (records expire via TTL, set by the table config in U-4). Option B fails SECURITY-06 trivially. Option C is between but admits actions U-2 never needs (DeleteItem in particular — keeping it out forces deletion to go through an explicit different role if/when needed).

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Requirements Doc
- [x] B1. Create `aidlc-docs/construction/persistence/nfr-requirements/nfr-requirements.md`:
  - Per-NFR applicability table for U-2 (which apply, which N/A)
  - Locked decisions (latency budgets from Q1, capacity mode from Q2, SDK retry mode from Q3, LocalStack pattern from Q4, coverage from Q5, IAM scope from Q6)
  - SECURITY rule applicability for U-2 (focus on SECURITY-01, 03, 06, 09, 10, 13, 15 — they all apply directly to a persistence adapter)
  - PBT extension compliance status (PBT-01 satisfied; PBT-02..05 deferred to Code Generation)
  - CI quality gates for U-2's specific surface

### Phase 2 — Tech Stack Decisions
- [x] B2. Create `aidlc-docs/construction/persistence/nfr-requirements/tech-stack-decisions.md`:
  - U-2's new runtime deps (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` — exact-pinned)
  - Confirmed inherited choices (TypeScript strict-plus, Vitest, fast-check from U-1)
  - LocalStack version pin + `testcontainers` integration
  - DDB client configuration (retry mode, maxAttempts, endpoint override for LocalStack)
  - Per-directory coverage thresholds added to `vitest.config.ts`
  - Updated `package.json` excerpt

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-2 NFR Requirements marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
