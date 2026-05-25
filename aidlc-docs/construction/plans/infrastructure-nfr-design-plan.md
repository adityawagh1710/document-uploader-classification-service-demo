# NFR Design Plan — U-4 `infrastructure`

> Per-unit Construction stage 3/5. U-4 inherits patterns from U-1/U-2/U-3 and adds CDK-specific patterns: snapshot test wrapper, suppression registry, OIDC-credential deploy, per-env config loader.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Design Questions

### Question 1 — Snapshot test wrapper pattern
Each stack test will need the same boilerplate (App, instantiate stack, Template.fromStack, snapshot). Choose:

A) **Helper `synthAndAssertSnapshot(stackFactory, envName)` in `infra/lib/_test-helpers.ts`** — wraps the App + Stack + Template + snapshot lifecycle. Each test file calls it with one line plus targeted assertions.

B) Inline the boilerplate in each test — ~10 lines per file. Repetitive but explicit.

C) Test base class — extends a Vitest pattern; more abstraction than needed.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: A helper function keeps test files focused on the *what* (assertions) rather than the *how* (App/Stack/Template plumbing). Three test files × ~10 lines of boilerplate = 30 lines of duplication that we eliminate; new tests added later inherit the convention. Test base classes (C) introduce inheritance that's overkill for declarative test setup.

### Question 2 — cdk-nag suppression registry pattern
The 3 documented suppressions (DDB3, IAM4, L2) all need a `reason` string. Choose how to manage them:

A) **`NagSuppressions.addResourceSuppressions(resource, [...])` co-located with the resource in the stack** — each suppression sits next to the construct it applies to; readable in context.

B) Central suppression registry in `infra/lib/_suppressions.ts` — all suppressions in one file. More discoverable; less context.

C) cdk-nag configuration file (`cdk-nag-config.json`) — declarative; less ergonomic in TypeScript.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Co-located suppressions are the canonical cdk-nag pattern and surface the suppression's *reason* right next to the code triggering it. When a reviewer asks "why is this OK?", the answer is in the same file. A central registry (B) makes you grep across files to find why something's suppressed. Configuration files (C) are non-ergonomic in TypeScript (no autocomplete, no type-checking).

### Question 3 — Per-env config loader pattern
The `infra/config/load.ts` switches on env name and returns the config. Choose:

A) **Explicit switch with throw on unknown env** — `switch (envName) { case "dev": ...; case "staging": ...; case "prod": ...; default: throw }`. Fails closed on typos.

B) Dynamic import — `import(\`./\${envName}.js\`)`. More flexible; loses static type-checking + opens "fall through to env 'x'" footgun.

C) Map lookup `{ dev: devConfig, staging: stagingConfig, prod: prodConfig }[envName]` — concise but returns `undefined` on bad input.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Explicit switch fails closed on unknown env names — exactly what we want. Typing `-c env=prdo` (typo) at the CLI should be a loud error, not a silent fallback to `dev` (which is what option C's `undefined` + later code would do). Dynamic imports (B) also break our SECURITY-15 fail-closed posture and lose static-type-checking benefits.

### Question 4 — Test file organisation
Each stack has a test file. Choose where the tests live:

A) **Adjacent to source under `infra/lib/`** — `infra/lib/data-stack.test.ts`, etc. Snapshots in `infra/lib/__snapshots__/`. Tests run via `vitest run infra/lib`.

B) Under a `tests/` directory — `tests/infra/data-stack.test.ts`. Snapshots in `tests/infra/__snapshots__/`. Centralised but separates spec from code.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Adjacent tests are the canonical CDK pattern (matches `aws-cdk-lib`'s own test organisation). The `infra/` tree is already a separate package boundary from `src/` — keeping its tests within `infra/` reinforces that boundary. Tests under `tests/` (B) would muddle the boundary and create import-path complexity.

### Question 5 — Deploy workflow OIDC role pattern
GitHub Actions OIDC needs an IAM role in each AWS account. Choose configuration approach:

A) **One OIDC role per AWS account, trust policy locked to `repo:${org}/${repo}:ref:refs/heads/main` for non-prod and `repo:${org}/${repo}:environment:prod` for prod** — narrowest trust; prevents PR-branch deploys to prod even with credential leakage.

B) Single OIDC role across all envs — simpler; gives any branch deploy access to all envs.

C) OIDC role per env per branch — most paranoid; complex maintenance.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-account-with-environment-conditioned-trust is the AWS-recommended OIDC pattern. The `environment:prod` condition is what makes GitHub's environment protection rule meaningful — even if someone has access to the `prod` workflow, the OIDC role only accepts assumeRole when the run is gated by the `prod` environment (which has manual-approval protection). Option B is convenient but loses the environment-scoping. Option C is over-engineered.

### Question 6 — CI job dependency graph
With 11+ CI jobs, dependencies between them must be defined. Choose:

A) **Sensible `needs:` dependencies — `lint` before everything; `typecheck` before `test-*`; `cdk-synth` before `cdk-nag`/`verify-bundle`/`test-smoke`; everything else parallel.** Fast-fail on cheap checks.

B) All parallel — no dependencies; maximum CI throughput; redundant compute when earlier checks would have caught the issue.

C) All sequential — simplest; slowest.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Hierarchical dependencies match the cost-vs-signal tradeoff. Lint (~10s) is the fastest fail signal; running expensive jobs (integration, smoke, bench — 30s+) before lint is wasteful. cdk-synth precedes cdk-nag/verify-bundle/test-smoke because all three need the synthesised template. Everything else can run in parallel for throughput.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Design Patterns
- [x] B1. Create `aidlc-docs/construction/infrastructure/nfr-design/nfr-design-patterns.md`:
  - **Pattern P-4-1: `synthAndAssertSnapshot` helper** (Q1=A) — wraps App+Stack+Template+snapshot+toMatchSnapshot
  - **Pattern P-4-2: Co-located cdk-nag suppressions** (Q2=A) — `NagSuppressions.addResourceSuppressions` adjacent to the resource
  - **Pattern P-4-3: Explicit env switch with fail-closed default** (Q3=A) — `load.ts` switch with throw on unknown env
  - **Pattern P-4-4: Adjacent test files under `infra/lib/`** (Q4=A) — tests + snapshots colocated
  - **Pattern P-4-5: OIDC role with environment-conditioned trust** (Q5=A) — per-account role + `environment:prod` condition
  - **Pattern P-4-6: Hierarchical CI job graph** (Q6=A) — lint → typecheck → parallel fan-out
  - **Pattern P-4-7: cdk-nag aspect at app level** — `Aspects.of(app).add(new AwsSolutionsChecks())` applies to all stacks
  - Pattern summary table

### Phase 2 — Logical Components
- [x] B2. Create `aidlc-docs/construction/infrastructure/nfr-design/logical-components.md`:
  - Source components: 3 stacks + 1 entry point + 4 config files + 1 load helper + 1 test helper
  - **Configuration components**: cdk.json, infra/tsconfig.json, .eslintrc additions for `infra/**`
  - **Test infrastructure components first-class**: 3 stack test files, snapshot directory, test helper
  - **CI workflow components**: .github/workflows/ci.yml + deploy.yml (the actual files materialised in Code Generation)
  - Final NFR ↔ Component coverage matrix for U-4

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-state.md` — U-4 NFR Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
