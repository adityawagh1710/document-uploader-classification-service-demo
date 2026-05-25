# NFR Design Plan — U-1 `classifier-core`

> Per-unit Construction stage 3/5. Translates the NFR Requirements from `classifier-core-nfr-requirements-plan.md` into concrete design patterns and logical components for U-1. Since U-1 is pure-domain (no I/O, no AWS), "resilience" and "scalability" patterns reduce to a small set of disciplined coding/testing patterns; the bulk of this stage is about the **test harness components** that enforce the NFRs.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Design Questions

### Question 1 — Performance benchmark harness design
The 5 ms p99 budget needs a stable benchmarking pattern. How should the perf bench be structured?

A) **Vitest `bench` per algorithm + p99-over-N-iterations harness** — each algorithm has its own benchmark file; a custom harness runs each bench 200 iterations, captures p50/p99, compares against a committed `perf-baselines.json`, fails CI if p99 regresses > 10%.

B) **Custom benchmark runner outside Vitest** (e.g., `tinybench` directly) — more control over warmup/iteration count; one more tool in the chain.

C) **No per-algorithm bench; one end-to-end "full classifier chain" bench only** — simpler; loses signal on which algorithm regressed.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Vitest's `bench` is already part of the stack (Q20=A Application Design); using it keeps the test-runner footprint single-tool. Per-algorithm benches make regressions diagnostic — when CI says "perf regressed", we see exactly which tier or scorer step. The 200-iteration p99 with a committed baseline is the canonical pattern for catching real regressions while tolerating noise. A 10% tolerance window absorbs CI-runner jitter without admitting genuine slowdowns.

### Question 2 — PBT shrunk failure handling
When `fast-check` shrinks a PBT failure to a minimal counterexample, what happens to that counterexample?

A) **Automatic capture as regression fixture** — every shrunk failure is appended to `tests/regression/pbt-failures.json` and replayed as a fixed example-based test on every subsequent run. PBT-10 satisfaction baked into CI.

B) **Manual capture** — developer responsible for adding the shrunk example to an example-based test; relies on discipline.

C) **No capture; rely on PBT alone** — shrunk examples are logged but not preserved as regressions. Risks: same edge case re-discovered across runs.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: PBT-10 (complementary testing strategy) explicitly says: *"When a PBT discovers a failing case, the shrunk minimal example SHOULD be added as a permanent example-based regression test."* Option A makes this structural — a `fast-check` `errorHandler` (or Vitest `onError` hook) writes the shrunk input + property name to `pbt-failures.json`. A post-CI step opens a PR with the addition. Option B sounds fine but in practice developers forget; option C undermines PBT-10.

### Question 3 — Domain-specific generator organisation (PBT-07)
Where do `fast-check` generators (for valid CLSIDs, synthetic OLE2 buffers, synthetic ZIPs, RFC 5322-shaped buffers) live?

A) **One generator file per domain module** under `tests/pbt/generators/` (e.g., `clsid.gen.ts`, `ole2.gen.ts`, `zip.gen.ts`, `email.gen.ts`). Reusable across multiple property tests. Co-located with the tests.

B) **Single `tests/pbt/generators.ts` file** — everything in one place; risks growing into a thousand-line god-file.

C) **Generators embedded inline in each property test** — simplest start; duplication if multiple tests want the same generator.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: PBT-07 mandates *"Generator definitions are centralized and reusable where multiple tests share the same domain types."* Per-module files (A) hit that bar without becoming unmanageable. Each file owns the generators for one domain concept — CLSID generator for `tier2-ole2` tests, ZIP entry generator for `tier2-zip` tests, etc. New generators land alongside their concept rather than buried in a monolithic file. Conventionally `.gen.ts` suffix makes the import intent obvious.

### Question 4 — ESLint enforcement strictness (warn vs error)
The ESLint rule set from NFR Requirements (boundary rules, no-restricted-imports, no-restricted-globals, switch-exhaustiveness, no-throw-literal) — how strictly are violations gated in CI?

A) **All rules as `error` from day one** — any violation fails CI; no `warn` level allowed. Maximum signal-to-noise.

B) **Critical rules as `error`, hygiene rules as `warn` initially** — boundary rules + no-throw-literal + restricted-imports are `error`; unused-vars and others are `warn`. Lower friction during early development.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Greenfield project + clean slate = no excuse for warnings. The "warnings vs errors" debate matters when retrofitting lint into a legacy codebase; here we're writing the first lines of `src/domain/**` next. Starting with all rules as `error` prevents warning-rot (warnings that nobody fixes because they're not blocking). If a rule is too strict in practice we can demote individual rules with explicit `// eslint-disable-next-line <rule> -- <reason>` comments, which is a deliberate, reviewable action.

### Question 5 — Fixture organisation for example-based tests
Where do real binary fixtures (e.g., `.docx` renamed `.pdf` for AC-1, real `.msg`, real `.eml`) live, and how are they referenced?

A) **`tests/fixtures/<category>/<filename>` with typed manifest** — fixtures live as committed real bytes in `tests/fixtures/{ac-1-docx-renamed-pdf,ac-7-msg,ac-8-eml,...}/`. A `tests/fixtures/manifest.ts` exports a typed map `{ "ac-1": { path: "...", expectedFormat: "docx", expectedCategory: "convert", expectedSubCategory: "office" } }`. Tests reference the manifest, not raw paths.

B) **Flat `tests/fixtures/` directory + tests reference paths directly** — simpler; less typed safety.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The typed manifest pattern catches "test references a fixture path that no longer exists" at compile time. It also makes the expected-output mapping explicit in one file — when AC-1 changes (e.g., a new expected sub-category), the manifest update is colocated with the fixture itself. Required for U-1's PBT-U1-007 (Tier2ZIPDetector vs synthetic generators) where the manifest captures the synthetic-vs-real distinction. Flat directory (B) gets confusing fast once we have 11 AC fixtures + a dozen edge-case fixtures.

### Question 6 — Determinism / purity ESLint enforcement
We have `no-restricted-globals` on `Date.now` and `Math.random` in `src/domain/**`. Should we add anything else to structurally enforce purity?

A) **Add `eslint-plugin-functional` rules** for the domain layer: `no-let`, `prefer-readonly`, `no-this-expressions`, `no-loop-statements`. Strict functional-style enforcement. May feel heavy.

B) **Stick with what's already locked** (no-restricted-globals on Date/Math; no AWS SDK; no-throw-literal). Convention + code review handles the rest.

C) **Add only `prefer-const` and `no-var`** (already in standard config) plus `consistent-return`. Lightweight purity hints without going full FP.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: `eslint-plugin-functional` is great for some teams but it has high friction (forbidding `for` loops in a byte-buffer parser is counterproductive — they're the clearest way to walk an OLE2 directory entry). The existing rules (no-AWS-SDK, no-throw-literal, no-restricted-globals for Date/Math) plus the `switch-exhaustiveness-check` from NFR Requirements cover the practical purity concerns. The remaining purity discipline (no mutable module-level state, no side effects) is well-policed by code review on a domain layer this small. Plus the PBT determinism tests (PBT-U1-005, 006, 014) catch any actual non-determinism that slips through.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Design Patterns
- [x] B1. Create `aidlc-docs/construction/classifier-core/nfr-design/nfr-design-patterns.md`:
  - **Result-type plumbing pattern** — discriminated-union returns, no-throw rule, fail-safe-default mapping
  - **Discriminated-union exhaustiveness pattern** — `switch (x) { ... default: const _exhaustive: never = x; }` idiom for compile-time switch checking on `Tier1Result`, `Tier2OLE2Result`, `Tier3Result`, `MatchType`
  - **Pure-function determinism pattern** — explicit "deps in, value out" function shape; no module-level state; no top-level side effects
  - **Bounds-check pattern** — defense-in-depth for OLE2 (length check before offset arithmetic; arithmetic before lookup; lookup before fallback)
  - **PBT property pattern** — `fc.assert(fc.property(gen1, gen2, ..., predicate), { numRuns: N })` with seed logging
  - **Perf-bench pattern** — Vitest `bench` + per-algorithm baseline tracking + 10% regression tolerance
  - **Fixture manifest pattern** — typed `manifest.ts` with `{ id, path, expected }` records
  - **PBT shrink-capture pattern** — automatic regression fixture appendation (Q2=A)

### Phase 2 — Logical Components
- [x] B2. Create `aidlc-docs/construction/classifier-core/nfr-design/logical-components.md`:
  - For each U-1 source/test component: its NFR-role description, the design pattern it embodies, how it satisfies the NFRs from `nfr-requirements.md`
  - Specifically including the **test infrastructure** as logical components: `tests/pbt/generators/*`, `tests/perf/classifier-core.bench.ts`, `tests/fixtures/manifest.ts`, `tests/regression/pbt-failures.json` (the auto-captured shrunk-failure regression fixture)
  - ESLint rule blocks (the actual `.eslintrc.cjs` excerpt) — see Q4=A enforcement
  - tsconfig flag block (the actual JSON excerpt) — see NFR Requirements §2.6
  - Vitest config block (the actual `vitest.config.ts` excerpt) — see NFR Requirements §6

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-1 NFR Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message ("🎨 NFR Design Complete - classifier-core").

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
