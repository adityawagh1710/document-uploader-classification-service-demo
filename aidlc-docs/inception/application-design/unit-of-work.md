# Unit of Work — Classification Service

> **Terminology** (per AI-DLC `units-generation.md` overview):
> - **Unit of Work** = a logical grouping of stories for development purposes
> - **Module** = a logical grouping *within* a service (here: a hexagonal layer or directory)
> - **Service** = the deployable Classification Service Lambda (we have exactly one)
>
> This service is **one deployable** composed of **four units of work**. Units own code, tests, FRs, NFRs, and stories — they are *not* independently deployable services.

---

## 1. Unit Index

| ID | Unit | Owning Layers | Test Tier | Primary FR/NFR Scope |
|---|---|---|---|---|
| U-1 | **classifier-core** | `src/domain/*` | Unit + PBT | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-6.1, NFR-5 |
| U-2 | **persistence** | `src/adapters/dynamo-content-hashes/`, `src/adapters/dynamo-workspace-config/` | Integration (LocalStack) | FR-7, FR-7.1, FR-7.2, FR-7.3, NFR-4, NFR-6, NFR-10 |
| U-3 | **handler** | `src/application/*`, `src/adapters/{s3,step-functions,crypto,powertools}/`, `src/handler/lambda.ts` | Integration + Smoke | FR-7, FR-8, FR-8.1, FR-9, FR-10, NFR-1, NFR-2, NFR-3, NFR-7, NFR-8, NFR-9 |
| U-4 | **infrastructure** | `infra/*` (CDK stacks) | CDK snapshot + Integration | All SECURITY rules with infrastructure surface (01, 06, 07, 09, 10, 14), NFR-8 |

> Cross-cutting code — `src/shared/` (Result type, common type aliases) and `src/ports/` (interface contracts) — is **unit-less** by Q2=B. It lives at the root of `src/` and is governed by all units jointly; PRs touching it must flag cross-unit impact in review.

---

## 2. Per-Unit Detail

### U-1 — `classifier-core`

**Purpose**: Pure file-type detection logic, isolated from AWS I/O. The unit that owns *what* makes a file what it is.

**Owning Layers**: `src/domain/*`

**Components in scope** (from `components.md`):
- C-01 `Tier1FileTypeDetector`
- C-02 `OLE2Parser`
- C-03 `Tier2OLE2Detector`
- C-04 `ZIPMarkerParser`
- C-05 `Tier2ZIPDetector`
- C-06 `Tier3TextDetector`
- C-07 `Scorer`
- C-08 `CategoryMapper`
- C-09 `SlipsheetDecider`

**FRs in scope**: FR-1 (three-tier detection), FR-2 (CLSID), FR-3 (ZIP), FR-4 (text heuristic), FR-5 (scoring), FR-6 (category assignment), FR-6.1 (macro quarantine)

**NFRs in scope**: NFR-5 (deterministic per input tuple)

**Test tier**: Pure-logic unit tests + property-based tests (`fast-check`). No LocalStack, no AWS SDK. Target: sub-second full-suite run.

**Construction depth**: Comprehensive (high complexity, PBT-heavy, foundational)

**Key risk**: Mixed-endian CLSID parsing is a known bug source (called out in `requirements.md` §2.2). PBT-02 round-trip property is mandatory.

---

### U-2 — `persistence`

**Purpose**: DynamoDB access for `content-hashes` (with conditional writes + policy-version semantics + TTL) and `workspace-config` (read-once-per-invocation).

**Owning Layers**: Two specific adapter directories — `src/adapters/dynamo-content-hashes/`, `src/adapters/dynamo-workspace-config/`

**Components in scope**:
- A-03 `DDBContentHashAdapter`
- A-04 `DDBWorkspaceConfigAdapter`
- (Implements ports P-04 `ContentHashStore` and P-05 `WorkspaceConfigStore`, which live in cross-cutting `src/ports/` per Q2=B)

**FRs in scope**: FR-7 (deduplication), FR-7.1 (policy-versioned cache), FR-7.2 (hash record update semantics), FR-7.3 (no collision check)

**NFRs in scope**: NFR-4 (workspace isolation via partition key), NFR-6 (config-driven), NFR-10 (configurable TTL)

**Test tier**: Integration tests against LocalStack-emulated DynamoDB. Conditional writes, TTL behaviour, policy-version mismatch all exercised end-to-end.

**Construction depth**: Standard (well-understood AWS SDK patterns; security-critical because it owns workspace isolation)

**Key risk**: Conditional-write `UpdateExpression` strings are easy to get subtly wrong; integration tests catch most issues, but Functional Design should pin the exact expression strings.

---

### U-3 — `handler`

**Purpose**: The Lambda runtime — orchestration, S3 I/O, streaming SHA-256, Step Function callbacks, observability wiring, retry policy, and global error handling.

**Owning Layers**: `src/application/*`, `src/adapters/{s3,step-functions,crypto,powertools}/`, `src/handler/lambda.ts`

**Components in scope**:
- A-01 `S3Adapter`
- A-02 `NodeCryptoHasher`
- A-05 `StepFunctionAdapter`
- A-06 `PowertoolsLoggerAdapter`
- S-01 `ClassificationService` (the orchestrator)
- S-02 `InputValidator` (Zod)
- S-03 `OutputBuilder`
- S-04 `LambdaHandler` (Lambda entry point)

**FRs in scope**: FR-7 (dedup coordination — calls U-2 via `ContentHashStore` port), FR-8 (forced-slipsheet override coordination), FR-8.1 (slipsheet output schema), FR-9 (state machine signaling), FR-10 (retry policy)

**NFRs in scope**: NFR-1 (ranged GET), NFR-2 (streaming hash), NFR-3 (4,100-byte window), NFR-7 (structured logs), NFR-8 (observability stack), NFR-9 (one invocation per task)

**Test tier**: Integration tests (LocalStack via testcontainers) for all 11 ACs + smoke tests (SAM Local + LocalStack) for Lambda-runtime fidelity.

**Construction depth**: Comprehensive (orchestration, error handling, observability all converge here; the most cross-cutting unit)

**Key risk**: Two-layer retry (SDK + Step Function) requires the handler to be genuinely idempotent — Functional Design must verify each step is replay-safe.

---

### U-4 — `infrastructure`

**Purpose**: AWS resources defined in CDK (TypeScript). Lambda function + IAM, DynamoDB tables + TTL, CloudWatch log groups + alarms + dashboards, X-Ray, VPC/endpoints.

**Owning Layers**: `infra/*` (separate package tree; never imported by `src/`)

**Components in scope**:
- I-01 `ClassificationLambdaStack`
- I-02 `ClassificationDataStack`
- I-03 `ClassificationObservabilityStack`

**SECURITY rules in scope** (infrastructure surface of the SECURITY baseline):
- SECURITY-01 (encryption at rest & in transit — DDB SSE, S3 SSE, TLS for SDK calls)
- SECURITY-06 (least-privilege IAM — Lambda role scoped to specific ARNs)
- SECURITY-07 (restrictive network — VPC, private endpoints, no `0.0.0.0/0` ingress)
- SECURITY-09 (hardening — block public S3 access, no default credentials, generic error responses)
- SECURITY-10 (supply chain — pinned base layers, `cdk-nag` enforcement, dependency scanning in CI)
- SECURITY-14 (alerting & monitoring — CloudWatch alarms, log retention ≥ 90 days, log integrity)

**NFRs in scope**: NFR-8 (observability stack)

**Test tier**: CDK snapshot tests + integration with the deployed Lambda. `cdk-nag` enforces SECURITY rules at synth time.

**Construction depth**: Standard (canonical CDK patterns; `cdk-nag` does most of the security policing)

**Key risk**: IAM scope drift — overly broad `Resource: "*"` would violate SECURITY-06. `cdk-nag` rule `AwsSolutions-IAM5` catches this at build.

---

## 3. Code Organisation Strategy (Greenfield)

Per Q8=A (Application Design) and Q1=A + Q5=A (this stage), the project layout is:

```
classification-service/
├── package.json                 (single)
├── tsconfig.json
├── .eslintrc.cjs                (boundaries rules — see component-dependency.md §6)
├── README.md
│
├── src/
│   ├── domain/                  ◀── U-1 classifier-core owns
│   │   ├── tier1-filetype/
│   │   ├── tier2-ole2/
│   │   ├── tier2-zip/
│   │   ├── tier3-text/
│   │   ├── scoring/
│   │   ├── categories/
│   │   └── slipsheet/
│   ├── ports/                   ◀── unit-less (cross-cutting; Q2=B)
│   │   ├── S3Reader.ts
│   │   ├── S3Streamer.ts
│   │   ├── Hasher.ts
│   │   ├── ContentHashStore.ts
│   │   ├── WorkspaceConfigStore.ts
│   │   ├── TaskSignaler.ts
│   │   └── Logger.ts
│   ├── adapters/
│   │   ├── s3/                  ◀── U-3 handler owns
│   │   ├── crypto/              ◀── U-3 handler owns
│   │   ├── step-functions/      ◀── U-3 handler owns
│   │   ├── powertools/          ◀── U-3 handler owns
│   │   ├── dynamo-content-hashes/    ◀── U-2 persistence owns
│   │   └── dynamo-workspace-config/  ◀── U-2 persistence owns
│   ├── application/             ◀── U-3 handler owns
│   │   ├── ClassificationService.ts
│   │   ├── input-schema.ts (Zod)
│   │   └── OutputBuilder.ts
│   ├── handler/                 ◀── U-3 handler owns
│   │   └── lambda.ts            (Lambda entry; the dependency-wiring point)
│   └── shared/                  ◀── unit-less (cross-cutting; Q2=B)
│       ├── result.ts
│       ├── types.ts
│       └── constants.ts
│
├── infra/                       ◀── U-4 infrastructure owns
│   ├── bin/
│   ├── lib/
│   │   ├── lambda-stack.ts
│   │   ├── data-stack.ts
│   │   └── observability-stack.ts
│   ├── cdk.json
│   └── snapshot-tests/
│
└── tests/
    ├── unit/                    ◀── U-1 classifier-core owns
    ├── pbt/                     ◀── U-1 classifier-core owns
    ├── integration/             ◀── U-2 + U-3 own (split by AC ownership)
    ├── smoke/                   ◀── U-3 handler owns
    └── fixtures/                ◀── shared
        ├── docx-renamed-pdf/
        ├── msg/
        ├── eml/
        ├── ole2-nonstandard-sector/
        └── synthetic-generators.ts  (used by PBT)
```

---

## 4. Cross-Cutting Concerns (Q2=B)

`src/shared/` and `src/ports/` are **unit-less** by deliberate design:

- **Ports** define the contracts between layers. Any unit that wants to add a port (e.g., a new external service integration) must coordinate with the consuming units.
- **Shared** types (`Result<T, E>`, enums, type aliases) are the lingua franca. A change here can ripple through all units.
- **Process**: PRs touching `src/ports/` or `src/shared/` are labelled `cross-cutting`. They require review from at least one owner of each unit that imports the touched file.
- **Enforcement**: ESLint boundary rules (`component-dependency.md` §6) restrict who can import what, so even if cross-cutting code becomes a magnet for shared logic, the structural boundaries hold.

---

## 5. Story Ownership Rule (Q3=A)

**A story's "owner unit" is the unit whose acceptance test lives there.** Other units that contribute code without owning the AC test are listed as "contributing units" in `unit-of-work-story-map.md`.

Concrete example — US-DI-002 ("avoid being charged twice"):
- **Owner**: U-3 `handler` (the integration test under `tests/integration/dedup.test.ts` exercises the full orchestrator path)
- **Contributing**: U-1 (no role — pure logic doesn't care about dedup), U-2 (the conditional write that backs the test)

Why this rule:
- Acceptance criteria are the source of truth for "done"
- The unit running the AC test is the one whose CI must pass before the story is closed
- Contributing units are responsible for their tier's tests (unit, PBT, integration) that make the AC test runnable

---

## 6. Inter-Unit Contract Strategy (Q4=A)

**TypeScript IS the contract.** Each adapter is typed as the port it implements:

```typescript
// In U-2 (persistence):
export function createDDBContentHashAdapter(deps: …): ContentHashStore { … }
// In U-3 (handler):
const store: ContentHashStore = createDDBContentHashAdapter({ ddb, tableName, logger });
// → If U-2 ever drifts from the ContentHashStore interface, `tsc` fails in U-3's compile.
```

**No Pact, no JSON contract files, no runtime broker.** Reasons:
1. All four units ship in one Lambda — there's no "consumer" deployed separately from a "provider".
2. The port interfaces live in `src/ports/` (unit-less) — a single source of truth.
3. Integration tests against LocalStack already exercise the real adapter against real (emulated) AWS — better than fake contracts.

**Trigger for revisit**: if we ever extract `persistence` into a separate deployable (e.g., behind an internal API), we add contract tests then.

---

## 7. Versioning Strategy (Q5=A)

**Single repo version.** One `version` in the root `package.json`, one git tag per release, one `CHANGELOG.md` covering all units.

- CDK stamps the version into Lambda metadata at synth time: each deployed Lambda function has its `version` queryable in CloudWatch.
- `unit/PBT/integration/smoke` test suites are all triggered against the same version — no per-unit version drift possible.
- Pre-1.0 versioning: 0.x.x bumps for any breaking change to the Step Function input/output schema (§4.1, §4.2).

---

## 8. Open Questions for Construction Phase

| Item | Stage owning the decision |
|---|---|
| Lambda memory (MB) / timeout (s) / reserved concurrency | NFR Requirements (handler unit) |
| DynamoDB capacity mode (on-demand vs provisioned) | NFR Requirements (persistence unit) |
| CloudWatch alarm thresholds | NFR Requirements (handler + infrastructure units) |
| Concrete `UpdateExpression` strings for `content-hashes` writes | Functional Design (persistence unit) |
| Exact `cdk-nag` rule set + exemptions | Infrastructure Design (infrastructure unit) |
| Test fixture catalogue + which real binaries to commit | Code Generation (classifier-core + handler units) |
| PBT property catalogue per domain module | Functional Design (classifier-core unit) |
