# Monorepo Layout Refactor — Plan (Plan A) · FOR APPROVAL

**Status:** Plan only — no moves executed yet.
**Branch:** `refactor/monorepo-layout` (cut from `feat/ingestion-go-router`, so it carries the router/contracts/UI-GraphQL work).
**Goal:** migrate the existing classification service (sprawled at repo root) into the `units/<id>/` + `libs/` layout, so the whole repo matches `units/wundergraph-router` + `libs/pipeline-contracts` and the binding monorepo decision.

---

## ⚠️ Key finding from recon (this shapes everything)

`ui/` is **not** a pure frontend. Its Next.js API routes import classification's core deeply:

```
@svc/* → ../src/*   (used in ui/app/api/*, ui/lib/*, ui/components/*):
  @svc/adapters/{crypto,dynamo-content-hashes,dynamo-workspace-config,s3,sqs-archive-dispatcher,sqs-convert-dispatcher}
  @svc/application/index · @svc/domain/{categories,scoring,slipsheet} · @svc/shared/*
```

So **`ui/` + `src/` are one fused frontend+backend.** Two consequences:

1. **You cannot cleanly split `ui/` into a pure `react-web-module` unit** without first decoupling the API routes from `src/` — that's a *feature* effort (the real react-web-module talks GraphQL to the router; our P5 `/ingestion` page is the seed of that), **not a folder move**.
2. Therefore, for *this* layout refactor, **`classification-service` is ONE unit** containing `src/ + worker/ + ui/ + infra/ + tests/`. A separate `react-web-module` is a **future decoupling**, deliberately out of scope here.

> Bonus: moving `ui/` and `src/` *together* into `units/classification-service/` keeps the `@svc/* → ../src/*` alias valid as-is (both stay in the same unit) — far less rewiring than splitting them.

---

## Target layout

```
document-uploader (= classification-service-demo)/
├── aidlc-docs/                     (stays — repo-level docs)
├── CLAUDE.md                       (stays — project AIDLC workflow)
├── libs/
│   └── pipeline-contracts/go       (exists)
├── units/
│   ├── wundergraph-router/         (exists)
│   └── classification-service/     ← src · worker · ui · infra · tests · deploy
│                                     · package.json · tsconfig · vitest.config
│                                     · cdk.json · cdk.context.json · template.yaml
│                                     · Dockerfile.lambda · docker-compose.yml
│                                     · .dockerignore · LOCAL_TESTING.md · Makefile · scripts
├── tools/ci/                       (NEW — path→unit map)
├── pnpm-workspace.yaml / go.work   (NEW — workspace wiring)
├── CODEOWNERS                      (NEW)
└── (POC docs: WunderGraph_Router_POC_Plan.md, etc.)
```

Stays at root: `aidlc-docs/`, `CLAUDE.md`, `libs/`, `units/`, the POC docs, `technical_input.md`, `New_Microservice_Tech_Input.md`.
The `ingestion-service/` TS scaffold (untracked) is superseded by the Go router — delete or move under `units/` as a separate decision.

---

## Move map + rewiring (what breaks, what to fix)

| Move | Internal paths | Outer references to rewire |
|---|---|---|
| `src/`,`worker/`,`tests/`,`ui/`,`infra/`,`deploy/`,`scripts/` → `units/classification-service/` | `@svc/*`,`@/*` aliases **unchanged** (whole tree moves together) | — |
| root `package.json`,`tsconfig.json`,`vitest.config.ts` → unit | scripts keep working in-unit | root becomes workspace manager (`pnpm-workspace.yaml`) |
| `cdk.json`,`cdk.context.json`,`template.yaml`,`infra/` (CDK app) → unit | CDK `app` entry relative | **deployed service** — re-verify `cdk synth`; deploy scripts paths |
| `Dockerfile.lambda`, `docker-compose.yml`, `ui/Dockerfile`, `.dockerignore` → unit | build `context: .` → now the unit dir | image build contexts (compose `context`, CI build paths) |
| `deploy/helm/{classification-ui,convert-worker}`, `deploy/iam` → unit | — | chart image-build paths; any `ui/`/`src/` refs in chart values |

**No cross-unit imports introduced** — `classification-service` stays self-contained; it does **not** import `units/wundergraph-router` or vice-versa (they'd share `libs/` only).

---

## Phased execution (each phase verified before the next; await approval to start)

1. **Workspace wiring** — add `pnpm-workspace.yaml` (packages: `units/*`, `libs/*/ts` if any) + keep `go.work` for Go units. No moves yet. *Verify: existing builds still green.*
2. **Wholesale move** — `git mv` the classification tree (src/worker/ui/infra/tests/deploy/scripts + root configs) into `units/classification-service/`. *Verify: nothing references old root paths (grep).* 
3. **Rewire outer refs** — `docker-compose.yml` contexts, `.dockerignore`, CDK app path, deploy chart build paths. *Verify per below.*
4. **`tools/ci/` path→unit map + `CODEOWNERS` + root README.**

## Verification checklist (gate each phase; all must be green before merge)

- `units/wundergraph-router`: `go vet` + `go build` + the LocalStack e2e still pass.
- `libs/pipeline-contracts/go`: `go test`.
- `units/classification-service`: `npm run build` · `typecheck` · `test` · **`cdk synth`** (deployed CDK app).
- `units/classification-service/ui`: `npm run build` (Next).
- `docker build` of the lambda image, the ui image, the router image.
- `helm lint` + `template` on all charts.
- `grep` for stale root-path references (`./src`, `ui/`, `../src`) outside the unit.

## Risks

- **Deployed service (dev05).** The CDK app + deploy charts move; deploy paths change. Must re-verify `cdk synth` + chart render; dev05 redeploy will use the new paths (coordinate with the P7 router deploy).
- **Big surface, one branch.** Keep all moves on `refactor/monorepo-layout`; don't merge until every checklist item is green. Each phase is revertible.
- **`ui` fusion** (above) — accepted: `classification-service` is one unit for now; `react-web-module` decoupling is future.

## Decision needed before I execute

1. Confirm **`classification-service` = one unit (incl. `ui/`)**, and `react-web-module` split is deferred. (Recommended — matches the code reality.)
2. Confirm OK to **move the deployed CDK app** (`infra/`, `cdk.json`, `template.yaml`) into the unit and re-verify `cdk synth` (vs. leaving infra at root).
3. Workspace tool: **pnpm workspace** at root for the TS units (per tech-environment.md), alongside `go.work` for Go — OK?

On approval I'll execute phase-by-phase with the verification gates above.
