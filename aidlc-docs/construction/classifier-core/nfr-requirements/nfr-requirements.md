# NFR Requirements — U-1 `classifier-core`

> Per-NFR applicability assessment for the pure-domain unit, per-question outcomes from `classifier-core-nfr-requirements-plan.md`, and the CI quality gates locked in for this unit.

---

## 1. Per-NFR Applicability for U-1

For each NFR in `requirements.md` §3, this section states whether the NFR applies to U-1 and, if applicable, what it means concretely for this unit.

| NFR | Applies to U-1? | Concrete meaning for U-1 |
|---|---|---|
| NFR-1 (ranged GET ≤ 4,100 bytes) | Indirect | U-1 algorithms accept a `Uint8Array` of any length, but every algorithm in U-1 reads at most 4,100 bytes — verified via PBT-U1-002 (directory bounds) and the 4,100 constant in `business-rules.md` §2 |
| NFR-2 (streaming SHA-256, no full-file buffer) | N/A | Hashing is in U-3 (handler); U-1 does no hashing |
| NFR-3 (4,100-byte detection window fixed) | Yes | All U-1 algorithms treat the buffer as bounded; no algorithm assumes more than 4,100 bytes are available |
| NFR-4 (workspace isolation in DDB) | N/A | U-1 has no DDB access |
| NFR-5 (determinism per input tuple) | **Yes — core invariant** | Every U-1 algorithm is pure: no `Date.now()`, no `Math.random()`, no globals. Enforced by PBT-U1-005, 006, 014 (idempotence/determinism) |
| NFR-6 (config-driven thresholds) | Partial | U-1's `SlipsheetDecider` receives `threshold`, `maxZipDepth`, `quarantineMacros`, `slipsheetRules` as input parameters from the caller (U-3 reads them from `workspace-config`) — U-1 itself has zero hardcoded thresholds |
| NFR-7 (structured tier-by-tier logs) | N/A | Domain code does not log (per BR-3, hexagonal rule). Tier-level instrumentation happens in U-3 around U-1 calls |
| NFR-8 (CloudWatch metrics + X-Ray) | N/A | Same — observability lives in U-3 (handler) and U-4 (infrastructure) |
| NFR-9 (one invocation per task) | N/A | Lambda concurrency model is a U-3 concern |
| NFR-10 (per-workspace TTL) | N/A | TTL is a U-2 persistence + U-4 infrastructure concern |

**Summary**: U-1 is materially affected by NFR-3 (window bounds), NFR-5 (determinism), and the input side of NFR-6 (no hardcoded config). All other NFRs flow through U-1 *transparently* — they constrain how the orchestrator (U-3) calls U-1 but don't shape U-1's internals.

---

## 2. Locked NFR Decisions for U-1

### 2.1 Performance — Q1=A
**Budget**: ≤ 5 ms **p99** for the full U-1 call chain on a 4,100-byte buffer (Tier1 → Tier2 → Tier3 → Scorer → CategoryMapper → SlipsheetDecider), excluding S3 I/O and SHA-256 hashing.

**Why this is achievable**:
- `file-type` library benchmarks at < 1 ms on 4 KB inputs
- CLSID parsing: ~tens of microseconds (16 bytes of arithmetic)
- ZIP marker scan: < 1 ms (≤ 4 local headers, ≤ 100 bytes each)
- Text heuristic: dominated by a single linear scan of 4 KB
- Pure-arithmetic stages (`Scorer`, `CategoryMapper`, `SlipsheetDecider`): each < 100 μs

**Enforcement**: Vitest benchmark suite in `tests/perf/classifier-core.bench.ts` runs each algorithm 100×, records p50 and p99, and fails CI if p99 > 5 ms on the suite's reference machine spec. Baseline tracked in `perf-baselines.json`.

### 2.2 Determinism — derived from NFR-5
**Constraint**: No `Date.now()`, no `Math.random()`, no mutable module-level state in `src/domain/**`. Enforced by `no-restricted-globals` ESLint rule.

**Property tests**: PBT-U1-005 (Tier1 idempotence), PBT-U1-006 (Tier2OLE2 idempotence + determinism), PBT-U1-014 (Scorer determinism).

### 2.3 Coverage — Q5=A
**Global threshold (`src/domain/**`)**: 90% branch coverage.
**Critical-path threshold (`src/domain/tier2-ole2/**`)**: 95% branch coverage.

**Enforcement**: Vitest configured with `coverage.thresholdAutoUpdate: false` and explicit per-directory thresholds in `vitest.config.ts`. Build fails if either threshold drops.

### 2.4 Property-Based Testing Runs — Q3=C (tiered)
| Property tier | `numRuns` | Properties in tier |
|---|---|---|
| Byte-level / mixed-endian (high-risk) | **1,000** | PBT-U1-001, 002, 003, 008, 009, 010 |
| Regular (math/lookup/idempotence) | **100** (fast-check default) | PBT-U1-004..007, 011..020 |

Annotated per property via `fc.assert(prop, { numRuns: 1000 })`. Total PBT runtime estimate: ~2–3 s per full-suite run.

### 2.5 Memory — Q6=A
**No explicit memory test for U-1.** The perf budget (§2.1) is the proxy: any algorithm that accidentally allocates O(buffer²) will blow the latency budget long before it dents heap usage in a 4 KB-bounded world.

### 2.6 TypeScript Strictness — Q4=A
**Full strict-plus flag set** in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true
  }
}
```

`noUncheckedIndexedAccess` is the load-bearing one for buffer-indexing safety — it converts `buffer[i]` from `number` to `number | undefined`, forcing explicit length checks at the type level.

---

## 3. SECURITY Extension Compliance for U-1 (at this stage)

| Rule | Status for U-1 | Notes |
|---|---|---|
| SECURITY-01 (encryption) | N/A | No data persistence in U-1 |
| SECURITY-02 (network access logs) | N/A | No network surface |
| SECURITY-03 (app-level logging) | N/A | Domain code does not log; correlated logs emitted by U-3 around U-1 calls |
| SECURITY-04 (HTTP headers) | N/A | No HTTP surface |
| SECURITY-05 (input validation) | Indirect | U-1 accepts `Uint8Array` (already type-validated by U-3's Zod input validation). U-1's algorithms perform bounds checks (BR-O-1..5) but trust the buffer's type |
| SECURITY-06 (least-privilege IAM) | N/A | No AWS access in U-1 |
| SECURITY-07 (restrictive network) | N/A | No network surface |
| SECURITY-08 (app-level access control) | N/A | No request/auth surface in U-1 |
| SECURITY-09 (hardening) | Indirect | U-1's algorithms reject malformed input via Result.error — never crash, never expose stack traces (algorithms can't throw on adversarial input by design) |
| SECURITY-10 (supply chain) | **Yes** | Exact-pinned `file-type` (Q2=A); locked via `package-lock.json`; `npm audit` in CI before any U-1 PR merges |
| SECURITY-11 (secure design) | **Yes** | Security-critical logic isolated in `Tier2OLE2Detector` (bounds checks) and `SlipsheetDecider` (macro quarantine precedence). Defense-in-depth: bounds check + signature check + sector-size check before CLSID read — three independent gates |
| SECURITY-12 (auth/credentials) | N/A | No credentials in U-1 |
| SECURITY-13 (software integrity) | Indirect | The OLE2 parser never deserialises untrusted data into objects — it reads typed primitives only. No `JSON.parse(rawBytes)` or `eval` in U-1 |
| SECURITY-14 (alerting) | N/A | Alarms live in U-4 |
| SECURITY-15 (fail-safe defaults) | **Yes** | All U-1 algorithms specified to return `Result.error` or `matched: false` on unexpected conditions; **never throw** from domain code (BR-5). Enforced by ESLint `no-throw-literal` + explicit return-type contracts |

**Blocking findings for this stage**: None. All applicable rules are compliant.

---

## 4. PBT Extension Compliance for U-1 (at this stage)

| Rule | Status for U-1 | Notes |
|---|---|---|
| PBT-01 (property identification at functional design) | **Compliant** | 20 properties enumerated in `business-rules.md` §10 during Functional Design |
| PBT-02 (round-trip properties) | **Compliant — design** | PBT-U1-001 covers OLE2 CLSID round-trip |
| PBT-03 (invariant properties) | **Compliant — design** | PBT-U1-002..003, 008..012, 014..020 — 14 invariant properties |
| PBT-04 (idempotence properties) | **Compliant — design** | PBT-U1-005, 006, 013 — Tier1/Tier2 idempotence + Scorer commutativity |
| PBT-05 (oracle/reference) | **Compliant — design** | PBT-U1-004 (Tier1 vs file-type lib), PBT-U1-007 (Tier2ZIP vs synthetic generator) |
| PBT-06 (stateful PBT) | **N/A** | U-1 has no mutable state |
| PBT-07 (generator quality) | **Deferred to Code Generation** | Domain-specific generators (synthetic OLE2 buffers, synthetic ZIP buffers, valid CLSID byte sequences) created in Code Generation |
| PBT-08 (shrinking + reproducibility) | **Locked** | `fast-check` shrinking on by default; CI logs seed on every PBT run (per Q3=C tiered config) |
| PBT-09 (framework selection) | **Compliant** | `fast-check` selected — see `tech-stack-decisions.md` |
| PBT-10 (complementary testing) | **Locked — strategy** | Example-based unit tests (Vitest) alongside `fast-check` PBT; AC-1..AC-11 covered by example-based integration tests in U-3 (per `requirements.md` §7.1) |

**Blocking findings for this stage**: None.

---

## 5. CI Quality Gates for U-1

These gates must pass for any PR that touches `src/domain/**`:

| Gate | Tool | Threshold |
|---|---|---|
| Lint | ESLint + `eslint-plugin-boundaries` | Zero errors, zero warnings |
| Type check | `tsc --noEmit` | Zero errors with strict-plus flags |
| Unit tests | Vitest | All pass |
| PBT tests | Vitest + `fast-check` | All pass; seeds logged on every run |
| Branch coverage | Vitest + `c8` | ≥ 90% global on `src/domain/**`; ≥ 95% on `src/domain/tier2-ole2/**` |
| Perf benchmarks | Vitest bench | p99 ≤ 5 ms on the U-1 call chain |
| Supply chain | `npm audit --omit=dev` | Zero high or critical advisories |

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete `tsconfig.json` path layout (`paths` for boundaries) | NFR Design |
| Exact ESLint config blocks for the boundary plugin | NFR Design |
| Vitest config file with thresholds + benchmark suite wiring | NFR Design |
| Domain-specific generators for `fast-check` (PBT-07 satisfaction) | Code Generation |
| Choice of CI runner (GitHub Actions assumed; confirmed at U-4 stage) | Infrastructure Design (U-4) |
