# Infrastructure Design Plan — U-1 `classifier-core`

> Per-unit Construction stage 4/5. **U-1 is pure-domain TypeScript with zero runtime AWS resources** — most infrastructure categories are N/A and noted as such with justification. The few decisions that matter are about how U-1's compiled output participates in the shared Lambda artifact (owned by U-3 + U-4) and where U-1's CI quality gates execute.

---

## A. Category Applicability Justifications

Per the rule, every infrastructure category must be evaluated, with explicit justification for any "N/A" determination.

| Category | Applies to U-1? | Justification |
|---|---|---|
| **Deployment Environment** | Inherited | AWS already locked at service level (Q7=A Requirements). U-1 ships as TypeScript-compiled JavaScript bundled into the Lambda artifact deployed by U-4. No U-1-specific deployment-environment decision needed. |
| **Compute Infrastructure** | **N/A** | U-1 has no runtime of its own; it's a library imported by U-3 (handler). The Lambda compute is U-3's infrastructure surface. |
| **Storage Infrastructure** | **N/A** | U-1 has zero storage — no DDB tables, no S3, no caches. Storage belongs to U-2 (persistence) and U-4 (CDK definitions). |
| **Messaging Infrastructure** | **N/A** | U-1 has no I/O, no events, no queues. The Step Function callback pattern is U-3's surface. |
| **Networking Infrastructure** | **N/A** | U-1 has no network surface. Lambda VPC/endpoints are U-4. |
| **Monitoring Infrastructure** | Inherited | U-1 emits no runtime metrics/logs (per BR-3 — domain code does not log). Per-tier observability is wrapped *around* U-1 calls by U-3. CloudWatch/X-Ray decisions live in U-4. |
| **Shared Infrastructure** | **Applies (build + CI)** | U-1 has two infrastructure-adjacent concerns: (1) its compiled output must end up in the shared Lambda artifact; (2) its quality gates (lint, typecheck, unit, PBT, coverage, bench) must execute on shared CI infrastructure. These are addressed in Questions 1–3 below. |

---

## B. Infrastructure Design Questions

All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

### Question 1 — Build / bundling pipeline (how U-1's compiled JS reaches the Lambda artifact)
U-1's TypeScript compiles to JS that must end up in the Lambda zip alongside U-2, U-3 outputs and the pinned `file-type` runtime dependency. Choose the bundling approach.

A) **esbuild via CDK `NodejsFunction` construct** — CDK's `aws-cdk-lib/aws-lambda-nodejs.NodejsFunction` invokes esbuild internally; produces a tree-shaken, minified bundle with `file-type` inlined. Lockfile-aware. One tool. Same workflow as `cdk synth` and `cdk deploy`.

B) **Webpack** — heavyweight; configurable; usually overkill for a single Lambda.

C) **Manual `tsc` + `npm pack` zip + AWS CLI** — simplest but loses tree-shaking and produces large artifacts.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `NodejsFunction` is the canonical CDK pattern for TS Lambdas and integrates with our AWS CDK choice (Application Design Q7=A). It tree-shakes (essential — `file-type` ships with a lot of magic-byte tables we only need a subset of), targets Node 20 by default, supports source maps for X-Ray traces, and runs the same in CI and local. No separate bundler config to maintain. esbuild's speed also makes `sam local invoke` (the smoke-test step) fast.

### Question 2 — CI runner platform for U-1's quality gates
The 8 CI gates from `nfr-design/logical-components.md` §4 need a runner. Where do they execute?

A) **GitHub Actions on `ubuntu-latest`** — most common; free for public + reasonable for private repos; matches the "GitHub Actions assumed" notes in earlier docs. Runner has Node + Docker (the latter needed by U-3's LocalStack integration tests, not U-1).

B) **AWS CodeBuild** — keeps everything in AWS; integrates with CodePipeline; more setup; useful if compliance pushes against external CI.

C) **Self-hosted GitHub Actions runners** — cost optimisation; ops overhead.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: GitHub Actions on `ubuntu-latest` is the standard for greenfield Node.js projects, matches what the existing docs assume, and gives us the prebuilt Node 20 runner with no setup. CodeBuild (B) is a fine choice for AWS-pure shops but adds an extra integration surface (CodeBuild → CodePipeline → GitHub) and `cdk-nag` rules and SBOM tooling already work seamlessly with GitHub Actions. Self-hosted runners (C) are an optimisation we'd reach for only if CI cost becomes a measurable issue.

### Question 3 — Dependency caching in CI
`npm install` against the locked deps takes ~30s cold. Caching strategy?

A) **`actions/cache@v4` keyed on `package-lock.json` hash** — standard; ~5s cache restore on hit; falls through to fresh install on miss.

B) **No caching** — every CI run does a fresh install. Slower but no cache-poisoning risk.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `actions/cache` keyed on `package-lock.json` hash is the canonical pattern — cache invalidates exactly when deps change. Cache-poisoning risk is mitigated by `npm ci`'s strict-lockfile mode (which validates the lockfile against the resolved tree before installing). Option B's 30s install penalty per CI run on a project with ~10 gates becomes annoying fast.

### Question 4 — Bundle / artifact verification
Once esbuild produces the Lambda bundle (containing U-1's compiled output), should we verify it before handoff to U-4's CDK deploy?

A) **Bundle smoke check + size budget**: after esbuild, run a script that (i) loads the bundle in a fresh Node.js process and confirms the `handler` export is callable; (ii) asserts bundle size < N MB (e.g., 5 MB) — catches accidental dep bloat (e.g., a typo importing the whole `@aws-sdk` instead of just one client).

B) **Size budget only** — simpler; misses accidental import-time errors.

C) **No verification** — rely on smoke tests in U-3.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: A bundle smoke check is ~5 seconds and catches whole categories of "deploys but crashes on cold start" failures (missing dep, circular import, import side-effect throwing). The 5 MB budget is generous for a service with only `file-type` as a runtime dep — tripping the budget means something went wrong. Both checks are cheap to add now and would be tedious to retrofit. Note: the bundle smoke check is run by U-3's build pipeline (since U-3 owns the handler export); U-1's role is to provide compiled code that *imports cleanly* — which the existing `tsc` typecheck already ensures.

---

## C. Generation Checklist (executes after plan approval)

### Phase 1 — Infrastructure Design
- [x] B1. Create `aidlc-docs/construction/classifier-core/infrastructure-design/infrastructure-design.md`:
  - Category applicability table (from §A above)
  - Locked decisions from Q1–Q4
  - U-1's role in the shared build/deploy pipeline
  - "What U-1 does NOT own" section (compute, storage, messaging, networking, runtime monitoring) — explicit pointers to the units that DO own them
  - CI gate manifest (the 8 gates from NFR Design §4 with concrete GitHub Actions job names + runner + cache config)

### Phase 2 — Deployment Architecture (thin, for U-1)
- [x] B2. Create `aidlc-docs/construction/classifier-core/infrastructure-design/deployment-architecture.md`:
  - U-1's deployment path: `tsc` → esbuild (via `NodejsFunction`) → bundled into Lambda zip → CDK deploys
  - Diagram showing U-1's source → compile → bundle handoff to U-3 → CDK deploy by U-4
  - Build-time-only nature explicitly stated (no runtime U-1 resources exist)

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-1 Infrastructure Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message ("🏢 Infrastructure Design Complete - classifier-core").

---

## D. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part C executes without further questions until the standardized 2-option completion message.
