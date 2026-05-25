# AI-DLC State Tracking

## Project Information
- **Project Name**: Classification Service
- **Project Type**: Greenfield
- **Start Date**: 2026-05-22T00:00:00Z
- **Current Stage**: OPERATIONS (placeholder workflow, but with real maintenance + tooling artifacts as of 2026-05-25)
- **Completion Date**: 2026-05-22T00:00:00Z (AI-DLC workflow); 2026-05-25 (operations tooling)

## Workspace State
- **Existing Code**: No
- **Programming Languages**: N/A (greenfield; target runtime is Node.js per technical_input.md §6)
- **Build System**: N/A
- **Project Structure**: Empty (technical input only)
- **Reverse Engineering Needed**: No
- **Workspace Root**: /home/adityawagh/opus2-workspace/classification-service

## Inputs Provided
- `technical_input.md` — comprehensive functional + non-functional spec for the Classification Service

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only
- **Structure patterns**: See code-generation.md Critical Rules

## Extension Configuration
| Extension | Enabled | Decided At |
|-----------|---------|------------|
| security-baseline | Yes | Requirements Analysis (Q16=A) |
| property-based-testing | Yes | Requirements Analysis (Q17=A) |

## Stage Progress
### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [x] Reverse Engineering (N/A — greenfield)
- [x] Requirements Analysis
- [x] User Stories (approved)
- [x] Workflow Planning (approved)
- [x] Application Design (approved)
- [x] Units Generation (approved)

### 🟢 CONSTRUCTION PHASE — Per-Unit Loop

#### Unit 1: classifier-core (IN PROGRESS)
- [x] Functional Design (approved)
- [x] NFR Requirements (approved)
- [x] NFR Design (approved)
- [x] Infrastructure Design (approved)
- [x] Code Generation (approved)

#### Unit 2: persistence (IN PROGRESS)
- [x] Functional Design (approved)
- [x] NFR Requirements (approved)
- [x] NFR Design (approved)
- [x] Infrastructure Design (approved)
- [x] Code Generation (all 22 steps executed; 26 files generated/updated; awaiting stage approval)
#### Unit 3: handler (IN PROGRESS)
- [x] Functional Design (approved)
- [x] NFR Requirements (approved)
- [x] NFR Design (approved)
- [x] Infrastructure Design (approved)
- [x] Code Generation (all ~40 steps executed; ~45 files generated/updated; awaiting stage approval)
#### Unit 4: infrastructure (IN PROGRESS)
- [x] Functional Design (approved)
- [x] NFR Requirements (approved)
- [x] NFR Design (approved)
- [x] Infrastructure Design (approved)
- [x] Code Generation (all 21 steps executed; 21 files generated/updated across 7 phases; awaiting stage approval)

### 🟢 CONSTRUCTION PHASE (per-unit loop × 4 units)
- [x] Functional Design (per unit) — EXECUTE
- [x] NFR Requirements (per unit) — EXECUTE
- [x] NFR Design (per unit) — EXECUTE
- [x] Infrastructure Design (per unit) — EXECUTE
- [x] Code Generation (per unit) — EXECUTE (always)
- [x] Build and Test — EXECUTE (5 instruction files generated; awaiting stage approval)

### 🟡 OPERATIONS PHASE
- [x] Operations — PLACEHOLDER (entered; awaiting future workflow expansion)

#### Operations Tooling Delivered (2026-05-25)
- [x] `LOCAL_TESTING.md` at repo root — developer-facing LocalStack + SAM Local guide (two modes, troubleshooting, CI-parity checklist)
- [x] `ui/` — Next.js 14 test dashboard (29 files + 3 Cypress specs) — local dev + Docker Compose + dev EKS modes
- [x] Docker image: `classification-service-ui:dev` (157 MB) — multi-stage Next standalone bundle
- [x] K8s manifests under `ui/k8s/` — namespace + in-cluster LocalStack + UI Deployment/Service + optional ALB Ingress; container memory 1 GiB to match upload cap
- [x] Containerization end-to-end verified — `docker compose -f ui/docker-compose.yml up` produces a working stack
- [x] Default workspace auto-seeded on cold start — `wks-ui-001` written during lazy provisioning so the UI just works after a `docker compose down`/`up`
- [x] Upload cap 1 GiB via streaming multipart (`@aws-sdk/lib-storage` Upload, 8 MiB parts × 4-way concurrency) — verified at 50 MiB with 101 MiB container RSS
- [x] Cypress 15 E2E suite (5 specs / 18 tests) at `ui/cypress/` — smoke + per-tier + s3:unknown regression + recent-table pagination + result-panel/target. Run via `cd ui && npm run cypress:run`. All passing in ~8 s
- [x] Recent classifications table paginated — client-side Prev/Next + page-size selector (10/25/50); in-memory cap 25 → 100; auto-resets to page 1 on new classification; controls hide when results fit on one page
- [x] Clickable recent rows + `/api/runs/[documentId]` route — selected row opens a Result panel below the table showing classification metadata + the actual DDB content-hash row + S3 object metadata. Modeled on `zip-extraction-dev-sandbox` reference dashboard
- [x] LocalStack/AWS Target info block + `/api/target` route — labeled endpoint / region / bucket / DDB table names so operators see at-a-glance which AWS surface the UI is pointed at (label flips LOCALSTACK ↔ AWS based on `AWS_ENDPOINT_URL`)
- [x] Failure tracking + Status / Failure-reason columns — `recordFailure(...)` in `lib/stats.ts` now inserts failed runs into `recent[]` with a flattened one-line reason string; table renders SUCCESS/FAILED pill + dedicated Failure reason column
- [x] Form placeholders polished — format hints in workspaceId, extension, contentType inputs; "newest first, max 100" caption + "updated HH:MM:SS · N runs" in section header
- [x] Makefile QA section — new `[qa]` target group: `audit` / `audit-strict` / `audit-report` / `outdated` / `security` / `qa-ui` (Cypress + Next lint + tsc) / `qa-quick` / `qa` (full gate: lint + typecheck + audit + unit + pbt + infra + synth). Mirrors the pattern from `aspose-total/Makefile`. Surfaced two real fixes: dead `subCategoryGen` in PBT generator + `exactOptionalPropertyTypes` incompatibility with `aws-cdk-lib` 2.257.0 (disabled for `infra/tsconfig.json` only)
- [x] Repo-root `.dockerignore` + `ui/.gitignore` added; root `.gitignore` extended for `.next/` + Cypress artifacts; root README extended with `ui/` + LOCAL_TESTING.md + `make qa` flow
- [x] Operations summary: see `aidlc-docs/operations/test-ui.md`

#### Bugs Found by the Test UI (2026-05-25)
- [x] **AWS SDK ↔ LocalStack checksum mismatch** — SDK v3.730+ enforces CRC32 response validation; LocalStack returns checksums that don't match the bytes it serves back when objects were written via `lib-storage` multipart Upload. Surfaced via UI multipart uploads; integration tests don't trip it (they use plain `PutObjectCommand` with a Buffer, no multipart). Patched UI-side by setting `responseChecksumValidation: "WHEN_REQUIRED"` and `requestChecksumCalculation: "WHEN_REQUIRED"` on `ui/lib/classifier.ts`'s S3Client. Deployed Lambda unaffected (single-part PutObjects against real AWS S3).

#### Maintenance Changes (2026-05-25)
- [x] Test infrastructure fix: vitest `globalSetup` migrated from `globalThis` mutation to `provide()`/`inject()` API (affected 22 integration tests)
- [x] AC-10 test fixture fix: replaced `[0xff,0xfe,0x00,0x01]` (which `file-type` matches as MP1) with `[0x00,0x01,0x02,0x03,0x04,0x05]` so the macro-quarantine branch is actually exercised
- [x] Dependency security: 33 vulns → 1 remaining (bundled-only inside aws-cdk-lib). Pin bumps: AWS SDK 3.654.0 → 3.1053.0; aws-cdk-lib 2.158.0 → 2.257.0; aws-cdk CLI → 2.1124.1; constructs → 10.5.1; vitest ^1.6.0 → ^3.2.0; testcontainers ^10.13.0 → ^12.0.0; eslint-plugin-boundaries ^4.2.0 → ^6.0.2; file-type 21.0.0 → 21.3.4
- [x] Re-validation on new dep stack complete (2026-05-25T15:30) — all 6 checks pass: `typecheck` (clean), `lint` (clean), `test:unit` (160/160), `test:pbt` (31/31), `test:infra` (28/28), `cdk synth` (dev + staging + prod all synthesize). Real bugs caught:
  - Powertools Logger v2 API breakage in `src/adapters/powertools/PowertoolsLoggerAdapter.ts` (used by deployed Lambda — would have crashed at first invocation)
  - PBT-U3-004 invariant gap in `tests/pbt/generators/handler.gen.ts` (fast-check 3.19+ exposed an over-permissive generator that was passing by luck)
  - CDK 2.176+ `Topic.fromTopicArn` ARN validation rejecting the SSM-lookup placeholder on first synth (`infra/lib/observability-stack.ts`)
  - CDK 2.176+ stack `env` requirement on context-provider lookups (`infra/lib/_test-helpers.ts` + observability-stack test helper)
  - `logRetention` prop now installs a helper Lambda → `lambda-stack.test.ts` assertion + new cdk-nag suppressions
  - cdk-nag IAM5 finding-key now resolves intrinsic refs; tokenized + resolved patterns both needed in `appliesTo`
  - Lambda Insights managed policy missing from IAM4 suppression (staging/prod only)

## Proposed Unit Decomposition
1. **classifier-core** — pure detection logic (no AWS deps)
2. **persistence** — DynamoDB (`content-hashes`, `workspace-config`)
3. **handler** — Lambda entry, S3 IO, streaming hash, Step Function callbacks, observability
4. **infrastructure** — IaC for Lambda + DynamoDB + IAM + VPC + CloudWatch + X-Ray

## Stage Progress Table
| Stage | Status | Notes |
|-------|--------|-------|
| Workspace Detection | Completed | Greenfield confirmed |
| Reverse Engineering | Skipped | Greenfield |
| Requirements Analysis | Completed | 23 questions answered; requirements.md generated; extensions opted in |
| User Stories | Completed (approved) | 6 personas + 28 stories; full traceability matrix |
| Workflow Planning | Completed (approved) | execution-plan.md generated; 4-unit decomposition; all conditional Construction stages set to EXECUTE |
| Application Design | Completed (approved) | 5 artifacts generated; 28 components across hexagonal layers |
| Units Generation | Completed (awaiting approval) | 3 artifacts: unit-of-work.md, unit-of-work-dependency.md, unit-of-work-story-map.md. All 28 stories assigned; dependency matrix validated acyclic; consistent with hexagonal layer rules |
