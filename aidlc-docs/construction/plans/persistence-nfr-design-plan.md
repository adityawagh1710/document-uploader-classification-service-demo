# NFR Design Plan — U-2 `persistence`

> Per-unit Construction stage 3/5. Translates U-2's NFR Requirements into concrete design patterns and logical components. U-2 inherits Patterns #1 (Result-type plumbing) and #5 (PBT pattern) from U-1; this stage adds adapter-specific patterns for DDB client lifecycle, LocalStack test setup, conditional-write race handling, and structured logging.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Design Questions

### Question 1 — DDB client lifecycle and sharing pattern
The AWS SDK v3 `DynamoDBClient` (and the `DynamoDBDocumentClient` wrapper) is a long-lived object holding HTTP connection pools. How should U-2 manage its lifecycle?

A) **Single shared client, constructed once at Lambda init**, injected into both adapters via factories. Survives across warm invocations; HTTP keep-alive amortises connection cost.

B) **One client per adapter** (`DDBContentHashAdapter` builds its own; same for `DDBWorkspaceConfigAdapter`) — clearer ownership but doubles the connection pool footprint.

C) **One client per invocation** — built and torn down each Lambda call. Most isolated; biggest cold-start cost; defeats SDK's connection-reuse design.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS SDK v3 clients are designed to be long-lived. Lambda warm-start reuse + HTTP keep-alive collapses sub-millisecond DDB calls from "single request" to "amortised across all warm-container invocations". A single shared client across both adapters is canonical; the wire endpoint and credentials are identical (only the table names differ). Option B doubles socket descriptors for zero benefit. Option C is actively harmful — each cold-start would re-establish TLS, blowing the latency budget.

### Question 2 — LocalStack global setup organisation
Integration tests need LocalStack started once per `vitest run` invocation. Where does the setup live?

A) **`tests/integration/_setup.ts`** as a Vitest `globalSetup` — starts container, creates tables, exposes the `ddb` client + endpoint via `globalThis.__LOCALSTACK__`. Cleanup in `teardown` stops the container.

B) **Per-file `beforeAll` hooks** — each test file starts its own container. Cleanest scoping; ~30s × N files.

C) **External Docker Compose file** managed outside Vitest — fastest startup (long-running container) but breaks self-contained `npm test`.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Vitest's `globalSetup` is the canonical hook for shared resources. One container per `vitest run` invocation matches the integration test pattern locked in NFR Requirements Q4=A. The container is exposed via `globalThis.__LOCALSTACK__` (typed) so any test can grab it without re-instantiation. Cleanup in `teardown` ensures CI runs don't leak Docker containers. Option B is what we explicitly rejected in NFR Requirements Q4. Option C breaks the "one-command CI" property and creates an out-of-band dependency.

### Question 3 — Integration test isolation strategy
Per-test `workspaceId` isolation was locked in NFR Requirements Q4=A. Choose the implementation pattern.

A) **`crypto.randomUUID()` per test inside a `beforeEach`** — strongest isolation; trivially deterministic-resistant (tests don't depend on UUID values).

B) **Sequential numeric IDs** (`test-1`, `test-2`, ...) — predictable; cleanup-friendly; risks reuse across re-runs without `PERSISTENCE=0` LocalStack flag.

C) **Test-name-based IDs** (e.g., `test-${expect.getState().currentTestName}`) — readable in error messages; collision risk if test names repeat across files.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `crypto.randomUUID()` is built into Node 20 (no extra dependency), produces collision-proof IDs by construction, and works with parallel test execution. LocalStack already runs with `PERSISTENCE=0` (per NFR Requirements §2.4), so re-runs start fresh anyway — but defensive UUID-per-test gives belt-and-braces protection if anyone disables that flag locally. Option B's numeric IDs are fragile under parallel-test execution (Vitest can run files concurrently); Option C risks collision when test names are duplicated (common with parameterised `it.each`).

### Question 4 — Adapter logging granularity
The `Logger` port is injected into every adapter. How much should the adapter log?

A) **Log every operation at `debug` level (op name + duration + outcome); errors at `error` level with structured context.** Tunable verbosity via Powertools' log level setting (set to `INFO` in production by default, `DEBUG` when investigating).

B) **Errors only** — quietest; loses observability for "everything's working" baseline.

C) **Log every operation at `info` level** — noisiest; CloudWatch costs add up.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Debug-level per-operation logging gives full observability when needed without polluting production CloudWatch by default. Lambda Powertools' Logger respects the `LOG_LEVEL` env var, so SRE can flip individual function instances to `DEBUG` for incident investigation without code changes. Error-level logs (the `error()` calls inside `mapDDBError` failures) always emit and carry structured context (workspaceId, op name, SDK error code) for correlation with CloudWatch alarms.

### Question 5 — Resilience pattern beyond SDK retries
NFR Requirements Q3=A locked SDK `standard` retry mode with `maxAttempts: 3`. Should U-2 add adapter-level resilience patterns (circuit breaker, custom timeouts, fallback responses)?

A) **No adapter-level resilience patterns** — rely on SDK retries + Step Function task retry (the two layers from Requirements Q9=C). Circuit breakers are inappropriate for a single-Lambda → DDB call path; there's no "rest of system" to protect from a downstream failure.

B) **Add per-call timeout** (e.g., 2-second hard cap on each DDB call) via `AbortSignal.timeout()`. Prevents a hung connection from consuming the entire 10-second Step Function task budget.

C) Both A and B.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: Both A and B together. (A) Circuit breaker is the wrong tool — we have a 1:1 Lambda→DDB call; there's no traffic to "break" away from. (B) But a hung connection (rare but possible — TCP fin_wait_2 timeout, network partition) would consume the whole task budget silently. A 2-second `AbortSignal.timeout()` on each DDB call upper-bounds the worst-case latency without adding complexity; the SDK + SFN retry layers handle the resulting `AbortError` like any other transient failure.

### Question 6 — Test colocation: where do unit/PBT tests live for U-2?
U-1 colocates unit tests under `tests/unit/<module>.test.ts` and PBT under `tests/pbt/<module>.test.ts`. Confirm for U-2 or override?

A) **Same as U-1**: unit tests in `tests/unit/persistence/{content-hashes,workspace-config,helpers}.test.ts`; PBT in `tests/pbt/persistence.test.ts`; integration tests in `tests/integration/persistence/*.test.ts`.

B) **Colocate next to source** (e.g., `src/adapters/dynamo-content-hashes/Adapter.test.ts`) — closer to code; many projects prefer this. Mixes test config with source config.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Consistency with U-1 wins. The `tests/` tree already has its own `tsconfig.json` and Vitest config; mixing source and tests under `src/` (option B) would require relaxing the `tsconfig.json` `include` and the ESLint boundary rules to permit test files in domain/adapter directories. The cost of cross-tree navigation is real but minor; the cost of duplicating the boundary infrastructure is larger.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Design Patterns
- [x] B1. Create `aidlc-docs/construction/persistence/nfr-design/nfr-design-patterns.md`:
  - **Pattern P-2-1: Single shared DDB client lifecycle** (Q1=A) — constructed at Lambda init, injected via factory; HTTP keep-alive amortises connection cost; survives across warm invocations
  - **Pattern P-2-2: LocalStack `globalSetup` for integration tests** (Q2=A) — Vitest hook lifecycle, table provisioning, exposure via `globalThis.__LOCALSTACK__`
  - **Pattern P-2-3: Per-test UUID workspaceId** (Q3=A) — `crypto.randomUUID()` in `beforeEach`; verifies NFR-4 isolation by construction
  - **Pattern P-2-4: Adapter logging granularity** (Q4=A) — debug per-op + error with structured context; Powertools `LOG_LEVEL` runtime control
  - **Pattern P-2-5: Per-call AbortSignal timeout** (Q5=C-B half) — 2s hard cap on each DDB call; AbortError joins the SDK retry path
  - **Pattern P-2-6: Conditional-write race handling** — `putIfAbsent` returns `Result.ok("already-existed")` (not error); `updateOnDuplicateHit`/`replaceOnPolicyMismatch` return `Result.error("conditional-check-failed")` for orchestrator-level re-read
  - **Pattern P-2-7: SDK error name pattern matching** — exhaustive switch on `error.name` discriminated by AWS SDK v3 conventions; default case returns `"unknown"`
  - Pattern summary table mapping each pattern to the NFR + enforcement mechanism

### Phase 2 — Logical Components
- [x] B2. Create `aidlc-docs/construction/persistence/nfr-design/logical-components.md`:
  - Source components: `DDBContentHashAdapter`, `DDBWorkspaceConfigAdapter`, plus the helper modules (`buildContentHashRecord`, `computeExpiresAt`, `mapDDBError`, `serialiseRecord`/`deserialiseRecord`, `isConditionalCheckFailed`) and the ports `ContentHashStore`, `WorkspaceConfigStore`
  - **Configuration components**: shared DDB client construction module (production + LocalStack variants)
  - **Test infrastructure components as first-class**: `tests/integration/_setup.ts` (LocalStack globalSetup), `tests/integration/persistence/*.test.ts` (integration test files), `tests/unit/persistence/*.test.ts`, `tests/pbt/persistence.test.ts`
  - **CI workflow components** (logical — materialised in U-4): integration-tests job with Docker support
  - Final NFR ↔ Component coverage matrix proving every applicable NFR/SECURITY/PBT for U-2 has a named component satisfying it

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-2 NFR Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
