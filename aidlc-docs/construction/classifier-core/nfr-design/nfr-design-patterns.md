# NFR Design Patterns — U-1 `classifier-core`

> Eight design patterns that translate the U-1 NFR requirements into concrete coding/testing conventions. Each pattern names the NFR(s) it satisfies, shows the pattern with TypeScript-flavoured pseudocode, and notes how compliance is structurally enforced (ESLint, tsc, Vitest, CI).

---

## Pattern 1 — Result-type plumbing (no throws in domain)

**Satisfies**: NFR-5 (determinism — predictable control flow), SECURITY-15 (fail-safe defaults), BR-5 (no throws in domain)

**Pattern**:

```typescript
// shared/result.ts
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok  = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Usage in domain code:
function parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError> {
  if (buffer.length < 8 || buffer[0] !== 0xd0 /* … */) {
    return err("missing-ole2-signature");
  }
  // ...
  return ok(canonicalCLSID);
}

// At the caller (still in domain — Tier2OLE2Detector):
const result = parser.parseCLSID(buffer);
if (!result.ok) {
  // Type narrows; we know result.error is OLE2ParseError
  return fallbackResult(result.error);
}
const clsid = result.value;  // narrowed to CLSID
```

**Enforcement**:
- ESLint `no-throw-literal: error` in `src/domain/**`
- ESLint `no-restricted-syntax` for `ThrowStatement` in `src/domain/**`
- TypeScript discriminated-union narrowing — `result.value` is only accessible after `result.ok === true`

---

## Pattern 2 — Exhaustive switch on discriminated unions

**Satisfies**: SECURITY-15 (no unhandled cases), maintainability

**Pattern**:

```typescript
function categoryForMatchType(matchType: MatchType): Category {
  switch (matchType) {
    case "exact-unique-signature":     return /* … */;
    case "ole2-with-clsid":            return /* … */;
    case "zip-with-ooxml-or-odf":      return /* … */;
    case "ole2-or-zip-ext-fallback":   return /* … */;
    case "text-heuristic":             return /* … */;
    case "extension-only":             return /* … */;
    case "no-match":                   return /* … */;
    default: {
      // If a new MatchType is added without a case here, this line
      // is a compile error: "Argument of type 'X' is not assignable
      // to parameter of type 'never'."
      const _exhaustive: never = matchType;
      throw new Error(`unreachable: ${_exhaustive}`);  // satisfies TS
    }
  }
}
```

**Enforcement**:
- `@typescript-eslint/switch-exhaustiveness-check: error`
- The `const _: never = x` idiom is the canonical pattern
- The single `throw new Error("unreachable")` in domain code is permitted because it is genuinely unreachable — TypeScript proves it

---

## Pattern 3 — Pure-function determinism

**Satisfies**: NFR-5

**Pattern**:

```typescript
// Domain modules are exported as factory functions returning interfaces.
// No top-level state. No closures over mutable variables.
// All inputs explicit; all outputs returned.

export function createScorer(): Scorer {
  // No state here. Just return a frozen interface.
  return Object.freeze({
    score(input: ScoringInput): number {
      const base = BASE_SCORES[input.matchType];          // const lookup
      const ext  = extensionModifier(input);              // pure helper
      const ct   = contentTypeModifier(input);            // pure helper
      return clamp(base + ext + ct, 0, 1);
    },
  });
}
```

**Enforcement**:
- ESLint `no-restricted-globals`: `Date.now`, `Math.random`, `performance.now` all forbidden in `src/domain/**`
- ESLint `no-let` rule scoped to module top-level
- PBT determinism properties (PBT-U1-005, 006, 014) catch any slip
- No imports of `@aws-sdk/*` or I/O modules allowed by `boundaries` rule

---

## Pattern 4 — Defense-in-depth bounds checks (OLE2 specifically)

**Satisfies**: SECURITY-11 (secure design), SECURITY-15

**Pattern** — three independent gates before reading the CLSID:

```typescript
function parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError> {
  // GATE 1: length + signature
  if (buffer.length < 8) return err("missing-ole2-signature");
  if (!hasOLE2Signature(buffer)) return err("missing-ole2-signature");

  // GATE 2: sector size
  if (buffer.length < 32) return err("non-standard-sector-size");
  const sectorSize = readU16LE(buffer, 30);
  if (sectorSize !== 0x0009) return err("non-standard-sector-size");

  // GATE 3: directory bounds
  if (buffer.length < 52) return err("directory-beyond-window");
  const sectorId = readI32LE(buffer, 48);
  if (sectorId < 0) return err("directory-beyond-window");
  const dirOffset = 512 * (1 + sectorId);
  if (dirOffset + 128 > 4100) return err("directory-beyond-window");
  if (dirOffset + 128 > buffer.length) return err("directory-beyond-window");

  // Only now do we actually read the CLSID
  return ok(decodeCLSID(buffer.subarray(dirOffset + 80, dirOffset + 96)));
}
```

**Enforcement**:
- TypeScript `noUncheckedIndexedAccess: true` makes any `buffer[i]` access return `number | undefined`, forcing explicit length checks (which become the gate)
- PBT-U1-002, PBT-U1-003 verify that no adversarial buffer can bypass the gates
- 95% branch coverage on `src/domain/tier2-ole2/**` (NFR Requirements §2.3) forces tests for every gate's both-sides

---

## Pattern 5 — Property-Based Test (PBT) pattern

**Satisfies**: PBT-02..PBT-05, PBT-08, PBT-10

**Pattern**:

```typescript
import { describe, it } from "vitest";
import fc from "fast-check";
import { createOLE2Parser } from "@domain/tier2-ole2/parser";
import { validCLSIDGen, ole2BufferWithCLSIDGen } from "./generators/ole2.gen";

describe("OLE2Parser", () => {
  const parser = createOLE2Parser();

  it("PBT-U1-001 — round-trip: parseCLSID(encode(clsid)) === clsid", () => {
    fc.assert(
      fc.property(validCLSIDGen, (clsid) => {
        const buffer = ole2BufferWithCLSIDGen.synthesise({ clsid });
        const result = parser.parseCLSID(buffer);
        return result.ok && result.value === clsid;
      }),
      // High-risk byte-level property — 1000 runs per Q3=C of NFR Requirements
      { numRuns: 1000, seed: process.env.PBT_SEED ? Number(process.env.PBT_SEED) : undefined }
    );
  });
});
```

**Conventions**:
- Test name = `PBT-U1-XXX — <one-line summary>` so the PBT catalogue cross-references the test files
- High-risk properties (PBT-U1-001..003, 008..010): `numRuns: 1000`; rest: default 100
- Seeds are logged automatically by `fast-check` on failure; CI captures them via `--reporter=verbose`
- Property tests live in `tests/pbt/**/*.test.ts` (separate from example-based tests in `tests/unit/**`) per PBT-10

**Enforcement**:
- Vitest `coverage` includes both `tests/unit` and `tests/pbt` runs
- `fast-check` shrinking is on by default — never disabled in U-1
- See Pattern 8 below for shrunk-failure capture

---

## Pattern 6 — Perf bench harness with baseline tracking

**Satisfies**: NFR-1 + NFR-3 + the 5 ms p99 budget locked in NFR Requirements Q1=A

**Pattern**:

```typescript
// tests/perf/classifier-core.bench.ts
import { bench, describe, beforeAll } from "vitest";
import { readBaseline, assertWithinTolerance } from "./perf-harness";

describe("U-1 classifier-core perf", () => {
  let baseline: PerfBaseline;
  beforeAll(async () => { baseline = await readBaseline("classifier-core"); });

  bench("Tier1FileTypeDetector.detect (pdf 4KB)", () => {
    detector.detect(pdfBuffer4KB);
  }, {
    iterations: 200,
    setup: () => assertWithinTolerance({
      name: "tier1-detect-pdf",
      p99Budget: 1.0,       // ms — per-algorithm sub-budget
      regressionTolerance: 0.10,
      baseline,
    }),
  });

  bench("OLE2Parser.parseCLSID (valid doc CLSID)", () => {
    parser.parseCLSID(ole2DocBuffer);
  }, {
    iterations: 200,
    setup: () => assertWithinTolerance({
      name: "ole2-parse-clsid-valid",
      p99Budget: 0.1,       // ms
      regressionTolerance: 0.10,
      baseline,
    }),
  });

  bench("Full U-1 call chain (docx detection)", () => {
    runClassifyDomainPipeline(docxBuffer);
  }, {
    iterations: 200,
    setup: () => assertWithinTolerance({
      name: "full-chain-docx",
      p99Budget: 5.0,       // ms — top-level budget from NFR Req Q1=A
      regressionTolerance: 0.10,
      baseline,
    }),
  });
});
```

**Baseline file** (`tests/perf/perf-baselines.json`, committed):
```json
{
  "classifier-core": {
    "tier1-detect-pdf":         { "p50_ms": 0.4, "p99_ms": 0.8 },
    "ole2-parse-clsid-valid":   { "p50_ms": 0.05, "p99_ms": 0.09 },
    "full-chain-docx":          { "p50_ms": 2.1, "p99_ms": 3.6 }
  }
}
```

**Behaviours**:
- p99 measured over 200 iterations after a 20-iteration warmup (`tinybench` defaults are good enough)
- CI fails if `observed_p99 > baseline_p99 * 1.10` OR `observed_p99 > p99Budget` (whichever is stricter)
- Baselines update via a deliberate PR (`pnpm bench --update-baseline`) — not auto-updated in CI

**Enforcement**:
- The `setup` hook in each `bench` block is the assertion; if it throws, the bench fails
- CI runs `npm run bench` as a required check on PRs that touch `src/domain/**`

---

## Pattern 7 — Fixture manifest (typed)

**Satisfies**: maintainability + AC mapping clarity

**Pattern**:

```typescript
// tests/fixtures/manifest.ts
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = (p: string) => resolve(fileURLToPath(import.meta.url), "..", p);

export const fixtures = {
  "ac-1-docx-renamed-pdf": {
    path: here("ac-1-docx-renamed-pdf/document.pdf"),
    expectedFormat: "docx",
    expectedCategory: "convert",
    expectedSubCategory: "office",
    expectedDetectionTier: "zip-marker",
    // The −0.15 contradiction modifier should apply because the extension
    // ".pdf" does not match the detected format "docx".
    expectsExtensionContradictionModifier: true,
  },
  "ac-7-msg": {
    path: here("ac-7-msg/sample.msg"),
    expectedFormat: "msg",
    expectedCategory: "email",
    expectedSubCategory: null,
    expectedDetectionTier: "ole2-clsid",
    expectsExtensionContradictionModifier: false,
  },
  "ac-8-eml": {
    path: here("ac-8-eml/sample.eml"),
    expectedFormat: "eml",
    expectedCategory: "email",
    expectedSubCategory: null,
    expectedDetectionTier: "text-heuristic",
    expectsExtensionContradictionModifier: false,
  },
  // ... 8 more AC fixtures + edge-case fixtures
} as const satisfies Record<string, FixtureSpec>;

export type FixtureId = keyof typeof fixtures;
```

**Enforcement**:
- `as const satisfies` gives static type checking — typos in `expectedCategory` fail `tsc`
- Tests reference `fixtures["ac-1-docx-renamed-pdf"]` — refactor-safe
- A pre-commit hook validates that every `path` in the manifest exists on disk

---

## Pattern 8 — Auto-capture of PBT shrunk failures

**Satisfies**: PBT-10 (complementary testing — regression for every discovered failure)

**Pattern**:

```typescript
// tests/pbt/_setup.ts (Vitest globalSetup)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REGRESSION_PATH = resolve(__dirname, "../regression/pbt-failures.json");

export function captureShrunkFailure(propertyName: string, seed: number, shrunkInput: unknown) {
  const existing = existsSync(REGRESSION_PATH)
    ? JSON.parse(readFileSync(REGRESSION_PATH, "utf8"))
    : [];
  if (existing.some((r: any) => r.property === propertyName && JSON.stringify(r.input) === JSON.stringify(shrunkInput))) {
    return;  // already captured
  }
  existing.push({
    property: propertyName,
    seed,
    input: shrunkInput,
    capturedAt: new Date().toISOString(),
  });
  appendFileSync(REGRESSION_PATH, JSON.stringify(existing, null, 2));
}
```

A custom `fc.assert` wrapper (`assertWithCapture`) is used in U-1's PBT tests:

```typescript
function assertWithCapture<T>(
  property: fc.IPropertyWithHooks<T>,
  options: fc.Parameters<T> & { propertyName: string }
) {
  try {
    fc.assert(property, options);
  } catch (e) {
    if (e instanceof Error && "counterexample" in e) {
      const seed = (e as any).seed ?? 0;
      const shrunk = (e as any).counterexample;
      captureShrunkFailure(options.propertyName, seed, shrunk);
    }
    throw e;  // re-throw so the test still fails
  }
}
```

**Regression replay**:

```typescript
// tests/regression/pbt-replays.test.ts
import regressions from "./pbt-failures.json" with { type: "json" };

describe("PBT regressions (auto-captured)", () => {
  for (const r of regressions) {
    it(`${r.property} — captured ${r.capturedAt}`, () => {
      // Re-run the original property with just this shrunk input
      const propertyImpl = getPropertyByName(r.property);
      expect(propertyImpl(r.input)).toBe(true);
    });
  }
});
```

**Enforcement**:
- `pbt-failures.json` is committed to git
- The replay tests run alongside `tests/unit` — failures here mean a regression resurfaced
- Per-PR CI step compares `pbt-failures.json` against `main`; any new entry must be addressed in the same PR

---

## Pattern Summary Table

| # | Pattern | Satisfies | Enforcement mechanism |
|---|---|---|---|
| 1 | Result-type plumbing | NFR-5, SECURITY-15, BR-5 | ESLint `no-throw-literal` + tsc discriminated narrowing |
| 2 | Exhaustive switch | SECURITY-15, maintainability | `@typescript-eslint/switch-exhaustiveness-check` + `const _: never` idiom |
| 3 | Pure-function determinism | NFR-5 | ESLint `no-restricted-globals` + boundaries rule + PBT |
| 4 | Defense-in-depth bounds | SECURITY-11, SECURITY-15 | `noUncheckedIndexedAccess` + 95% branch coverage + PBT |
| 5 | PBT pattern | PBT-02..05, 08, 10 | `fast-check` + Vitest + numRuns tiering |
| 6 | Perf bench harness | NFR-1, NFR-3, 5 ms budget | Vitest `bench` + baseline JSON + CI gate |
| 7 | Fixture manifest | maintainability, AC traceability | `as const satisfies` + pre-commit path validator |
| 8 | PBT shrunk-failure capture | PBT-10 | Vitest globalSetup + committed `pbt-failures.json` + per-PR diff check |
