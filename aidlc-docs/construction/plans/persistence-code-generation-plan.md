# Code Generation Plan — U-2 `persistence`

> Per-unit Construction stage 5/5. This plan is the source of truth for U-2's code generation. ~30 files: 2 ports + 2 adapters + 6 helpers + 1 shared client factory + 5 unit tests + 1 PBT file + 1 PBT generator + 1 integration setup + 2 integration tests + config updates + docs.

---

## 1. Unit Context

### 1.1 Stories Owned by U-2
- **US-WO-004** — Configure per-workspace TTL on `content-hashes`
- **US-DI-003** — Workspace isolation across tenants

Plus contributing to: US-PO-004, US-DI-002, US-WO-001..005, US-WO-005 (their final closure waits for U-3 integration tests).

### 1.2 Dependencies and Boundary
- Adds runtime deps: `@aws-sdk/client-dynamodb@3.654.0`, `@aws-sdk/lib-dynamodb@3.654.0`
- Adds dev deps: `testcontainers@^10.13.0`, `@types/node@^20.14.0`
- Imports from U-1: `Result<T,E>`, `ContentHashRecord`, `WorkspaceConfig` (in `src/shared/`), `Logger` port
- Exports new ports: `ContentHashStore`, `WorkspaceConfigStore` (consumed by U-3)

### 1.3 Expected Interfaces / Contracts
- `ContentHashStore` and `WorkspaceConfigStore` ports must exactly match the signatures in `application-design/component-methods.md` §P-04, §P-05
- `StoreError` discriminator: 5 variants as documented in `domain-entities.md`

### 1.4 Service Boundaries
- U-2 may import from `src/ports/`, `src/shared/`, AWS SDK v3, but NOT from `src/domain/`, `src/application/`, `src/handler/`
- Test code (`tests/`) may import from anywhere

---

## 2. Code Generation Steps

> Each step has a `[ ]` checkbox. Mark `[x]` immediately on completion. All paths relative to workspace root.

### Phase 1 — Project Configuration Updates

- [x] **Step 1.1** Update `package.json`: add `dependencies.@aws-sdk/client-dynamodb: "3.654.0"`, `dependencies.@aws-sdk/lib-dynamodb: "3.654.0"`, `devDependencies.testcontainers: "^10.13.0"`, `devDependencies.@types/node: "^20.14.0"`. Add `test:integration` script.
- [x] **Step 1.2** Update `vitest.config.ts`: add `globalSetup: ["./tests/integration/_setup.ts"]`, add `tests/integration/**/*.test.ts` to `include`, add `testTimeout: 30_000`, append U-2 coverage thresholds (80% on the two adapter directories).
- [x] **Step 1.3** Update `.eslintrc.cjs`: add `no-console: "error"` to the global rules so adapter logging goes through the `Logger` port.

### Phase 2 — Cross-cutting Ports

- [x] **Step 2.1** Create `src/ports/ContentHashStore.ts` — port interface + `StoreError` + `PutOutcome` types (per `domain-entities.md` §5).
- [x] **Step 2.2** Create `src/ports/WorkspaceConfigStore.ts` — port interface (shares `StoreError` from ContentHashStore module).

### Phase 3 — Shared DDB Client + Helpers (under `src/adapters/shared/`)

- [x] **Step 3.1** Create `src/adapters/shared/dynamo-client.ts` — `createDDBDocumentClient(config)` factory (production + LocalStack variants).
- [x] **Step 3.2** Create `src/adapters/shared/with-timeout.ts` — wraps DDB sends with `AbortSignal.timeout(2_000)` (Pattern P-2-5).
- [x] **Step 3.3** Create `src/adapters/shared/map-ddb-error.ts` — exhaustive switch on SDK error names → StoreError (Pattern P-2-7).
- [x] **Step 3.4** Create `src/adapters/shared/is-conditional-check-failed.ts` — discriminator helper.

### Phase 4 — Content-Hashes Helpers

- [x] **Step 4.1** Create `src/adapters/dynamo-content-hashes/helpers/build-record.ts` — pure `buildContentHashRecord(init)` factory (per `business-logic-model.md` §6.1).
- [x] **Step 4.2** Create `src/adapters/dynamo-content-hashes/helpers/compute-expires-at.ts` — `computeExpiresAt(firstSeenAtIso, ttlDays)` (per §6.2).
- [x] **Step 4.3** Create `src/adapters/dynamo-content-hashes/helpers/serialise-record.ts` — `serialiseRecord` + `deserialiseRecord` round-trip helpers (per §6.3).

### Phase 5 — Content-Hashes Adapter

- [x] **Step 5.1** Create `src/adapters/dynamo-content-hashes/types.ts` — local types `ContentHashRecordInit`, `UpdateOnDuplicateHitInput`, `ReplaceOnPolicyMismatchInput` (per `domain-entities.md` §6).
- [x] **Step 5.2** Create `src/adapters/dynamo-content-hashes/DDBContentHashAdapter.ts` — `createDDBContentHashAdapter(deps)` factory implementing all 4 methods (`get`, `putIfAbsent`, `updateOnDuplicateHit`, `replaceOnPolicyMismatch`) per `business-logic-model.md` §§1–4 + Patterns P-2-4/5/6.
- [x] **Step 5.3** Create `src/adapters/dynamo-content-hashes/index.ts` — barrel export.

### Phase 6 — Workspace-Config Adapter

- [x] **Step 6.1** Create `src/adapters/dynamo-workspace-config/DDBWorkspaceConfigAdapter.ts` — `createDDBWorkspaceConfigAdapter(deps)` factory implementing `get` with strong-consistency + `not-found` mapping (per `business-logic-model.md` §5).
- [x] **Step 6.2** Create `src/adapters/dynamo-workspace-config/index.ts` — barrel export.

### Phase 7 — Unit Tests (5 files)

- [x] **Step 7.1** Create `tests/unit/persistence/build-record.test.ts` — covers PBT-U2-001 example cases + edge cases (null hashTtlDays, positive ttl).
- [x] **Step 7.2** Create `tests/unit/persistence/compute-expires-at.test.ts` — covers PBT-U2-002 example cases + boundary days values.
- [x] **Step 7.3** Create `tests/unit/persistence/serialise-deserialise.test.ts` — covers PBT-U2-003 example cases + omitted optional `expiresAt`.
- [x] **Step 7.4** Create `tests/unit/persistence/map-ddb-error.test.ts` — covers every documented SDK error name + network error path + default-to-"unknown".
- [x] **Step 7.5** Create `tests/unit/persistence/is-conditional-check-failed.test.ts` — covers the discrimination.

### Phase 8 — PBT Tests (1 file + 1 generator)

- [x] **Step 8.1** Create `tests/pbt/generators/persistence.gen.ts` — generators for `ContentHashRecord`, ISO timestamps, AWS SDK error names.
- [x] **Step 8.2** Create `tests/pbt/persistence.test.ts` — implements PBT-U2-001 (record construction invariant), PBT-U2-002 (TTL arithmetic), PBT-U2-003 (serialise round-trip), PBT-U2-004 (mapDDBError totality).

### Phase 9 — Integration Test Setup + Tests

- [x] **Step 9.1** Create `tests/integration/_setup.ts` — Vitest `globalSetup` starting LocalStack with `testcontainers` (Pattern P-2-2); provisions both tables; exposes `globalThis.__LOCALSTACK__`.
- [x] **Step 9.2** Create `tests/integration/persistence/content-hashes.test.ts` — covers `putIfAbsent` happy + race; `updateOnDuplicateHit` happy + vanished-record; `replaceOnPolicyMismatch` happy + race; **NFR-4 cross-workspace isolation explicit test**; TTL behaviour (expiresAt present iff hashTtlDays !== null).
- [x] **Step 9.3** Create `tests/integration/persistence/workspace-config.test.ts` — covers `get` happy path; `get` on missing workspaceId → `Result.error("not-found")`; strongly-consistent read verification.

### Phase 10 — Documentation

- [x] **Step 10.1** Create `aidlc-docs/construction/persistence/code/code-summary.md` — file inventory + story completion + implementation deviations + handoff list for U-3 (who consumes U-2's ports).

---

## 3. Story Traceability

- US-WO-004 (per-workspace TTL): Steps 4.2 + 7.2 + 8.2 + 9.2 (integration test verifies expiresAt set iff hashTtlDays)
- US-DI-003 (workspace isolation): Step 9.2's "NFR-4 cross-workspace isolation explicit test" + the `ContentHashStore.get/putIfAbsent` partition-key scoping at every adapter method (Step 5.2)

---

## 4. Scope Estimate

- **~13 source files** under `src/` (2 ports, 4 shared helpers, 3 content-hashes helpers, 3 content-hashes adapter, 2 workspace-config adapter)
- **~9 test files** under `tests/` (5 unit, 1 PBT, 1 PBT generator, 1 integration setup, 2 integration test files)
- **~3 configuration updates** (package.json, vitest.config.ts, .eslintrc.cjs)
- **1 documentation file**
- **Total**: ~26 new/updated files

---

## 5. Approval Gate

After review, the user explicitly approves this plan. Then Part 2 executes Steps 1.1 through 10.1 in order, ticking checkboxes as it completes them.
