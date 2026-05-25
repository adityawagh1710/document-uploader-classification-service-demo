# Application Design Plan — Classification Service

> Captures the design questions needed before generating component/service/dependency artifacts. All `[Answer]:` tags pre-filled with best-rationale picks for your verification. Override any pick by changing the letter; the AI then generates artifacts per the approved choices.

---

## A. Design Questions

### Question 1 — Component organisation pattern
How should the source tree be organised?

A) **Hexagonal (Ports & Adapters)** — `src/domain/` (pure logic), `src/ports/` (interface contracts), `src/adapters/` (S3, DynamoDB, Step Functions implementations). Test pure logic without LocalStack; swap adapters at test boundaries.

B) **Feature-sliced** — `src/features/classify/`, `src/features/dedup/`, etc. Each feature owns its own model, services, and adapters. Common in frontend; fine for backend with strong feature boundaries.

C) **Flat modules by unit** — `src/classifier/`, `src/persistence/`, `src/handler/`, mirrors the 4-unit decomposition from `execution-plan.md`.

D) **Layered (DDD-style)** — `src/domain/`, `src/application/`, `src/infrastructure/`, `src/interfaces/`. Heaviest structure; usually overkill for a single Lambda.

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The biggest engineering risk in this service is keeping pure logic (CLSID parsing, scoring, text heuristic) **testable without AWS emulation** so the dev inner loop stays in milliseconds (per `requirements.md` §7.1). Hexagonal/ports-and-adapters is the cleanest way to enforce that boundary: pure logic lives in `src/domain/`, talks to `src/ports/` interfaces, and the `src/adapters/` layer implements those interfaces against S3/DynamoDB/Step Functions. LocalStack only ever runs at the adapter layer. The unit decomposition from `execution-plan.md` maps cleanly: classifier-core = `domain`, persistence = adapter for content-hashes/workspace-config ports, handler = `application` layer composing ports, infrastructure = IaC. Option C (flat modules by unit) is fine but doesn't enforce the port boundary structurally — it relies on convention.

### Question 2 — Error handling style
How are recoverable vs unrecoverable failures expressed?

A) **Result/Either types throughout** — every function that can fail returns `Result<T, E>` (or `Either<E, T>`). No throws in business logic; exceptions only for genuinely unexpected bugs.

B) **Mixed** — Result types for **expected** outcomes (e.g., "tier produced no match"; "extension contradicts magic bytes"); exceptions for **truly exceptional** conditions (S3 NotFound, malformed payload, DynamoDB unreachable after retries). Lambda's top-level handler converts exceptions to `SendTaskFailure`.

C) **Exceptions throughout** — TypeScript native `Error` subclasses; throw freely; catch at module/handler boundaries. Conventional JS/TS style.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: "No tier matched" and "extension contradicts magic bytes" are **expected** classification outcomes — modelling them as exceptions creates control-flow noise. But genuinely unrecoverable cases (S3 NotFound, malformed input payload) **should** unwind to a global handler that emits `SendTaskFailure` (per FR-9, FR-10). Pure Result/Either (A) adds boilerplate everywhere; pure exceptions (C) lose the type-safety win of Result for expected branches. Mixed is the pragmatic TypeScript answer and aligns with how AWS Lambda Powertools structures its own code.

### Question 3 — Dependency injection style
How are dependencies (S3 client, DynamoDB client, logger, config) wired into the application code?

A) **Constructor injection via factory functions** — each component exports a `createXxx(deps)` factory; deps explicit. No DI container.

B) **DI container (e.g., tsyringe, awilix)** — runtime DI via decorators or registration. Powerful for large apps; overhead for a single Lambda.

C) **Plain imports** — modules import singletons directly (`import { ddbClient } from "../adapters/ddb"`). Simplest; hardest to test in isolation.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Factory-based constructor injection gives you everything DI containers do (explicit deps, swap for tests) without runtime decorators or container init overhead in a cold-start-sensitive Lambda. Each component's factory signature documents its surface area. Plain imports (C) make unit testing painful — you'd need module mocks for every AWS client. Containers (B) are overkill for a single deployable and add cold-start cost.

### Question 4 — Schema validation library (Step Function input + workspace-config records)
Which library validates the Step Function input payload (§4.1) and the DynamoDB records?

A) **Zod** — TypeScript-first; types inferred from schemas (`z.infer<typeof Schema>`); excellent error messages; widely adopted.

B) **AJV** — JSON Schema standard; very fast; the Step Function payload schema would also be reusable for OpenAPI/JSON-Schema artifacts.

C) **Valibot** — minimal, tree-shakable; smaller bundle than Zod; newer ecosystem.

D) **io-ts** — fp-ts integration; powerful but steep learning curve.

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Zod is the de-facto TypeScript validation library for AWS Lambda projects. `z.infer<typeof Schema>` gives you compile-time types from one source of truth, eliminating drift between the runtime validator and the TypeScript type. Error messages are usable out of the box for `SendTaskFailure` payloads (per SECURITY-05). AJV is faster but the perf gap is irrelevant at our payload sizes (a Step Function task event), and JSON-Schema reuse isn't a stated need. Valibot is promising but the ecosystem (eslint configs, framework integrations, AWS Powertools recipes) is still maturing.

### Question 5 — DynamoDB client abstraction
How is DynamoDB accessed?

A) **AWS SDK v3 `DynamoDBDocumentClient`** — official, no third-party deps, handles marshalling/unmarshalling automatically, supports conditional writes, TTL, GSIs directly.

B) **Raw `DynamoDBClient` from AWS SDK v3** — manual marshalling. More verbose; no value-add given Document Client exists.

C) **Higher-level abstraction (ElectroDB, dynamodb-toolbox)** — schema-aware, type-safe single-table-design helpers. Cleaner ergonomics; adds a learning curve and a dependency surface.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `DynamoDBDocumentClient` strikes the right balance for two simple tables (`content-hashes`, `workspace-config`). It handles type marshalling without imposing a schema layer, supports conditional writes (required for FR-7.1 policy-version self-healing) and TTL natively, and is part of the official SDK we're already pulling in. ElectroDB (C) shines for complex single-table-design patterns with many entity types; we have two simple tables, so the learning curve and dependency cost aren't justified.

### Question 6 — Logging / observability library
Which library produces structured logs, custom metrics, and X-Ray traces?

A) **`@aws-lambda-powertools/{logger,metrics,tracer}`** — AWS-blessed Lambda-focused library. Built-in correlation-ID propagation, structured JSON to CloudWatch, EMF-format custom metrics, X-Ray segments — all three pillars from one cohesive suite.

B) **`pino` for logs + manual CloudWatch SDK for metrics + AWS X-Ray SDK** — best-of-breed-per-pillar but more glue code.

C) **`winston` for logs + custom metrics + tracing** — most familiar Node.js logger; older API; not Lambda-optimised.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS Lambda Powertools is purpose-built for exactly the architecture in `requirements.md` §6: AWS Lambda + Step Functions + CloudWatch + X-Ray. Correlation ID (we use `documentId` per SECURITY-03 + US-SRE-001) propagates automatically through logs, metrics, and traces. EMF-format metric emission means metrics are emitted as part of the log stream — no separate metric API calls, no cold-start cost. Pino + manual SDK (B) is faster on raw log throughput but for a per-document Lambda the throughput delta doesn't matter; the glue code does.

### Question 7 — Infrastructure-as-Code tool
Which IaC tool defines the AWS resources?

A) **AWS CDK (TypeScript)** — TypeScript-native (same language as the service), strong typing for AWS resource props, excellent SECURITY-rule enforcement via cdk-nag, integrates with SAM Local for smoke tests, well-maintained AWS Solutions Construct library.

B) **AWS SAM (CloudFormation YAML/JSON)** — simpler for pure Lambda apps, native SAM Local support; weaker for non-Lambda resources (DynamoDB, alarms).

C) **Terraform** — multi-cloud; mature; less natural fit for AWS-only Lambda stack; adds HCL as a second language.

D) **Pulumi (TypeScript)** — like CDK but multi-cloud; ecosystem smaller than CDK on AWS.

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: CDK in TypeScript keeps the entire codebase in one language, gives compile-time validation of resource configurations, and has `cdk-nag` to enforce the SECURITY-01..15 baseline (encryption, least-privilege, hardening) as build-time gates. SAM (B) is excellent for pure Lambda apps but the project includes two DynamoDB tables, IAM roles, VPC endpoints, CloudWatch alarms, X-Ray — all of which are more ergonomic in CDK. Terraform (C) is a fine choice but introduces HCL and an entirely separate provider model. CDK + SAM Local works (you can `sam local invoke` against a CDK-synthesised template), so we don't lose the local-dev runner.

### Question 8 — Project layout (mono-package vs workspaces)
How is the codebase laid out at the package level?

A) **Single `package.json`** at the repo root; source under `src/{domain,ports,adapters,handler}/`; IaC under `infra/`; tests under `tests/`. One deployable, one dependency surface, simplest tooling.

B) **pnpm/npm workspaces** — one package per unit (`packages/classifier-core`, `packages/persistence`, `packages/handler`, `packages/infra`). Stricter boundaries; more tooling overhead; only worth it if units will ever be published independently.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: For a single deployable Lambda with 4 logical units, a monolithic `package.json` is the right shape. The hexagonal layout (Q1=A) already gives us structural boundaries between domain/ports/adapters. Workspaces (B) add `pnpm-workspace.yaml`, hoisting headaches, and a build orchestration layer for zero benefit — we never ship `classifier-core` independently. Module boundaries are still enforced (see Q10).

### Question 9 — Service-layer orchestration pattern
What does the orchestration layer look like inside the Lambda handler?

A) **Single `ClassificationService` orchestrator** — one class/factory composes `Tier1Detector`, `Tier2OLE2Detector`, `Tier2ZIPDetector`, `Tier3TextDetector`, `Scorer`, `Deduplicator`, `SlipsheetDecider`, `StepFunctionSignaler`. Linear orchestrate method.

B) **Multiple small services (CQRS-style)** — separate `ClassifyCommandHandler`, `DeduplicateCommandHandler`, etc., dispatched by an internal bus. Heavier; valuable for command-rich domains.

C) **Pipeline / chain-of-responsibility** — each tier and stage is a pipeline step; the handler runs the pipeline. Visually elegant; can be harder to debug step-state.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: A single orchestrator inside the handler unit is the most readable shape for a linear flow (read → detect tier 1 → on miss, tier 2 → on miss, tier 3 → score → dedup → decide slipsheet → signal). The pipeline pattern (C) is tempting but the tiers have early-exit semantics ("on Tier 1 hit, skip Tier 2 + Tier 3") that pipelines model awkwardly without escape hatches. CQRS (B) is for write-heavy domains with explicit command/query separation — wrong scale here.

### Question 10 — Module-boundary enforcement
How are cross-unit imports prevented (e.g., the `domain` layer must never import from `adapters`)?

A) **`eslint-plugin-boundaries`** (or `dependency-cruiser`) — enforced via lint rule in CI. PRs that violate the boundary fail before merge.

B) **Convention only** — documented in CONTRIBUTING.md; relies on code review.

C) **TypeScript `paths` + project references** — separate `tsconfig.json` per layer with restricted path aliases. More involved; pairs with workspaces.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Convention-only (B) fails the first time someone is in a hurry; once a `domain` module imports from `adapters`, the test boundary disintegrates. `eslint-plugin-boundaries` (or `dependency-cruiser`) gives you the structural enforcement of workspaces (Q8=B alternative) without the tooling overhead. Rule set encoded in `.eslintrc`: `domain` cannot import from `adapters` or `handler`; `ports` cannot import from `adapters` or `handler`; `adapters` cannot import from `handler`. Runs in CI.

---

## B. Generation Checklist (executed after plan approval)

### Phase 1 — Component identification
- [x] B1. Define **Components** (in `components.md`): name, purpose, responsibilities, interfaces. Identify ports as interfaces under the `ports` layer, domain modules under `domain`, adapters under `adapters`, the orchestrator service under `handler`.
- [x] B2. Map each component to its owning unit (classifier-core / persistence / handler / infrastructure).
- [x] B3. Mark hexagonal layer (domain | ports | adapters | application/handler) on every component.

### Phase 2 — Method signatures
- [x] B4. Define **Component Methods** (in `component-methods.md`): per component, the public method signatures with input/output types and one-line purpose. NO detailed business rules (those land in Functional Design per-unit).
- [x] B5. Express Result/Either types where applicable (Q2=B mixed style).
- [x] B6. Express factory function signatures for DI (Q3=A).

### Phase 3 — Service orchestration
- [x] B7. Define **Services** (in `services.md`): the single `ClassificationService` orchestrator (Q9=A) — its `classify(task: TaskPayload): Promise<Result<Output, FailureReason>>` method, the linear step list, and where retries / errors are caught.
- [x] B8. Describe how the orchestrator composes domain modules via ports — no direct adapter dependencies.

### Phase 4 — Dependencies & data flow
- [x] B9. Define **Component Dependencies** (in `component-dependency.md`): a dependency matrix showing allowed import directions; an ASCII data-flow diagram for the happy path; communication patterns (sync calls only; no internal bus); the ESLint boundary rules per Q10=A.

### Phase 5 — Consolidation
- [x] B10. Create the consolidated `application-design.md` that summarises all four artifacts into one navigable document, with cross-references and a quick "map: components → units → FRs" index.

### Phase 6 — Wrap-up
- [x] B11. Update `aidlc-state.md` — Application Design marked Completed.
- [x] B12. Update `audit.md` with the generation summary.
- [x] B13. Present completion message with the standard "🏗️ Application Design Complete" block.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-up clarifications resolved, the user explicitly approves this plan. Then the generation phase (Section B) executes without further questions until the completion message.
