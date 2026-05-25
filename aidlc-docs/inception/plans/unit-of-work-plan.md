# Unit-of-Work Plan — Classification Service

> Part 1 — Planning. Most unit decomposition decisions are already locked in by `execution-plan.md` and the Application Design artifacts (4 units, hexagonal layout, single deployable). This plan asks the few remaining decomposition-specific questions, then drives the generation of three artifacts in Part 2.

---

## A. Planning Questions

All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

### Question 1 — Final unit count and naming
Confirm the 4-unit decomposition from `execution-plan.md` §4?

A) **Confirm 4 units**: `classifier-core`, `persistence`, `handler`, `infrastructure`.

B) **Merge `persistence` and `handler`** into a single unit (since they're co-deployed in the same Lambda). 3 units total.

C) **Split `infrastructure` into `infrastructure-data` (DDB) and `infrastructure-runtime` (Lambda+observability)**. 5 units total.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The 4-unit split is already validated in `execution-plan.md` and `application-design.md` §3. It gives clean per-unit Construction loops where each unit has a clear FR/NFR ownership profile and distinct test tiers (`classifier-core` = unit + PBT; `persistence` = integration; `handler` = integration + smoke; `infrastructure` = CDK snapshot + integration). Merging persistence+handler (B) would conflate pure adapter logic with orchestration and dilute the hexagonal seam. Splitting infrastructure (C) is over-decomposition — one CDK package per service is the canonical pattern.

### Question 2 — Where do `shared/` and `ports/` live in terms of unit ownership?
Cross-cutting code (`src/shared/` for `Result<T,E>`, type aliases; `src/ports/` for port interfaces) is consumed by multiple units. Which unit *owns* it?

A) **`classifier-core` owns `shared/` and `ports/`** — they originate as part of the domain modelling. Other units consume them. (Trade-off: classifier-core ends up bigger than its name suggests.)

B) **Separate `shared` and `ports` are unit-less** — they live at the root of `src/` and don't belong to any single unit. The team that touches them files a PR labelled `cross-cutting`. (Trade-off: harder to assign maintenance ownership.)

C) **`handler` owns `shared/` and `ports/`** — handler is the unit that composes everything, so it's the natural owner. (Trade-off: domain code becomes "consumer" of port interfaces conceptually owned by handler — unintuitive.)

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: `shared/` and `ports/` are cross-cutting by design. Forcing them into one unit's ownership creates artificial coupling (option A makes classifier-core a dumping ground; C inverts the hexagonal dependency direction). Option B is the standard hexagonal answer: ports and shared types live at the root, are treated as architecturally significant, and PRs touching them flag cross-unit impact in code review. The ESLint boundary rules (Q10=A from Application Design) already restrict who can import what, so ownership is enforced structurally rather than by naming.

### Question 3 — Story-to-unit assignment when stories span multiple units
A story like US-DI-002 ("avoid being charged twice") spans `classifier-core` (no role), `persistence` (the conditional write), and `handler` (the orchestration). Which unit "owns" such a story for purposes of progress tracking?

A) **Owner = the unit where the *acceptance test* lives** (typically the unit with the highest-level component touched). US-DI-002 → owned by `handler` because the AC asserts end-to-end behaviour that only the orchestrator can satisfy.

B) **Owner = the unit with the *most* code involved**. Subjective; can change as code evolves.

C) **Each story has multiple owners** (a "primary" and one or more "contributing" units). More accurate but heavier to track.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Acceptance criteria are the source of truth for "done" — the unit where the AC test runs is the natural owner. For end-to-end stories like US-DI-002, the orchestration lives in `handler`, the integration test lives under `tests/integration/`, and `handler` carries the story to completion. Lower-level units contribute the pure-logic + adapter tests required to make the AC test pass, but they don't own the story. Option C (multi-ownership) adds tracking overhead without clarifying who's accountable.

### Question 4 — Inter-unit contract testing
Beyond the four existing test tiers (unit / PBT / integration / smoke), do we need explicit inter-unit contract tests (e.g., consumer-driven contracts between `handler` ↔ `persistence`)?

A) **No separate contract tests** — the port interface definitions (TypeScript types in `src/ports/`) are the contract; the compiler catches drift. Integration tests at the adapter layer prove the contract holds against real AWS resources via LocalStack.

B) **Add Pact (or similar) consumer-driven contracts** — explicit `.json` contract files; a generated test broker. Better for distributed services where consumers and providers ship separately. Heavyweight for an in-process single Lambda.

C) **Add lightweight type-level contract assertions** (`expect-type`, `ts-toolbelt`) — compile-time checks that adapter implementations satisfy port interfaces. Cheap; catches subtle type drift.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Inside a single deployable, the TypeScript compiler IS the contract test. Every adapter is declared as `S3Reader & S3Streamer` (or similar); if the adapter drifts from the port, `tsc` fails. Pact-style contracts (B) are designed for service boundaries where consumer and provider ship independently and need versioned contracts on the wire — not our situation. Type-level assertions (C) are nice-to-have but add a maintenance surface; the basic TS compile + integration tests give us the same coverage. Note: if `persistence` is ever extracted into a separate deployable, revisit this.

### Question 5 — Versioning and release strategy
How are units versioned and released?

A) **Single version for the whole service** (one `version` in `package.json`, one git tag per release). All four units ship together because the Lambda + CDK are co-deployed.

B) **Per-unit semver via Lerna/Changesets** — each unit publishes its own version. Required if any unit is ever published to npm independently.

C) **No versioning** — git SHA is the source of truth; deployments tagged in CDK metadata.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: We are a single deployable Lambda; per-unit semver (B) adds publishing infrastructure for zero benefit (we never publish anything to npm). A single `package.json` version aligned with git tags is the simplest reliable scheme. `cdk synth` stamps the version into Lambda metadata so deployments are traceable to git tags. Option C (git SHA only) is fine for purely internal services but a `version` field aids human communication ("we're on 1.4.0") and CHANGELOG generation.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — Unit Definitions
- [x] B1. Create `aidlc-docs/inception/application-design/unit-of-work.md`:
  - List 4 units with name, purpose, owning hexagonal layers, components in scope, FRs/NFRs in scope, primary test tier
  - Greenfield code-organisation strategy (single `package.json`, source tree at `src/{domain,ports,adapters,application,handler,shared}` + `infra/` + `tests/`)
  - Notes about cross-cutting `shared/` + `ports/` ownership (Q2=B)
  - Story-ownership rule (Q3=A) for progress tracking
  - Inter-unit contract testing approach (Q4=A)
  - Versioning strategy (Q5=A)

### Phase 2 — Dependency Matrix
- [x] B2. Create `aidlc-docs/inception/application-design/unit-of-work-dependency.md`:
  - Unit-to-unit dependency matrix (who imports/calls whom)
  - Build-time vs runtime distinction
  - Recommended construction sequence with parallelism opportunities
  - Risk + rollback notes per dependency edge
  - Map between **hexagonal layer dependencies** (from `component-dependency.md`) and **unit dependencies** so the relationship is unambiguous

### Phase 3 — Story-to-Unit Mapping
- [x] B3. Create `aidlc-docs/inception/application-design/unit-of-work-story-map.md`:
  - All 28 stories from `stories.md` assigned to a single primary owner unit (per Q3=A)
  - For each story, list contributing units (the units whose code is touched even though they don't "own" the AC)
  - Coverage audit: ensure every unit has stories; ensure every story has exactly one owner; ensure stories that own AC integration tests are clearly identified
  - Group view: per-unit story lists (for sprint/iteration planning)

### Phase 4 — Validation
- [x] B4. Validate no orphan stories (every story has an owner).
- [x] B5. Validate no orphan units (every unit has at least one story).
- [x] B6. Validate dependency matrix is acyclic.
- [x] B7. Validate that the dependency matrix is consistent with the hexagonal layer rules (no unit-level dependency that would violate `component-dependency.md` §1).

### Phase 5 — Wrap-up
- [x] B8. Update `aidlc-docs/aidlc-state.md` — Units Generation marked Completed (awaiting approval).
- [x] B9. Update `aidlc-docs/audit.md` with generation summary.
- [x] B10. Present completion message ("🔧 Units Generation Complete").

---

## C. Approval Gate

After all `[Answer]:` tags in Section A are filled (or accepted as pre-filled) and any follow-up clarifications resolved, the user explicitly approves this plan. After approval, Part 2 executes Section B without further questions until the completion message.
