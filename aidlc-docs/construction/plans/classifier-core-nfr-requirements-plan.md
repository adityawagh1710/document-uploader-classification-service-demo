# NFR Requirements Plan — U-1 `classifier-core`

> Per-unit Construction stage 2/5. Asks NFR-specific questions for the pure-domain unit and pins down the tech-stack choices that haven't already been locked at the service level (TypeScript, Vitest, `fast-check`, etc. — confirmed in Application Design Q4/Q6/Q18/Q20).
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Requirements Questions

### Question 1 — Latency budget for the U-1 call chain (single classification)
The U-1 call chain runs entirely on a 4,100-byte buffer in memory: Tier1 → (Tier2 OLE2 or ZIP) → Tier3 → Scorer → CategoryMapper → SlipsheetDecider. What's the **p99 latency budget** for this chain end-to-end (excluding S3 I/O and SHA-256 hashing, which belong to U-3)?

A) **≤ 5 ms p99** — strict; forces tight tier implementations; surfaces accidental quadratic algorithms early. Achievable given pure logic on a 4 KB buffer with no I/O.

B) **≤ 20 ms p99** — comfortable; tolerates a tier or two with bigger constant factors.

C) **No explicit budget** — measure, don't pre-commit; let Build and Test set baselines from observed numbers.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Tight budgets surface bugs early. 5 ms p99 is generous for pure logic on a 4 KB buffer (file-type lib alone clocks <1 ms; CLSID parsing is ~tens of microseconds; text heuristic is dominated by a single linear scan). Setting it tight now creates a forcing function in PBT runs ("did this property test slow down? something changed in the algorithm"). The budget can be loosened if benchmarks reveal a legitimate cause; it's much harder to tighten retroactively. Locked-in budget = explicit perf regression test in CI.

### Question 2 — `file-type` library version pinning
The `file-type` JavaScript library is U-1's only runtime dependency. Pinning strategy?

A) **Exact pin** (`"file-type": "21.0.0"`) — reproducible builds; manual updates only.

B) **Caret pin** (`"file-type": "^21.0.0"`) — auto-upgrade within major; risk: a minor bump can change tier-1 results.

C) **Tilde pin** (`"file-type": "~21.0.0"`) — patch-only auto-upgrade; small risk surface.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Tier 1 is **the oracle** for PBT-U1-004 — when the library upgrades, the oracle changes, and every test snapshot that depended on tier-1 results needs re-evaluation. Exact pinning forces a deliberate upgrade decision (with a corresponding test-snapshot review). Caret (B) gives invisible upgrades during `npm install` that can silently re-classify documents in production. Tilde (C) is safer than caret but still admits patch-level magic-byte additions in the library. Lockfile (`package-lock.json`) already provides install-time reproducibility, but exact pinning makes the intent visible in `package.json` itself. Aligns with SECURITY-10 (supply-chain pinning).

### Question 3 — Property test runs per property (`fast-check` `numRuns`)
`fast-check`'s default is 100 runs per property. For a security-critical mixed-endian byte parser, is 100 enough?

A) **100 runs** (library default) — fast; adequate for most properties; PBT shrinking still narrows failures to minimal cases.

B) **500 runs** — better coverage for byte-level properties; CI cost ~5× the time on PBT.

C) **Tiered: 100 runs for "regular" properties, 1,000 runs for byte-level / mixed-endian properties** (PBT-U1-001..003, PBT-U1-008..010). Highest confidence on the high-risk code.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: Most U-1 properties (range, monotonicity, determinism) are mathematically straightforward and 100 runs is enough; `fast-check`'s smart-shrinking still finds counterexamples efficiently. But the mixed-endian CLSID round-trip (PBT-U1-001) and the OLE2 bounds invariants (PBT-U1-002, 003) are *exactly* the code where a 1-in-10,000 input pattern would otherwise slip through. Tiered runs give us 1,000-run coverage on those without paying the cost across the whole suite. Concrete: `fc.assert(prop, { numRuns: 1000 })` annotated per property; default 100 elsewhere.

### Question 4 — TypeScript strict flags beyond `strict: true`
Application Design Q18=A locked in TypeScript strict mode. Should U-1 enable additional strict flags?

A) **Enable the full strict-plus set**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`. Catches whole classes of bytewise + discriminated-union bugs at compile time.

B) **Default strict only** (`strict: true`); leave individual flags off. Less friction; more runtime risks.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `noUncheckedIndexedAccess` is *especially* valuable for byte-buffer code — `buffer[30]` would otherwise type as `number` and silently `undefined` at runtime; the strict flag forces an explicit length check. `exactOptionalPropertyTypes` matches our discriminated-union style (Tier1Result, Tier2OLE2Result, etc.) where `{ matched: true; ext: string }` and `{ matched: false }` should never accidentally drift. `noFallthroughCasesInSwitch` catches the switch-on-`matchType` patterns we'll write in the Scorer. All four extra flags are cheap to enable now; retrofitting them later costs days.

### Question 5 — Coverage target gating
`requirements.md` §7 already pins 90% branch coverage on classifier-core. Confirm + enforcement style?

A) **90% branch coverage on `src/domain/**` + 95% branch coverage on `src/domain/tier2-ole2/**`** (the mixed-endian critical path). Vitest's coverage gate fails the build on regression.

B) 90% branch coverage globally on `src/domain/**`. Same threshold everywhere.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-directory thresholds let us hold the highest bar on the highest-risk code (OLE2 mixed-endian parsing). 95% on `tier2-ole2/**` is achievable (the algorithm has finite branches: signature check, sector size, sector ID negative, bounds, CLSID lookup hit/miss/fallback) and forces conscious test for every edge case. Option B treats all domain code as equal risk — it's not.

### Question 6 — Memory bound for detection
Should U-1 enforce a **no-allocation-beyond-input** invariant during detection (a test-side assertion that detection allocates < N kB beyond the 4,100-byte input buffer)?

A) **No explicit memory bound test** — the algorithms are simple; allocations are obviously small; performance budget (Q1) catches accidental quadratic memory.

B) **Soft memory bound** — Vitest test that uses `process.memoryUsage()` deltas; asserts < 50 KB heap growth per detect() call. Catches accidental large copies but is flaky in CI.

C) **Heap snapshot diff in CI** — full GC + snapshot before/after; assert no retained references > N bytes. Heaviest.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Memory is the wrong knob to tune for U-1. The buffer is 4,100 bytes; the algorithms read it linearly; no algorithm in U-1 stores derived state beyond ~hundreds of bytes (parsed CLSID, scanned ZIP entries). A perf budget (Q1=A) plus the existing GC catches anything truly pathological. Memory-delta tests (B) are notoriously flaky in CI due to test isolation noise. Heap snapshots (C) are overkill for a pure-logic unit. The handler unit (U-3) may add memory bounds later for the streaming SHA-256 path — that's where memory actually matters.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Requirements Doc
- [x] B1. Create `aidlc-docs/construction/classifier-core/nfr-requirements/nfr-requirements.md`:
  - Per-NFR-from-`requirements.md` applicability assessment for U-1 (which apply; which N/A for pure-domain unit)
  - Per-question outcome locked in (latency budget, coverage targets, memory bound, etc.)
  - SECURITY rule applicability for U-1
  - PBT extension compliance status for this stage (PBT-09 framework selection)
  - Quality gates added to CI (perf budget, coverage gate)

### Phase 2 — Tech Stack Decisions
- [x] B2. Create `aidlc-docs/construction/classifier-core/nfr-requirements/tech-stack-decisions.md`:
  - Confirmed tech choices already locked at service level (Node 20, TypeScript strict, Vitest, fast-check)
  - U-1-specific version pins (`file-type` exact pin; `fast-check` selection statement for PBT-09)
  - TypeScript compiler flag set (Q4=A)
  - Lint rules (ESLint + plugins)
  - Coverage tool (`c8` via Vitest)
  - PBT runs configuration (Q3=C tiered)
  - Build tool (esbuild via Vitest)
  - File layout reaffirmation (single package, Q8=A from Application Design)

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-1 NFR Requirements marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message ("📊 NFR Requirements Complete - classifier-core").

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
