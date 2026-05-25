# NFR Design Plan — U-3 `handler`

> Per-unit Construction stage 3/5. Translates U-3's NFR Requirements into concrete design patterns + logical components. U-3 inherits patterns from U-1 (Result plumbing, exhaustive switch, PBT, perf bench, fixture manifest, PBT shrink capture) and U-2 (DDB client lifecycle, AbortSignal timeout, error name pattern matching, etc.). This stage adds patterns specific to: Lambda module-load wiring, Powertools instrumentation, SAM Local smoke testing, bundle verification.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Design Questions

### Question 1 — Module-load dependency wiring pattern
The Lambda handler must construct ~12 dependencies (SDK clients, adapters, services, validator, builder) once per cold start. Choose the wiring pattern.

A) **Module-level top-of-file singleton wiring** — all `createXxx({…})` calls run at module load before `export const handler = ...`. Survives across warm invocations. Failure here = cold-start init failure = Lambda exits before handler runs (caught by SFN).

B) **Lazy first-invocation wiring** — handler builds deps on first call, caches them on a module-level variable. Cold start has the same cost; adds a "first-call" branch per invocation.

C) **DI container** — runtime registration + resolution. Powerful; overkill for ~12 deps.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Module-level singleton wiring is the canonical AWS Lambda pattern (matches Pattern P-2-1 from U-2). Lazy wiring (B) adds a branch + null-check on every warm call for zero benefit. DI containers (C) bring decorators, reflection, and cold-start cost. Init failure at module load surfaces to CloudWatch as a Lambda init error — exactly what we want for "deps couldn't be constructed".

### Question 2 — SAM Local + LocalStack integration pattern
The smoke test tier runs the actual Lambda runtime via SAM Local with LocalStack-emulated AWS services. Choose the integration pattern.

A) **SAM `template.yaml` + per-environment env overrides + `sam local invoke` against the running LocalStack container from integration-test setup**. The SAM template mirrors the production CDK template's Lambda config (memory, timeout, env vars, handler entry).

B) Skip SAM Local — rely on integration tests as the highest-fidelity test tier. Loses verification of Lambda runtime behaviour (cold start, env var propagation, esbuild bundle resolution).

C) AWS SAM Local with its own LocalStack — separate container; doubles container startup cost.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: SAM Local against the already-running LocalStack (from the integration `globalSetup`) reuses the container we already paid 30s startup for. SAM Local runs the Lambda inside the actual `public.ecr.aws/lambda/nodejs:20` Docker image — catching cold-start, env-var, and runtime-resolution issues that integration tests don't surface (since integration tests run the orchestrator directly without the Lambda runtime). Option B skips a real risk surface; option C wastes startup time.

### Question 3 — Bundle smoke check implementation
After `cdk synth` produces the Lambda bundle, run a fast pre-deploy check.

A) **Shell script `scripts/verify-bundle.sh`** that: (i) verifies bundle size ≤ 5 MB; (ii) loads the bundle in a fresh Node.js process and confirms `handler` export is a function; (iii) writes findings to a JSON report. Runs as a CI step after `cdk synth`.

B) Inline TypeScript test — same checks but as a Vitest test. Mixes deploy-artifact verification with the test suite.

C) Skip the bundle check — rely on first deploy to surface issues. Catastrophic if a typo'd import lands in production.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Shell script keeps deploy-artifact verification distinct from the test suite (which targets source code). The smoke check runs once per `cdk synth` (typically once per CI pipeline run); inlining as a Vitest test would couple it to the test invocation lifecycle awkwardly. The JSON report integrates cleanly with CI dashboards. Skipping (C) is risky — accidental `import {…} from "@aws-sdk/client-s3"` syntax that fails to bundle is a real failure mode.

### Question 4 — Powertools instrumentation pattern across the 13 steps
Q5=A of NFR Requirements already locked per-step subsegments + EMF metrics + entry/exit logs. Refine the implementation pattern:

A) **A `runStep(stepName, fn)` helper** that wraps every step's body: opens an X-Ray subsegment, emits start log, calls `fn()`, emits end log + duration metric on success, error log + outcome="error" metric on failure. Single source of truth for instrumentation; can't be skipped accidentally.

B) Inline instrumentation per step — copy-paste the tracer/logger/metric calls into each step's body. Most explicit; most error-prone.

C) Class-based decorator pattern (`@TraceStep("step3.read-detection-window")` decorator). TypeScript decorators are stable now but add a build-step gotcha (esbuild needs the decorator syntax flag).

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: A helper function is the cleanest balance — single instrumentation surface, applies to every step uniformly, easy to extend (e.g., adding sampling) by changing one place. Decorators (C) are nice but the bundling complications aren't worth it. Inline (B) makes "did this step have correct instrumentation?" a code-review checklist instead of a structural guarantee.

### Question 5 — `nowProvider` and `policyVersionExtractor` injection pattern
These are injected into `ClassificationService` for determinism. Choose the construction pattern.

A) **Construct in `lambda.ts` with concrete implementations**: `nowProvider: () => new Date().toISOString()`, `policyVersionExtractor: (c) => c.policyVersion`. Tests pass deterministic replacements.

B) Constants in a separate config module — `defaultNowProvider` exported from `src/handler/config.ts`. Marginal benefit; one more file.

C) Tests-only injection — production uses default `Date.now()` calls inside the service. Loses test determinism.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Construct-in-lambda.ts is the simplest pattern; the deps are short one-liners. Separate config (B) would be premature abstraction for two trivial closures. Option C breaks NFR-5 testability and creates a vector for non-determinism if anyone forgets the convention.

### Question 6 — Integration tests covering the orchestrator (end-to-end through LocalStack)
With U-3 generated, integration tests can exercise the full pipeline. Choose the scope.

A) **All 11 ACs from `requirements.md` §8 as integration tests + 4 extra edge-case tests** (binary-byte ESC text, OOXML conservative default, slipsheet on unknown format, override flag flow). Each test creates a fresh workspaceId, seeds workspace-config + S3 object, invokes `ClassificationService.classify`, asserts the `ClassificationOutput`.

B) Just the 11 ACs — minimum to satisfy the spec. Misses edge cases.

C) Comprehensive — every code path + every error path = ~50 tests. Heavy maintenance.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AC-1..AC-11 are the contract — they MUST pass. Adding 4 edge-case tests (the cases functional design explicitly enumerates: ESC byte text per BR-T-1, OOXML conservative default per `format-mappers.ts`, unknown-format slipsheet fallback per BR-3-OUT-3, override flag passthrough per BR-3-O-5 Case B) covers the cases functional design flagged but ACs don't exercise. Comprehensive (C) admits low-value tests that mock SDK errors — covered by unit + PBT instead.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Design Patterns
- [x] B1. Create `aidlc-docs/construction/handler/nfr-design/nfr-design-patterns.md`:
  - **Pattern P-3-1: Module-load dependency wiring** (Q1=A) — top-of-file singleton construction; init failure = Lambda init error
  - **Pattern P-3-2: SAM Local + shared LocalStack** (Q2=A) — SAM template config + integration with the running LocalStack container
  - **Pattern P-3-3: Bundle smoke check** (Q3=A) — shell script + JSON report + CI step
  - **Pattern P-3-4: `runStep` instrumentation helper** (Q4=A) — single source of truth for tracer/logger/metric
  - **Pattern P-3-5: `nowProvider` injection** (Q5=A) — closure-based dep; testable replacement
  - **Pattern P-3-6: End-to-end integration coverage** (Q6=A) — 11 ACs + 4 edge cases
  - **Pattern P-3-7: Graceful Lambda exit + SendTaskFailure best-effort** — Lambda entry-point try/catch sequence (already in `business-logic-model.md` §4 but documented here as a pattern)
  - Pattern summary table

### Phase 2 — Logical Components
- [x] B2. Create `aidlc-docs/construction/handler/nfr-design/logical-components.md`:
  - Source components: 4 adapters (S3, Crypto, StepFunction, PowertoolsLogger), 4 application components (ClassificationService, InputValidator, OutputBuilder, mapFailureToErrorCode), 1 handler entry-point, 4 new ports (S3Reader, S3Streamer, Hasher, TaskSignaler)
  - **Configuration components**: SAM `template.yaml`, bundle smoke check script, Powertools env-var matrix
  - **Test infrastructure components as first-class**: 6 integration test files (per Q6=A — 11 ACs + 4 edges + 1 setup-shared module), 1 smoke test file, perf test for end-to-end latency
  - CI workflow components (logical — materialised in U-4): 9 jobs (including new smoke-test job)
  - Final NFR ↔ Component coverage matrix proving every applicable NFR/SECURITY/PBT for U-3 has a named component satisfying it

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-state.md` — U-3 NFR Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
