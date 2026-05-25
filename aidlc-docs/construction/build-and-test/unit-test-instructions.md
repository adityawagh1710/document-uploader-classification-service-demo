# Unit Test Execution

> Vitest + fast-check (PBT) unit suites across U-1, U-2, U-3 plus CDK stack tests for U-4. Excludes integration / smoke tests (separate docs).

---

## 1. Test Inventory

| Suite | Path | Count | Tool |
|---|---|---|---|
| U-1 classifier-core unit | `tests/unit/classifier-core/**` | ~46 spec files | Vitest |
| U-1 classifier-core PBT | `tests/pbt/classifier-core/**` | 20 properties | Vitest + fast-check |
| U-2 persistence unit | `tests/unit/persistence/**` | ~12 spec files | Vitest |
| U-2 persistence PBT | `tests/pbt/persistence/**` | 4 properties | Vitest + fast-check |
| U-3 handler unit | `tests/unit/handler/**` | 8 spec files | Vitest |
| U-3 handler PBT | `tests/pbt/handler/**` | 5 properties | Vitest + fast-check |
| U-4 infra config load | `infra/config/load.test.ts` | 8 cases | Vitest |
| U-4 stack tests | `infra/lib/*.test.ts` | 20 cases (6+8+6) | Vitest + aws-cdk-lib/assertions |
| Regression suite | `tests/regression/**` | growth-as-found | Vitest |

**Approximate total**: ~75 unit suites + 29 PBT properties + 28 CDK assertions.

---

## 2. Running the Unit Tests

### Run all unit tests (excluding integration/smoke)

```bash
npm run test:unit
```

Vitest configuration excludes `tests/integration` and `tests/smoke`. Expected runtime ≈ 30–60 s.

### Run PBT only

```bash
npm run test:pbt
```

Runs `tests/pbt/**` + `tests/regression/**`. Each property defaults to 100 runs; CI sets the seed via `FAST_CHECK_SEED` for reproducibility on failure.

### Run infrastructure tests (CDK + config)

```bash
npm run test:infra
```

Runs `infra/config/load.test.ts` + `infra/lib/*.test.ts` including snapshot assertions.

### Run a single suite (development workflow)

```bash
npx vitest run tests/unit/classifier-core/tier1-filetype.test.ts
npx vitest run infra/lib/data-stack.test.ts
```

### Watch mode (development)

```bash
npx vitest watch
```

### Update CDK snapshots after intentional infra changes

```bash
npx vitest run infra/lib --update
```

Then **inspect** the resulting `__snapshots__/*.snap` diff in your PR — unreviewed snapshot updates are a serious anti-pattern.

---

## 3. Expected Results

| Suite | Pass Criteria | Coverage Target |
|---|---|---|
| `test:unit` | 100% pass; 0 failures | ≥ 85 % lines in `src/domain/**`, ≥ 80 % in `src/adapters/**` |
| `test:pbt` | 100% pass; each property converges within default fast-check budget | Property coverage tracked separately |
| `test:infra` | 100% pass; CDK snapshots match | N/A — snapshot equality is the gate |

### Coverage

```bash
npm run test:coverage
```

Emits `coverage/lcov-report/index.html` + `coverage/lcov.info`. CI uploads to the configured coverage tool (or fails if thresholds drop).

Thresholds (`vitest.config.ts`):
- `lines: 85`, `functions: 85`, `branches: 80`, `statements: 85` for `src/**`
- No threshold for `infra/**` (snapshot-based; not line-coverage gated)

---

## 4. PBT Property Catalogue (Reference)

| Unit | Properties | Examples |
|---|---|---|
| U-1 (20) | Tier-1/2/3 detector invariants; scoring monotonicity; category determinism; slipsheet idempotence | `tier-priority-order-respected`, `score-is-monotonic-in-evidence`, `category-is-deterministic` |
| U-2 (4) | DDB key-shape stability; conditional-write idempotence; TTL clamp range; SSO error mapping | `key-shape-is-stable-across-roundtrip`, `conditional-failure-maps-to-domain-error` |
| U-3 (5) | Input validation invariants; output builder shape; failure → error code total mapping | `every-failure-has-error-code`, `input-validator-rejects-malformed-events` |
| U-4 (0) | N/A — declarative; covered by snapshot + targeted assertions | — |

---

## 5. Diagnosing Failures

### Vitest reports `FAIL src/...`

1. Re-run the specific suite: `npx vitest run <path>`
2. Read the assertion message + the source line referenced.
3. If a PBT property fails, fast-check prints the **shrunken minimal counter-example** + the seed. Re-run with that seed: `FAST_CHECK_SEED=<seed> npx vitest run <path>`.
4. If reproducible, add the counter-example as an explicit case in `tests/regression/` to prevent regression.

### CDK snapshot diff

1. Open the failing test's `__snapshots__/*.snap` diff.
2. **If the change is intended** (e.g. you added a CloudWatch alarm): regenerate snapshots (`vitest run infra/lib --update`) and commit the diff for PR review.
3. **If the change is unintended**: it indicates an accidental resource drift — fix the stack code.

### "Hanging" tests

- Most often caused by an open DDB DocumentClient socket. Make sure adapters use the shared client and tests use `afterAll` to release.
- For PBT: a property that doesn't terminate likely has an unbounded `arbitrary` — add a `chain` or `filter`.

---

## 6. Story Coverage Check

Every Construction-phase story has at least one unit test that exercises it. Spot-check by grepping for a story ID:

```bash
git grep -n "US-CL-007" tests/  # example
```

The unit test should either name the story in the suite description (`describe("US-CL-007 — tier 1 mime detection", ...)`) or reference it in a `// US-CL-007:` source comment.
