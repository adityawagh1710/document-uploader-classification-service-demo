# Operations — Classification Service Test UI

> First non-placeholder OPERATIONS artifact. Delivered 2026-05-25.

## 1. Purpose

Interactive web dashboard that wraps `ClassificationService` for **two scenarios** beyond the design-stage Vitest suites:

| Scenario | Without the UI | With the UI |
|---|---|---|
| Operator wants to dogfood a real document against the classifier | Custom Node script + manual S3/DDB seed | Open browser → drag-drop file → see JSON result |
| Stakeholder reviews "what does this service do?" before deploy | Read U-1 Functional Design + run integration tests | Click through workspace seeder + classify form |
| On-call wants to reproduce a prod classification locally | Capture the SFN input + replay via SAM Local | Paste the same `TaskPayload` field values into the form |

The UI is **not** part of the deployed service. It is a maintenance + verification artifact, hosted alongside the source under `ui/`.

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (http://localhost:3000)                             │
│   └─ React dashboard (KPI tiles, classify form, history)     │
│        │ HTTP                                                 │
└────────┼─────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Next.js standalone server (container: classification-       │
│  service-ui:dev)                                             │
│   ├─ /api/classify  — multipart → S3 PUT → service.classify  │
│   ├─ /api/workspaces — GET/POST DDB workspace-config-ui      │
│   ├─ /api/health    — DDB ListTables probe                    │
│   └─ /api/stats     — in-memory KPI counters                  │
└────────┼─────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────┐
│  LocalStack 3.7.0 (container)                                │
│   ├─ S3:        classification-ui-bucket                     │
│   ├─ DDB:       content-hashes-ui, workspace-config-ui       │
│   └─ StepFn:    available but unused by the UI               │
└──────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Co-located API + UI** in one Next.js app (one image to ship)
- **Direct `ClassificationService.classify()` call** rather than invoking the Lambda handler — handler exists to bridge SFN callbacks; UI doesn't need that
- **Lazy idempotent resource provisioning** in `ui/lib/classifier.ts` → no manual `aws dynamodb create-table` step before the first request
- **LocalStack-by-default** with `AWS_ENDPOINT_URL` swap to point at real AWS when needed (IRSA documented in README §6)

## 3. Footprint

≈ 32 files under `ui/` (plus Cypress suite):

| Subtree | Purpose | Count |
|---|---|---|
| `ui/app/` | Next.js App Router + 6 API routes (classify / workspaces / health / stats / target / runs) + dashboard page | 9 |
| `ui/components/` | Dashboard, ClassifyForm, WorkspaceForm, KpiTile, Pill, **ResultPanel**, **LocalStackTarget** | 7 |
| `ui/lib/` | classifier wiring (auto-seed + checksum disable), stats store with failure tracking, cn helper | 3 |
| `ui/k8s/` | namespace + LocalStack + UI + Ingress manifests | 4 |
| `ui/cypress/` | Cypress 15 E2E suite — 5 specs + support + tsconfig | 8 |
| Config | package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, postcss.config.js, next-env.d.ts, cypress.config.ts | 7 |
| Containerization | Dockerfile, .dockerignore, docker-compose.yml | 3 |
| Docs + placeholders | README.md, app/globals.css, public/.gitkeep | 3 |

Image size: **157 MB** (Next.js standalone bundle on `node:20-alpine`).

## 3a. Capability bumps (post-initial-build)

| Capability | Initial | Now | How |
|---|---|---|---|
| Upload size cap | 25 MiB | **1 GiB** | `MAX_BYTES` in `app/api/classify/route.ts` |
| Upload memory profile | Full body in RAM (`Buffer.from(arrayBuffer)`) | **Streaming multipart** via `@aws-sdk/lib-storage` `Upload` (8 MiB parts × 4-way concurrency) | `Readable.fromWeb(file.stream())` |
| K8s pod memory | 256 Mi request / 512 Mi limit | **512 Mi request / 1 Gi limit** | `k8s/20-ui.yaml` |
| Workspace seeding | Manual via dashboard form | **Auto-seeded `wks-ui-001`** on cold start in `ensureResourcesProvisioned()` | LocalStack `PERSISTENCE=0` no longer leaves the form broken after restarts |
| LocalStack healthcheck | `grep -q '"s3": "available"'` (never matched LocalStack 3.7.0's `"running"` string) | `grep -qE '"s3": "(available|running)"'` for both s3 + dynamodb | `docker-compose.yml` |
| Recent results table | All entries on one page (capped at 25) | **Paginated** with Prev/Next + page-size selector (10/25/50); cap raised to 100 | `Dashboard.tsx` + `stats.ts` |
| QA entry point | Ad-hoc `npm run ...` commands | `make qa-ui` — Next tsc + Next lint + Cypress E2E (auto-starts compose if needed) | Root `Makefile` `[qa]` group |
| Result detail surface | Only the freshly-classified file's response panel in the form | **Click any row** in the recent table → dedicated Result panel below with classification metadata + DDB content-hash row + S3 object metadata | `Dashboard.tsx`, `ResultPanel.tsx`, `/api/runs/[documentId]` |
| Target visibility | Hidden behind `/api/health` JSON | **LOCALSTACK TARGET / AWS TARGET** info block — endpoint / region / bucket / table names. Label auto-flips based on `AWS_ENDPOINT_URL` | `LocalStackTarget.tsx`, `/api/target` |
| Failed runs | Counter only; never shown in table | First-class rows in recent table with SUCCESS/FAILED status pill + dedicated Failure reason column | `lib/stats.ts` `recordFailure(...)` + `formatFailureReason()` |

## 4. Three operational modes (see `ui/README.md`)

| Mode | Command | When |
|---|---|---|
| **A. Local dev** | `cd ui && npm install && npm run dev` (LocalStack via `docker run`) | Iterating on the UI itself; HMR |
| **B. Local Docker Compose** | `docker compose -f ui/docker-compose.yml up --build` | Container parity; verifies the image works |
| **C. Dev EKS** | `kubectl apply -f ui/k8s/` + port-forward or Ingress | Shared link for the team; smoke from cluster network |

## 5. SECURITY posture

The UI inherits SECURITY-baseline constraints from the service:

| Rule | Status | Notes |
|---|---|---|
| SEC-01 (no secrets in code) | ✅ | LocalStack creds are placeholders (`AWS_ACCESS_KEY_ID=test`) and only used in the test path |
| SEC-04 (least privilege) | N/A locally | For real-AWS use the README points at IRSA with dev-account read-only IAM |
| SEC-08 (no public endpoint) | Test-only | Compose binds to `localhost:3000`; K8s manifests use `Service type: ClusterIP` + optional internal ALB |
| SEC-12 (no PII handling) | ✅ | UI passes documents through to S3 the same way the deployed Lambda does — same trust boundary |

The UI is **not** part of the service's threat model — it exists in test environments only and should never be exposed to a production network.

## 6. Build + verification log (2026-05-25)

Iterative fixes during initial containerization:

| Issue | Fix |
|---|---|
| Webpack: `Module not found: ./Foo.js` for src/ files | `next.config.mjs` `resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }` |
| Webpack: `Module not found: @aws-sdk/...` from src/ | `resolve.modules` includes `ui/node_modules` |
| `tsc`: `Cannot find module @aws-sdk/lib-dynamodb` | Symlink `/workspace/node_modules → /workspace/ui/node_modules` inside Dockerfile builder |
| Missing service deps in UI image | Added `zod`, `file-type`, `@aws-lambda-powertools/*` to `ui/package.json` |
| `correlationIdPath does not exist` in PowertoolsLoggerAdapter | Narrowed `tsconfig.json` include — UI uses `silentLogger` only |
| `public/ not found` runtime stage COPY | Created `ui/public/.gitkeep` |

End-to-end smoke (in containers):

```
POST /api/workspaces  → seeded wks-docker-001
POST /api/classify    → format=pdf, tier=file-type, isDuplicate=false (129 ms)
POST /api/classify    → same file → isDuplicate=true (71 ms) ✓ dedup
GET  /api/stats       → total=2, errors=0, byTier={file-type:2}
GET  /api/health      → ready=true, latencyMs=9
```

## 6a. Cypress E2E suite (added 2026-05-25)

Three specs under `ui/cypress/e2e/` driven by `cd ui && npm run cypress:run` (headless) or `npm run cypress:open` (interactive). 14 tests total, all passing in ~5 s end-to-end against a live `docker compose -f ui/docker-compose.yml up` stack.

| Spec | Tests | What it covers |
|---|---|---|
| `01-smoke.cy.ts` | 1 | Dashboard renders; LocalStack reachable with ms-latency tile; auto-seeded `wks-ui-001` listed; classify button disabled until file picked |
| `02-per-tier.cy.ts` | 9 | One upload per detection tier (file-type PDF / file-type PNG / OLE2 / ZIP / text-heuristic HTML / text-heuristic EML / XML matched by Tier 1 / extension-fallback) + dedup round-trip with unique-per-run bytes |
| `03-failure-repro.cy.ts` | 4 | s3:unknown regression — synthetic PPTX shells at 2 KB / 500 KB / 5 MB + optional real `repro.pptx` (skipped unless a file is dropped into `ui/cypress/fixtures/`) |
| `04-pagination.cy.ts` | 1 | Seeds 11 unique classifications; verifies pagination shows up, Page 1 has 10 rows, Next/Prev advance correctly, increasing page size to 25 hides the controls |
| `05-result-panel.cy.ts` | 3 | LocalStack/AWS Target info block renders; clicking a row opens the Result panel with DDB lookup populated; recent table has new Status + Failure reason columns |

Implementation notes worth remembering:

- `cy.request` does **not** serialise `FormData` as multipart. All multipart posts go through a `cy.task('classifyMultipart')` registered in `cypress.config.ts` that uses native `fetch` (Node has working FormData).
- Cypress files share the `ui/` tsconfig namespace, so the parent's `**/*.ts` include picks them up at Next build time. Excluded under `ui/tsconfig.json` `exclude: ["node_modules", "cypress", "cypress.config.ts"]`; Cypress has its own standalone tsconfig (no `extends`) at `ui/cypress/tsconfig.json`.
- For files > a few hundred KB, the `btoa(String.fromCharCode(...bytes))` pattern overflows the call stack — chunked encoder in each spec processes 32 KiB at a time before `btoa`.

## 6b. Bug found via Cypress + fixed (2026-05-25)

**Symptom**: `POST /api/classify` returned `{kind: "s3", reason: "unknown"}` for ~all real uploads (small ones occasionally slipped through). Adapter logged only `errorCode: 'unknown', sdkErrorName: 'Error'` — actual cause hidden by `mapS3Error`'s fallthrough and `silentLogger`.

**Root cause** (surfaced by a `debugS3Reader` in `ui/lib/classifier.ts` that bypasses the adapter and wraps body iteration in try/catch with full error logging):

```
Checksum mismatch:
  expected "WNr5qw==" but received "7A+hUQ=="
  in response header "x-amz-checksum-crc32".
    at ChecksumStream._final
       (/app/ui/node_modules/@smithy/core/dist-cjs/submodules/serde/index.js:1020:33)
```

AWS SDK v3.730+ enforces CRC32 response checksum validation by default. The UI bumped to **3.1053.0** during the vulnerability remediation. LocalStack stores its own checksums that don't match the bytes it serves back when objects were written via `@aws-sdk/lib-storage` multipart `Upload`. The SDK aborts the response stream mid-read; the resulting plain `Error` (name = `"Error"`) doesn't match any of `mapS3Error`'s named branches; falls through to `"unknown"`.

**Why integration tests didn't catch it**: `tests/integration/handler/_orchestrator-setup.ts` uploads via plain `PutObjectCommand` with a `Buffer` — no multipart, so LocalStack computes a checksum that matches what it serves back. The bug is triggered specifically by the `lib-storage` Upload path the UI uses.

**Fix** in `ui/lib/classifier.ts`:

```ts
export const s3Client = new S3Client({
  ...
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
});
```

Scope of impact:

- **Deployed Lambda**: not affected — uses the unmodified `src/adapters/s3/S3Adapter.ts` against real AWS S3 (which always returns valid checksums) and reads via plain `GetObjectCommand`. No code change needed for production.
- **Integration tests**: not affected — see above.
- **UI only**: requires the LocalStack-compatibility flags on its own S3Client instance.
- **Test gate**: `ui/cypress/e2e/03-failure-repro.cy.ts` now serves as the regression gate for this specific failure mode.

## 7. Open follow-ups

1. **Push the image to a registry** — `ui/k8s/20-ui.yaml` uses placeholder `IMAGE_REGISTRY/classification-service-ui:dev`. Operator must `sed` in the real ECR/GHCR URL before `kubectl apply`.
2. ~~**Healthcheck refinement**~~ — fixed 2026-05-25; pattern now accepts both `"available"` and `"running"` for s3 and dynamodb. LocalStack container reports `(healthy)`.
3. ~~**Re-validation on bumped deps**~~ — done 2026-05-25T15:30. All 6 checks pass (`typecheck` / `lint` / `test:unit` 160 / `test:pbt` 31 / `test:infra` 28 / `cdk synth` dev+staging+prod). Two real Lambda-runtime bugs were prevented from reaching production. See `aidlc-docs/audit.md` entry "Re-validation of Bumped Dep Stack".
4. **Optional: companion images** — when the Lambda is ever containerized (e.g. for SnapStart experiments), use `classification-service-lambda:dev` to keep the naming pattern.
5. ~~**Clean up `debugS3Reader` instrumentation**~~ — done 2026-05-25; reverted to `silentLogger` + `s3Adapter` from `src/`. The LocalStack checksum-disable on the S3Client stays. Route-level `console.error` on `!result.ok` retained for operational visibility. All 14 Cypress tests still passing.
6. **Consider mirroring the checksum-disable into integration test setup** — if the integration tests ever switch to `lib-storage` uploads (e.g. to exercise the multipart code path), they'll hit the same bug. Documenting here so future test authors don't relearn it.

## 8. Why this lives in OPERATIONS, not CONSTRUCTION

- The UI is **not a deliverable** of the AI-DLC workflow — it is a maintenance + verification surface added after the workflow completed.
- It does **not** participate in the deploy pipeline — the deploy artifact remains the CDK-synthed Lambda + observability stacks per `aidlc-docs/construction/build-and-test/build-and-test-summary.md`.
- It depends on the same `src/` domain code, so changes to the classifier are reflected here automatically without re-running INCEPTION/CONSTRUCTION stages.
