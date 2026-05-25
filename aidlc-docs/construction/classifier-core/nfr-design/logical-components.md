# Logical Components — U-1 `classifier-core`

> Per-component NFR role + the pattern it embodies + how it satisfies each NFR. Includes **test infrastructure as first-class components** (perf bench, PBT generators, fixture manifest, regression file) — without them, the NFRs are unenforceable.

---

## 1. Source Components (under `src/`)

| Component | Hexagonal Layer | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|---|
| `Tier1FileTypeDetector` | domain | Wraps third-party oracle | Pure-function determinism (#3) | NFR-5, PBT-U1-004 |
| `OLE2Parser` | domain | Critical bytewise parser | Defense-in-depth bounds (#4); Result plumbing (#1) | NFR-3, NFR-5, SECURITY-11, SECURITY-15 |
| `Tier2OLE2Detector` | domain | Orchestrates OLE2 path | Result plumbing (#1); Exhaustive switch (#2) | NFR-5, SECURITY-15 |
| `ZIPMarkerParser` | domain | ZIP local header walker | Pure-function determinism (#3); Bounds checks (#4) | NFR-3, NFR-5 |
| `Tier2ZIPDetector` | domain | OOXML/ODF/plain disambiguation | Exhaustive switch (#2) | NFR-5, SECURITY-15 |
| `Tier3TextDetector` | domain | Text heuristic with priority order | Pure-function determinism (#3); Exhaustive switch on `format` (#2) | NFR-5, BR-T-8 |
| `Scorer` | domain | Arithmetic on `MatchType` + modifiers | Pure-function determinism (#3); Exhaustive switch on `MatchType` (#2) | NFR-5, NFR-6 (input-only config) |
| `CategoryMapper` | domain | Total function on detected formats | Result plumbing (`map` returns `null`, not throw) (#1) | NFR-5 |
| `SlipsheetDecider` | domain | Precedence-based decision | Pure-function determinism (#3); Exhaustive switch on `SlipsheetReason` (#2) | NFR-5, SECURITY-11 |
| `Result<T, E>` (in `shared/`) | shared | Discriminated-union plumbing | Result plumbing (#1) | NFR-5, SECURITY-15 |
| `clamp`, `readU16LE`, `readI32LE`, `decodeCLSID` (in `shared/byte-utils.ts`) | shared | Byte/numeric helpers used by parsers | Pure-function determinism (#3) | NFR-5 |

---

## 2. Test Infrastructure Components (under `tests/`)

These are not deployment artefacts but they are **load-bearing for NFR enforcement** — without them, the perf budget and PBT properties are aspirational rather than gated.

### 2.1 `tests/pbt/generators/*.gen.ts` — Domain-specific PBT generators (Pattern #5, PBT-07)

| File | Generates | Used By |
|---|---|---|
| `tests/pbt/generators/clsid.gen.ts` | `validCLSIDGen` — `fc.Arbitrary<CLSID>` producing canonical uppercase-dashed CLSIDs | PBT-U1-001, 002, 003 |
| `tests/pbt/generators/ole2.gen.ts` | `ole2BufferWithCLSIDGen` — synthesises 4 KB OLE2 buffers with embedded CLSIDs at valid offsets; `nonStandardSectorSizeOLE2Gen`; `directoryBeyondWindowOLE2Gen` | PBT-U1-001..003, 006 |
| `tests/pbt/generators/zip.gen.ts` | `ooxmlZipGen`, `odfZipGen`, `plainZipGen` — synthesises valid local file headers with the marker entries the spec requires | PBT-U1-007, 008 |
| `tests/pbt/generators/text.gen.ts` | `xmlTextGen`, `htmlTextGen`, `emlTextGen` (with ≥ 2 of the 13 RFC 5322 headers), `csvTextGen`, `binaryByteAtIndexGen` | PBT-U1-009, 010 |
| `tests/pbt/generators/scoring.gen.ts` | `scoringInputGen` with constrained ranges | PBT-U1-011..014 |

### 2.2 `tests/perf/classifier-core.bench.ts` — Perf benchmark suite (Pattern #6)

- One `bench` per algorithm: Tier1 detect, OLE2 parseCLSID (valid + each error path), ZIP marker scan, Tier3 text detect (each priority), Scorer.score, CategoryMapper.map, SlipsheetDecider.decide
- Plus one **full-chain** bench: `runClassifyDomainPipeline(docxBuffer)` exercising Tier 1 miss → Tier 2 ZIP hit → Score → Map → Decide
- Each bench has its own p99 sub-budget; the full-chain bench has the 5 ms p99 top-budget from NFR Requirements Q1=A

### 2.3 `tests/perf/perf-baselines.json` — Committed perf baseline (Pattern #6)

- JSON file with `{ name → { p50_ms, p99_ms } }` for every bench above
- Read by the test harness; CI fails if observed p99 exceeds `baseline_p99 * 1.10`
- Updated only via explicit `npm run bench -- --update-baseline` (deliberate PR)

### 2.4 `tests/perf/perf-harness.ts` — Helper used by every bench (Pattern #6)

- `readBaseline(unitName)`, `assertWithinTolerance({ name, p99Budget, regressionTolerance, baseline })`
- Centralises the perf-gate logic; benches just declare their constraints

### 2.5 `tests/fixtures/manifest.ts` — Typed fixture registry (Pattern #7)

- `as const satisfies Record<string, FixtureSpec>` for compile-time safety
- Maps each fixture ID (e.g., `"ac-1-docx-renamed-pdf"`) to `{ path, expectedFormat, expectedCategory, expectedSubCategory, expectedDetectionTier, expectsExtensionContradictionModifier }`
- Used by both U-1 unit tests AND U-3 integration tests — single source of truth for fixture metadata

### 2.6 `tests/fixtures/*/` — Real binary fixtures (Q5=A, Q22 Requirements)

| Fixture ID | Files | Purpose |
|---|---|---|
| `ac-1-docx-renamed-pdf` | `document.pdf` (a real `.docx` byte-stream renamed) | AC-1 |
| `ac-2-ole2-nonstandard-sector` | `weird.doc` | AC-2 |
| `ac-7-msg` | `sample.msg` | AC-7 |
| `ac-8-eml` | `sample.eml` | AC-8 |
| `edge-zip-content-types-not-first` | `unusual.zip` | edge case #4 |
| `edge-text-with-esc-byte` | `text-with-esc.txt` | edge case #5 |
| ...other ACs and edges | | AC-5/6/9/10/11 + further edges |

### 2.7 `tests/regression/pbt-failures.json` — Auto-captured PBT regressions (Pattern #8)

- Committed JSON; appended by `captureShrunkFailure` on any `fast-check` failure
- Replayed every CI run via `tests/regression/pbt-replays.test.ts`
- Per-PR CI step diffs `pbt-failures.json` against `main`; new entries require explanation

### 2.8 `tests/regression/pbt-replays.test.ts` — Replay harness (Pattern #8)

- Iterates `pbt-failures.json`; for each entry, looks up the original property by name and applies just the captured shrunk input
- Runs in the same test pass as unit tests (fast — no PBT generation needed)

---

## 3. Configuration Components

### 3.1 `tsconfig.json` (root)

Strict-plus flag set per NFR Requirements §2.6:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "esModuleInterop": true,
    "isolatedModules": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,

    "outDir": "dist",
    "sourceMap": true,
    "declaration": false,
    "skipLibCheck": true,

    "baseUrl": ".",
    "paths": {
      "@domain/*": ["src/domain/*"],
      "@ports/*":  ["src/ports/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "infra/**", "tests/**"]
}
```

### 3.2 `.eslintrc.cjs` (excerpt — U-1 relevant rules)

Per Q4=A all rules are `error`:

```javascript
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { project: "./tsconfig.json" },
  plugins: ["@typescript-eslint", "boundaries"],
  settings: {
    "boundaries/elements": [
      { type: "domain",        pattern: "src/domain/*" },
      { type: "ports",         pattern: "src/ports/*" },
      { type: "adapters",      pattern: "src/adapters/*" },
      { type: "application",   pattern: "src/application/*" },
      { type: "handler-entry", pattern: "src/handler/*" },
      { type: "shared",        pattern: "src/shared/*" },
    ],
  },
  rules: {
    "boundaries/element-types": ["error", {
      default: "disallow",
      rules: [
        { from: "domain", allow: ["domain", "shared"] },
        // ... per component-dependency.md §6
      ],
    }],
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "no-throw-literal": "error",
    "no-restricted-syntax": ["error", { selector: "ThrowStatement", message: "Domain code does not throw — return Result.error instead." }],
    "no-restricted-globals": ["error",
      { name: "Date",         message: "Domain code is pure (NFR-5). Pass timestamps as inputs." },
      { name: "performance",  message: "Domain code is pure (NFR-5)." },
    ],
    "no-restricted-properties": ["error",
      { object: "Date",   property: "now",    message: "NFR-5: pure domain code." },
      { object: "Math",   property: "random", message: "NFR-5: pure domain code." },
    ],
    "no-restricted-imports": ["error", {
      paths: [
        { name: "@aws-sdk/client-s3",       message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-dynamodb", message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-sfn",      message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-lambda-powertools/logger", message: "Use the Logger port." },
      ],
    }],
  },
  overrides: [
    // AWS SDK + restricted-syntax relaxed outside domain
    { files: ["src/adapters/**/*.ts", "src/handler/**/*.ts", "infra/**/*.ts", "tests/**/*.ts"],
      rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off", "no-restricted-properties": "off", "no-restricted-globals": "off" } },
  ],
};
```

### 3.3 `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/pbt/**/*.test.ts", "tests/regression/**/*.test.ts"],
    setupFiles: ["tests/pbt/_setup.ts"],   // wires the shrunk-failure capture (Pattern #8)
    coverage: {
      provider: "v8",
      include: ["src/domain/**"],
      reporter: ["text", "json", "html"],
      thresholds: {
        "src/domain/**":            { branches: 90, functions: 90, lines: 90, statements: 90 },
        "src/domain/tier2-ole2/**": { branches: 95, functions: 95, lines: 95, statements: 95 },
      },
    },
    benchmark: {
      include: ["tests/perf/**/*.bench.ts"],
      reporters: ["verbose"],
    },
  },
});
```

---

## 4. CI Workflow Components (logical — wired in U-4)

These are referenced here for completeness but materialised as GitHub Actions workflow files in U-4 Infrastructure Design:

| CI Job | Triggered on | Tool | Gate |
|---|---|---|---|
| `lint` | every PR + push | `eslint .` | Zero errors |
| `typecheck` | every PR + push | `tsc --noEmit` | Zero errors |
| `test-unit` | every PR + push | `vitest run tests/unit` | All pass |
| `test-pbt` | every PR + push | `vitest run tests/pbt tests/regression` | All pass; seed logged on failure |
| `coverage` | every PR + push | `vitest run --coverage` | ≥ 90% global, ≥ 95% on tier2-ole2 |
| `bench` | every PR touching `src/domain/**` | `vitest bench --run` | p99 ≤ baseline × 1.10 AND ≤ budget |
| `supply-chain-audit` | every PR + nightly | `npm audit --omit=dev --audit-level=high` | Zero high/critical |
| `pbt-regression-diff` | every PR | `git diff origin/main -- tests/regression/pbt-failures.json` | New entries require PR description note |

---

## 5. NFR ↔ Component Coverage Matrix

| NFR / SECURITY / PBT rule | Components that satisfy it |
|---|---|
| NFR-3 (4,100-byte window) | `OLE2Parser` (bounds-check gate 3), `ZIPMarkerParser` (truncation handling), every domain module receives `Uint8Array` and never assumes length |
| NFR-5 (determinism) | All `src/domain/**`; `tests/pbt/**` (PBT-U1-005, 006, 014); `.eslintrc.cjs` (no-restricted-globals); ESLint boundaries (no AWS SDK in domain) |
| NFR-6 (config-driven) | `Scorer`, `SlipsheetDecider` receive config as input; no hardcoded thresholds in domain code |
| 5 ms p99 budget | `tests/perf/classifier-core.bench.ts`, `tests/perf/perf-baselines.json`, `tests/perf/perf-harness.ts` |
| SECURITY-10 (supply chain) | `package-lock.json`, exact-pinned `file-type`, `npm audit` CI job, `npm sbom` |
| SECURITY-11 (secure design) | `OLE2Parser` defense-in-depth (Pattern #4); `SlipsheetDecider` precedence isolation; clear domain/adapter separation enforced by boundary lint |
| SECURITY-15 (fail-safe defaults) | Result-type plumbing (Pattern #1); ESLint `no-throw-literal`; exhaustive switches (Pattern #2) |
| PBT-01 | `business-rules.md` §10 (20-property catalogue) |
| PBT-02..05 | `tests/pbt/**/*.test.ts` files using Pattern #5 |
| PBT-07 | `tests/pbt/generators/*.gen.ts` files |
| PBT-08 | `fast-check` defaults; seed logging; `assertWithCapture` wrapper |
| PBT-09 | `fast-check` selection + `package.json` declaration |
| PBT-10 | Mixed test suite (Vitest example-based + `fast-check` PBT + regression replay); `pbt-failures.json` auto-capture |
