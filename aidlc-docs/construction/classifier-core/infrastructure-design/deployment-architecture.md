# Deployment Architecture — U-1 `classifier-core`

> U-1 has no runtime deployment surface of its own — it compiles to JavaScript that is bundled into the Lambda artifact deployed by U-4. This document captures the build/handoff path and the explicit "no runtime infrastructure" assertion.

---

## 1. U-1's Deployment Path

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                       SOURCE TREE                                │
   │                                                                  │
   │  src/domain/**           src/shared/**     package.json          │
   │  (U-1 logic)             (U-1 helpers)     (deps incl. file-type)│
   │                                                                  │
   │  tsconfig.json (strict-plus)                                     │
   │  .eslintrc.cjs (boundaries + restrictions)                       │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                      BUILD-TIME (CI)                             │
   │                                                                  │
   │   1. ESLint check        (zero errors)                           │
   │   2. tsc --noEmit        (zero type errors)                      │
   │   3. Vitest unit tests   (all pass)                              │
   │   4. fast-check PBT      (all pass)                              │
   │   5. Vitest coverage     (≥90% global, ≥95% tier2-ole2)          │
   │   6. Vitest bench        (p99 ≤ baseline × 1.10)                 │
   │   7. npm audit           (zero high/critical)                    │
   │                                                                  │
   │   These all run on GitHub Actions ubuntu-latest with             │
   │   actions/cache@v4 keyed on package-lock.json.                   │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                     BUNDLE-TIME (CDK synth)                      │
   │                                                                  │
   │   CDK NodejsFunction construct invokes esbuild:                  │
   │     - tree-shakes file-type (drops unused magic-byte tables)     │
   │     - inlines src/domain/** + src/shared/**                      │
   │     - emits dist/handler.js + handler.js.map                     │
   │     - zips to cdk.out/asset.*/handler.zip                        │
   │                                                                  │
   │   Bundle smoke check (run by U-3's build script):                │
   │     - bundle size ≤ 5 MB                                         │
   │     - bundle loads cleanly + exports `handler`                   │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                       DEPLOY (CDK)                               │
   │                                                                  │
   │   cdk deploy ClassificationLambdaStack (owned by U-4):           │
   │     - uploads bundle to Lambda                                   │
   │     - configures Lambda function (timeout, memory, IAM, VPC)     │
   │     - publishes new $LATEST                                      │
   │     - (optional) shifts alias to new version                     │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                       RUNTIME (Lambda)                           │
   │                                                                  │
   │   Lambda invoked by Step Function with task payload.             │
   │   ClassificationService.classify() runs (U-3 orchestrator)       │
   │   and calls into U-1's pure-domain functions:                    │
   │                                                                  │
   │     Tier1FileTypeDetector.detect(buffer)                         │
   │     Tier2OLE2Detector.detect(buffer, extension)                  │
   │     Tier2ZIPDetector.detect(buffer)                              │
   │     Tier3TextDetector.detect(buffer)                             │
   │     Scorer.score(scoringInput)                                   │
   │     CategoryMapper.map(format, tier)                             │
   │     SlipsheetDecider.decide(slipsheetInput)                      │
   │                                                                  │
   │   No U-1 runtime infrastructure exists — it's a callable         │
   │   library inside a Lambda owned by U-3 + U-4.                    │
   └─────────────────────────────────────────────────────────────────┘
```

---

## 2. Handoff Diagram — Which Unit Owns Each Phase

```
   Phase            │  Owns it
   ─────────────────┼────────────────────────────────────────
   Source code      │  U-1 (src/domain/**, src/shared/**)
                    │
   Build-time CI    │  U-1 (defines the gates) + Service-shared (workflow file location)
                    │
   esbuild bundling │  U-4 (configures via NodejsFunction construct)
                    │
   Bundle smoke     │  U-3 (owns the handler export contract)
                    │
   CDK deploy       │  U-4 (ClassificationLambdaStack)
                    │
   Lambda runtime   │  U-3 (orchestrator) — U-1 is just function calls
                    │
   Observability    │  U-3 (Powertools wiring) + U-4 (CloudWatch + X-Ray)
                    │
   Alarms           │  U-4 (ClassificationObservabilityStack)
```

---

## 3. Build-Time-Only Nature (Explicit)

To make this auditable: **U-1 has zero runtime AWS resources.** The following statements are all true:

- There is no Lambda function defined by U-1.
- There is no DynamoDB table defined by U-1.
- There is no S3 bucket defined by U-1.
- There is no IAM role defined by U-1.
- There is no Step Function State Machine defined by U-1.
- There is no VPC, subnet, security group, or endpoint defined by U-1.
- There is no CloudWatch log group, metric, or alarm defined by U-1.
- There is no X-Ray sampling rule defined by U-1.
- There is no Parameter Store / Secrets Manager entry owned by U-1.

The only artefacts U-1 produces are:
1. Compiled `.js` files (transient — never deployed standalone; always bundled by U-4)
2. Test reports (CI artefacts; not deployed)
3. Coverage reports (CI artefacts)
4. Perf baselines (`tests/perf/perf-baselines.json`, committed)
5. Auto-captured PBT regressions (`tests/regression/pbt-failures.json`, committed)

Of these, only #4 and #5 are persisted in version control. None are deployed to AWS.

---

## 4. Per-Environment Considerations (None for U-1)

Because U-1 has no runtime resources, there are no per-environment (dev/staging/prod) differences in U-1's deployment. The same compiled JavaScript flows into the same bundle for every environment — environment-specific configuration (table names, log levels, etc.) is injected at the Lambda level by U-4's CDK stacks.

This is intentional and a benefit of the hexagonal layout: U-1 has no awareness of which environment it's running in.

---

## 5. Rollback Considerations

**U-1 rollback strategy**: revert the source change in git → re-build → re-bundle → re-deploy. Standard CDK rollback applies (previous Lambda version retained via aliases — owned by U-4).

**Because U-1 has no persistent state**, rolling back U-1 is purely a code-deployment operation. There are no schema migrations, no cache invalidations, no data backfills required to roll back a change in classifier-core logic.

---

## 6. Summary

U-1's "deployment architecture" reduces to: **"compile clean, bundle clean, ship to Lambda via U-4's CDK"**.

The thinness of this stage for U-1 is a *feature*, not a gap — it's the payoff of the hexagonal layer decision (Application Design Q1=A). The domain layer is intentionally infrastructure-free, which means infrastructure changes never force domain changes and domain changes never force infrastructure changes.

The remaining heavy-lifting in this Construction phase is owned by U-2, U-3, U-4 — each with their own Functional Design → NFR → Infrastructure loops still to come.
