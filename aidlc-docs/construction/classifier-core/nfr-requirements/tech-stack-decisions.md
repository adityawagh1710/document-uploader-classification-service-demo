# Tech Stack Decisions — U-1 `classifier-core`

> Versioned dependency manifest with rationale. Service-level decisions from Application Design + Requirements remain authoritative; this document captures U-1-specific version pins and configuration sets.

---

## 1. Service-Level Decisions Inherited by U-1

These were locked at the service level and apply to all units; restated here for traceability.

| Concern | Choice | Source |
|---|---|---|
| Runtime | Node.js 20.x LTS | Requirements Q7=A, Application Design |
| Language | TypeScript (strict mode) | Application Design Q18=A |
| Test framework | Vitest | Application Design Q20=A |
| PBT framework | `fast-check` | Application Design Q17=A + PBT-09 |
| Schema validation | Zod | Application Design Q4=A (used in U-3, not U-1) |
| Module-boundary enforcement | `eslint-plugin-boundaries` | Application Design Q10=A |
| Coverage tool | `c8` (via Vitest's coverage integration) | Application Design Q23=A |
| Project layout | Single `package.json` at root | Application Design Q8=A |

---

## 2. U-1 Runtime Dependencies (exact pins)

These dependencies appear in `package.json` `dependencies` (i.e., bundled into the deployed Lambda).

| Package | Version | Pin Strategy | Why this choice / version |
|---|---|---|---|
| `file-type` | `21.0.0` | **Exact** | Per Q2=A. The library is **the oracle** for Tier 1 detection (PBT-U1-004). Silent upgrades would re-classify documents. Major version 21 is the latest stable at planning time; the codebase will reference its public `fileTypeFromBuffer` API. Upgrades go through a deliberate PR that re-snapshots Tier-1 expected outputs. |

That's it. U-1 has exactly one runtime dependency — by design (per the hexagonal `domain` layer's import restrictions, no AWS SDK, no Powertools, no `aws-lambda` types).

---

## 3. U-1 Dev / Test Dependencies (caret pins)

These appear in `devDependencies` only.

| Package | Version | Pin Strategy | Rationale |
|---|---|---|---|
| `typescript` | `^5.4.0` | Caret | Strict-plus flags introduced in 5.x; caret accepts patch+minor for bug fixes |
| `vitest` | `^1.6.0` | Caret | Stable v1.x line; native ESM + TypeScript |
| `@vitest/coverage-v8` | `^1.6.0` | Caret | Match Vitest major |
| `fast-check` | `^3.19.0` | Caret | Stable v3.x; supports `numRuns`, `seed`, automatic shrinking |
| `eslint` | `^8.57.0` | Caret | Stable v8 line; v9 introduces breaking config-file changes (defer until tooling catches up) |
| `eslint-plugin-boundaries` | `^4.2.0` | Caret | Module-boundary enforcement (Application Design Q10=A) |
| `@typescript-eslint/parser` | `^7.0.0` | Caret | TypeScript-aware lint parsing |
| `@typescript-eslint/eslint-plugin` | `^7.0.0` | Caret | TypeScript-specific lint rules |

**Why caret on dev tools but exact on runtime**: Dev tool patch/minor upgrades change build behaviour (slight perf, slight bug fixes) but cannot change *runtime* output. Pinning dev tools exactly creates upgrade churn with no safety upside. Runtime deps that affect output (Tier-1 oracle) get exact pinning.

---

## 4. TypeScript Compiler Configuration

```json
// tsconfig.json (root)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "esModuleInterop": true,
    "isolatedModules": true,

    // Strict-plus per Q4=A
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,

    // Build artifacts
    "outDir": "dist",
    "sourceMap": true,
    "declaration": false,
    "skipLibCheck": true,

    // Path aliases (used by eslint-plugin-boundaries to recognise layers)
    "baseUrl": ".",
    "paths": {
      "@domain/*":  ["src/domain/*"],
      "@ports/*":   ["src/ports/*"],
      "@shared/*":  ["src/shared/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "infra/**", "tests/**"]
}
```

The `infra/` tree gets its own `infra/tsconfig.json` (CDK config) — separate compile unit, never sees `src/`.

The `tests/` tree gets its own `tests/tsconfig.json` extending the root, with `include` for `tests/**/*` and `paths` resolving back to `src/` for test imports.

---

## 5. ESLint Configuration (U-1 relevant portions)

Full ESLint config is service-wide (see `component-dependency.md` §6). The U-1-relevant rules are:

| Rule | Setting | Why |
|---|---|---|
| `boundaries/element-types` | `error` (domain → only `shared`) | Enforces hexagonal layer rule (Application Design Q1=A, Q10=A) |
| `no-restricted-imports` (AWS SDK) | `error` in `src/domain/**` | Blocks AWS SDK imports in domain (defense-in-depth beyond layer rule) |
| `no-restricted-globals` (`Date.now`, `Math.random`) | `error` in `src/domain/**` | Enforces determinism (NFR-5) |
| `no-throw-literal` | `error` | Enforces "domain code never throws" (BR-5) |
| `@typescript-eslint/consistent-type-imports` | `error` | Forces `import type` for type-only imports — cleaner tree-shaking |
| `@typescript-eslint/no-unused-vars` | `error` (allow `_` prefix) | Standard hygiene |
| `@typescript-eslint/switch-exhaustiveness-check` | `error` | Forces exhaustive switches on discriminated unions (Tier1Result, Tier2OLE2Result, etc.) |

---

## 6. Vitest Configuration

```typescript
// vitest.config.ts (U-1 relevant portions)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/pbt/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**"],
      thresholds: {
        // Global threshold for U-1
        "src/domain/**": { branches: 90, functions: 90, lines: 90, statements: 90 },
        // Critical-path threshold
        "src/domain/tier2-ole2/**": { branches: 95, functions: 95, lines: 95, statements: 95 },
      },
    },
    benchmark: {
      include: ["tests/perf/classifier-core.bench.ts"],
    },
  },
});
```

PBT runs are configured per-test using `fc.assert(prop, { numRuns: 1000 })` for the high-risk tier and default-100 elsewhere (Q3=C).

---

## 7. Package.json Excerpt (U-1 relevant scripts + deps)

```jsonc
{
  "name": "classification-service",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20.0.0" },

  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run tests/unit",
    "test:pbt": "vitest run tests/pbt",
    "test:coverage": "vitest run --coverage tests/unit tests/pbt",
    "bench": "vitest bench --run",
    "build": "tsc -p tsconfig.json"
  },

  "dependencies": {
    "file-type": "21.0.0"
  },

  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "fast-check": "^3.19.0",
    "eslint": "^8.57.0",
    "eslint-plugin-boundaries": "^4.2.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0"
  }
}
```

Other units (U-2, U-3, U-4) will add their own runtime deps (AWS SDK clients, Powertools, Zod, CDK libs) when their NFR Requirements + Code Generation stages execute.

---

## 8. Supply Chain Hygiene (SECURITY-10 satisfaction)

| Practice | Configuration |
|---|---|
| Lockfile committed | `package-lock.json` in version control |
| Exact pin on the oracle library | `file-type@21.0.0` |
| Vulnerability scan in CI | `npm audit --omit=dev --audit-level=high` (fails on high or critical) |
| No `latest` tags | Confirmed — every dep has a concrete version range |
| SBOM | Generated via `npm sbom` in CI; archived per release |
| Trusted registries only | npm public registry; no third-party private mirrors |

---

## 9. Confirmed PBT Framework Selection (PBT-09 satisfaction)

**Framework**: `fast-check` (TypeScript / JavaScript).
**Version**: `^3.19.0` (latest stable v3.x at planning).
**Capabilities verified against PBT-09 checklist**:
- Custom generators / strategies for domain types: ✅ (will define generators for `Uint8Array`-valued OLE2 buffers, valid CLSIDs, synthetic ZIPs in Code Generation)
- Automatic shrinking: ✅ (default; never disabled)
- Seed-based reproducibility: ✅ (`fc.assert(prop, { seed: N })`)
- Integration with Vitest: ✅ (`fast-check` integrates as regular Vitest tests; no special runner)

**Documented in tech stack** (this file). PBT-09 marked Compliant.

---

## 10. Decisions Deferred to Later Stages

| Item | Stage |
|---|---|
| `vitest.config.ts` final file (exact threshold + benchmark wiring) | NFR Design |
| `.eslintrc.cjs` final file (full boundary rules + restricted imports) | NFR Design |
| CI workflow (GitHub Actions assumed) | U-4 Infrastructure Design |
| Bundle tool for the Lambda deploy artifact (esbuild via CDK / SAM) | U-3 NFR Design |
| Pre-commit hook (Husky? lefthook?) | Code Generation (cross-cutting) |
