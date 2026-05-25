# Unit-of-Work Dependencies — Classification Service

> Unit-to-unit dependency relationships, build vs runtime distinction, sequencing, and consistency check against the hexagonal layer rules in `component-dependency.md`.

---

## 1. Unit Dependency Matrix

A `✓` means the row depends on the column. `cross-cutting` refers to the unit-less `src/ports/` + `src/shared/` (per Q2=B).

| ⬇ depends on / target ➡ | U-1 classifier-core | U-2 persistence | U-3 handler | U-4 infrastructure | cross-cutting |
|---|:---:|:---:|:---:|:---:|:---:|
| **U-1 classifier-core** | — | ✗ | ✗ | ✗ | ✓ |
| **U-2 persistence**     | ✗ | — | ✗ | ✗ | ✓ |
| **U-3 handler**         | ✓ | ✓ | — | ✗ | ✓ |
| **U-4 infrastructure**  | ✗ | ✗ | (build-time only; references handler artifact path) | — | ✗ |
| **cross-cutting**       | ✗ | ✗ | ✗ | ✗ | — |

Key observations:
- **U-1 and U-2 do not depend on each other.** They can be developed in parallel.
- **U-3 (handler)** is the *only* runtime composition point — it depends on U-1 and U-2 to wire them through ports.
- **U-4 (infrastructure)** has no runtime dependency on the application code. At build time, the CDK stack references the bundled Lambda artifact path (the output of building U-1 + U-2 + U-3), but it never imports application TypeScript.
- **No cycles.** The matrix is a DAG. Hexagonal boundaries enforce acyclicity structurally.

---

## 2. Mapping to Hexagonal Layer Rules

Unit-level dependencies must be consistent with the layer rules in `component-dependency.md` §1. Validation:

| Unit dependency | Resolves to layer-level | Allowed by layer matrix? |
|---|---|---|
| U-3 handler → U-1 classifier-core | application → domain | ✓ allowed |
| U-3 handler → U-2 persistence | handler-entry → adapters | ✓ allowed (only handler-entry can import adapters) |
| U-3 handler → cross-cutting (ports) | handler-entry → ports | ✓ allowed |
| U-3 handler → cross-cutting (shared) | all layers → shared | ✓ allowed |
| U-2 persistence → cross-cutting (ports) | adapters → ports | ✓ allowed (adapters implement ports) |
| U-1 classifier-core → cross-cutting (shared) | domain → shared | ✓ allowed |
| U-1 classifier-core → cross-cutting (ports) | domain → ports | ✓ NOT typical, but allowed for ports the domain *consumes* (none in our design today; left open if needed) |

Result: the unit dependency matrix is a strict refinement of the layer matrix. ESLint boundary rules enforce both.

---

## 3. Build-Time vs Runtime Dependencies

| Dependency edge | Type | Notes |
|---|---|---|
| U-3 → U-1 | Runtime + Build | `ClassificationService.classify` calls into domain modules at runtime; TypeScript compile pulls them in |
| U-3 → U-2 | Runtime + Build | `ClassificationService` consumes `ContentHashStore` and `WorkspaceConfigStore` (implemented by U-2 adapters), wired in `lambda.ts` |
| U-3 → cross-cutting | Runtime + Build | Ports + shared types |
| U-1 → cross-cutting | Build only | `Result<T,E>` and type aliases — compile-time imports; no runtime calls (pure types) |
| U-2 → cross-cutting | Runtime + Build | Same `Result<T,E>` (used in return types of port methods) |
| U-4 → (U-3 bundle path) | Build only | CDK references `dist/handler.zip` (or equivalent bundling output). U-4 does NOT import any TypeScript from `src/`. |
| U-4 → cross-cutting | None | CDK has its own `infra/lib/` with no shared imports |

---

## 4. Recommended Construction Sequence

```
            ┌──────────────────────────┐
            │  U-1 classifier-core      │ ◀── start here (no upstream deps)
            └────────────┬──────────────┘
                         │
                         │  parallel with U-2
                         │
            ┌────────────┴──────────────┐
            │  U-2 persistence          │ ◀── parallel with U-1 (no shared deps)
            └────────────┬──────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │  U-3 handler              │ ◀── depends on U-1 + U-2 (composes them)
            └────────────┬──────────────┘
                         │
                         │  parallel with U-3 once IAM scope is known
                         │
            ┌────────────┴──────────────┐
            │  U-4 infrastructure       │ ◀── deploys the U-3 bundle
            └──────────────────────────┘
```

**Recommended ordering for the per-unit Construction loops:**

1. **U-1 classifier-core** — first. No deps; pure logic; PBT-heavy. Builds the test culture (Vitest + fast-check setup) used by all subsequent units.
2. **U-2 persistence** — second (or in parallel with U-1 if separate developers/instances). Adapter-only; integration tests against LocalStack.
3. **U-3 handler** — after U-1 and U-2 are at least partially complete. Composes them; integration tests cover all 11 ACs.
4. **U-4 infrastructure** — last (or in parallel with U-3 once the Lambda IAM scope is known). CDK + `cdk-nag` + observability wiring.

**Parallelism opportunities:**
- U-1 and U-2 are fully independent at the code level — different developers can own them.
- U-4 can start once U-3's IAM needs are documented (typically as soon as U-3's Functional Design is complete).
- Within each per-unit loop, the Construction stages (Functional Design → NFR Requirements → NFR Design → Infrastructure Design → Code Generation) are strictly sequential per the per-unit gates.

---

## 5. Risk & Rollback Notes per Dependency Edge

| Edge | Risk | Rollback |
|---|---|---|
| U-3 → U-1 | If `Tier2OLE2Detector` (U-1) drifts from its declared `Tier2OLE2Result` type, U-3's compile breaks. **Caught at build.** | Pin U-1's API surface in `component-methods.md`; revert the U-1 change. |
| U-3 → U-2 | If `DDBContentHashAdapter` (U-2) deviates from `ContentHashStore` port, U-3's compile breaks. **Caught at build.** | Pin port surface; revert U-2 change. |
| U-3 → cross-cutting | A `Result<T,E>` API change ripples to every unit's compile. **High blast radius.** | Treat `src/shared/result.ts` as locked; changes require cross-unit review. |
| U-4 → U-3 bundle | If the Lambda bundle output path changes (e.g., from `dist/handler.zip` to a custom name), CDK synth fails. **Caught at build.** | Pin the bundle path in `package.json` script + CDK; revert. |

The blast radius of `cross-cutting` changes is the largest, which is why the `cross-cutting` label was created (per Q2=B) — it serves as a forcing function for review.

---

## 6. Anti-Patterns to Avoid (caught by ESLint boundary rules)

| Anti-pattern | What goes wrong | Detected by |
|---|---|---|
| U-1 `classifier-core` directly imports from U-2 `persistence` | Pure-logic unit becomes coupled to DynamoDB; unit tests start needing LocalStack | `eslint-plugin-boundaries` rule: `domain` cannot import from `adapters` |
| U-2 `persistence` imports from U-3 `handler` | Inverts dependency direction; persistence adapter becomes orchestrator-aware | `eslint-plugin-boundaries` rule: `adapters` cannot import from `handler-entry` or `application` |
| U-1 imports `@aws-sdk/client-s3` | Domain becomes I/O-aware; PBT tests need mocks | `no-restricted-imports` rule on AWS SDK packages in `domain/**` |
| U-4 `infra/` imports from `src/application/ClassificationService` | CDK build pulls in runtime code; bundle size explodes | Separate `infra/tsconfig.json` excludes `src/` |
| Circular dep U-3 ↔ U-1 (e.g., classifier-core needs a Logger from handler) | Build break or runtime confusion | Solution: `Logger` lives in `src/ports/` (cross-cutting); classifier-core depends on the port, not on handler |

All five patterns above are explicitly blocked by the ESLint configuration in `component-dependency.md` §6.

---

## 7. Validation Summary (Phase 4 checks)

- [x] B4. No orphan stories — every story in `stories.md` has an owner in `unit-of-work-story-map.md`.
- [x] B5. No orphan units — every unit U-1..U-4 has at least one story (audit in `unit-of-work-story-map.md`).
- [x] B6. Dependency matrix is acyclic — Section 1 above is a DAG; no cycle exists between U-1, U-2, U-3, U-4.
- [x] B7. Unit dependencies are consistent with hexagonal layer rules — Section 2 above maps each unit edge to a layer edge that is allowed by `component-dependency.md` §1.
