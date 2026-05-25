# Story Generation Plan — Classification Service

> Part 1 of the User Stories stage. This plan captures the methodology and answers needed before generating `stories.md` and `personas.md`. After all `[Answer]:` tags are filled and ambiguities resolved, the user explicitly approves this plan; the AI then executes Part 2 (Generation).

---

## A. Planning Questions

The answers below drive the breakdown approach, story granularity, format, and persona scope. Fill in each `[Answer]:` tag; choose **Other** if no option fits and describe your preference.

### Question 1 — Story Breakdown Approach
How should user stories be organised?

A) **Persona-based** — group stories by persona (Pipeline Orchestrator, Workspace Operator, On-Call SRE, etc.). Best when multiple stakeholder types each have distinct journeys.

B) **Feature-based** — group by system feature (file-type detection, deduplication, slipsheet routing, observability, configuration). Best when the system itself has clear functional boundaries.

C) **Epic-based** — hierarchical: top-level epics ("Document Classification", "Workspace Policy Management", "Operational Visibility") with sub-stories underneath. Best for very large feature sets.

D) **Hybrid (Persona + Feature)** — primary grouping by persona, secondary grouping by feature within each persona section. Best when both axes matter (multi-persona AND multi-feature).

E) Other (please describe after [Answer]: tag below)

[Answer]: D — Rationale: Six distinct personas each interact with multiple features, and several features cross multiple personas (e.g., `quarantineMacros` involves the Workspace Operator deciding policy, the Service implementing it, the SRE monitoring its effect, and the Document Ingestion Owner experiencing the slipsheet). Hybrid grouping makes both axes navigable without duplication.

### Question 2 — Persona Scope
Which personas should be included in `personas.md`?

A) **Minimal (3)** — Pipeline Orchestrator, Workspace Operator, Service Developer. Keeps focus on the immediate build.

B) **Standard (5)** — Pipeline Orchestrator, Workspace Operator, Document Ingestion Owner, Downstream Branch Maintainer, Service Developer. Adds the "customer" and downstream consumers.

C) **Comprehensive (6+)** — Standard plus On-Call SRE / Operations Engineer (and optionally a Security/Compliance Reviewer). Adds operational and security personas explicitly.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: The SECURITY extension (Q16 in requirements) and the operational tail (CloudWatch alarms, X-Ray traces, retry diagnosis) both warrant dedicated personas. Without an explicit SRE persona, operational stories (replay a failed classification, investigate a duplicate-cache hit) lose their owner. The assessment doc identified 6 personas naturally; this answer matches that.

### Question 3 — Story Granularity
What level of detail per story?

A) **Coarse** (~10–15 stories total) — one story per major capability. Faster to write, harder to test individually.

B) **Standard** (~20–30 stories) — one story per discrete user goal. Aligns with INVEST sizing — each story estimable in 1–3 days.

C) **Fine** (~40+ stories) — one story per acceptance criterion. Maximum traceability, more upfront effort.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Standard granularity (one story per discrete user goal) matches the INVEST "Small + Estimable" criteria. With 11 acceptance criteria and 6 personas, a coarse breakdown loses traceability and a fine breakdown produces clutter. Standard sizing gives ~25 stories — enough to cover every persona's primary goals plus operational concerns, without one-story-per-AC noise.

### Question 4 — Story Format / Template
Which story template should be used?

A) **Connextra ("As a... I want... so that...")** with separate Given/When/Then acceptance criteria block. Most common; pairs naturally with BDD test runners.

B) **Job Story ("When [context], I want to [motivation], so I can [outcome]")** — emphasises trigger/context over persona role. Better for systems where the "user" is itself a system.

C) **Hybrid** — Connextra for human personas, Job Story for system personas (Pipeline Orchestrator, Downstream Branches).

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: The Pipeline Orchestrator and Downstream Branch Maintainers act primarily through system triggers (Step Function task arrival, payload reception) rather than human goals — Job Story format reads more naturally for them. Human personas (Workspace Operator, SRE, Service Developer, Document Ingestion Owner) read better as Connextra. Each story still ends with the same Given/When/Then acceptance block, so test mapping stays uniform.

### Question 5 — Acceptance Criteria Style
What style for the acceptance criteria within each story?

A) **Given/When/Then (Gherkin-style)** — three-clause structure per criterion. Maps cleanly onto Cucumber/Vitest BDD or plain test names. **Verifiable.**

B) **Checklist** — flat list of testable conditions. Quicker to write, harder to translate to test fixtures.

C) **Mixed** — Given/When/Then for behavioural criteria, checklist for static rules (e.g., "payload includes field X").

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Given/When/Then maps 1:1 to Vitest test cases (the framework chosen in Q20) and to the LocalStack-backed integration tests planned in §7 of `requirements.md`. The 11 AC items in §8 are already written in roughly this shape. Pure consistency wins here.

### Question 6 — Traceability Back to Requirements
How should each story link back to `requirements.md`?

A) **Inline FR/NFR/AC tags** — every story carries a `Traces: FR-1, FR-6, AC-1` line at the end of its definition. Maximum traceability; minor visual noise.

B) **End-of-file traceability matrix** — a single matrix at the bottom of `stories.md` maps Story IDs to FR/AC IDs. Cleaner per-story; one extra section to maintain.

C) **Both** — inline tags AND a summary matrix at the end. Belt-and-braces; highest cost.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: This is a complex spec with 10 FRs, 10 NFRs, 11 ACs, and ~25 planned stories. Inline tags give per-story context (a reader of one story sees its provenance immediately); the matrix gives reverse lookup (a reader of FR-7.1 sees which stories cover it). The cost of maintaining both is small because we generate them together in Part 2.

### Question 7 — Operational / Negative-Path Stories
Should the story set include explicit operational and negative-path stories?

A) **Yes, both** — happy-path stories per persona PLUS operational stories (SRE replay, policy rollout, cache invalidation) PLUS negative-path stories (malformed input, S3 NotFound, DynamoDB throttling, ZIP bomb).

B) Happy-path + operational only — skip negative-path stories; rely on the FR edge-case table and the SECURITY rules.

C) Happy-path only — keep stories focused on intended use; negative cases live in the FR/NFR tables.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The service is a security-relevant entry point with explicit threat surfaces (malformed OLE2, ZIP-bombing attacks, malicious macros). Negative-path stories make these threats first-class user stories owned by a persona (typically the SRE or Security Reviewer). Operational stories (e.g., "replay a failed classification with a fixed input") are also load-bearing — they're how the service is actually run after Day 1.

### Question 8 — Story ID Convention
Choose a story ID convention.

A) **`US-###` flat numbering** — US-001, US-002, … Simple, no semantic info in the ID.

B) **`US-{persona-code}-###`** — US-OP-001 (Workspace Operator), US-SRE-002, etc. ID encodes persona.

C) **`US-{feature-code}-###`** — US-DETECT-001 (file-type detection), US-DEDUP-002, etc. ID encodes feature.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Since the chosen breakdown is hybrid persona-then-feature (Q1=D), encoding the persona in the ID makes the file readable when scrolling and makes story-to-persona mapping intuitive. Feature still appears in the story title and tag line, so no information is lost.

### Question 9 — INVEST Compliance Enforcement
How strict should INVEST enforcement be?

A) **Strict** — every story must pass all 6 criteria (Independent, Negotiable, Valuable, Estimable, Small, Testable). Stories that fail get split or merged.

B) **Pragmatic** — aim for INVEST; allow controlled exceptions for stories that are intentionally larger (e.g., a single "service skeleton" story) with documented rationale.

C) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Pure strict INVEST tends to fragment foundational stories (e.g., "Set up Lambda + Step Function plumbing") into so many sub-stories that the dependency graph becomes the artifact instead of the stories themselves. Pragmatic is the standard real-world choice; we mark any exception with a `Note: INVEST exception — <reason>` line.

---

## B. Plan Execution Checklist (Part 2 — Generation)

After plan approval, the AI executes the following checklist. Each step is marked `[ ]` until completed.

### Phase 1 — Persona Authoring
- [x] B1. Draft `personas.md` with the 6 personas selected in Q2=C: Pipeline Orchestrator System, Workspace Operator, Document Ingestion Owner, Downstream Branch Maintainer, Service Developer, On-Call SRE.
- [x] B2. For each persona, include: role, goals, decision authority, frustrations / failure modes, primary touchpoints with the Classification Service.
- [x] B3. Map each persona to the FRs/NFRs they most heavily interact with.
- [x] B4. Verify that every persona is referenced by at least one story (no orphan personas).

### Phase 2 — Story Authoring
- [x] B5. Draft `stories.md` with the hybrid persona-first / feature-second grouping (Q1=D).
- [x] B6. Use Connextra for human personas + Job Story for system personas (Q4=C).
- [x] B7. Each story carries the `US-{persona-code}-###` ID per Q8=B. Persona codes:
  - `PO` — Pipeline Orchestrator
  - `WO` — Workspace Operator
  - `DI` — Document Ingestion Owner
  - `DB` — Downstream Branch Maintainer
  - `SD` — Service Developer
  - `SRE` — On-Call SRE
- [x] B8. Each story includes a `Traces:` line listing the FR/NFR/AC IDs it covers (Q6=C inline tags).
- [x] B9. Each story includes a Given/When/Then acceptance criteria block (Q5=A).
- [x] B10. Apply pragmatic INVEST review (Q9=B); mark any intentional exceptions.
- [x] B11. Include operational stories (cache inspection, policy-version rollout, structured-log replay) per Q7=A.
- [x] B12. Include negative-path stories (malformed OLE2, ZIP bomb, S3 NotFound, DynamoDB throttling) per Q7=A.
- [x] B13. Verify total story count is in the Standard band (~20–30 per Q3=B).

### Phase 3 — Traceability
- [x] B14. Add an end-of-file traceability matrix mapping every Story ID → FR/NFR/AC IDs (Q6=C).
- [x] B15. Verify every FR (FR-1…FR-10 + FR-6.1, FR-7.1, FR-7.2, FR-7.3, FR-8.1) has at least one story.
- [x] B16. Verify every AC (AC-1…AC-11) has at least one story.
- [x] B17. Verify every persona has at least 2 stories.

### Phase 4 — Wrap-up
- [x] B18. Update `aidlc-docs/aidlc-state.md` — mark User Stories stage complete.
- [x] B19. Update `aidlc-docs/audit.md` with generation summary and timestamp.
- [x] B20. Present completion message (the standard "📚 User Stories Complete" block per the user-stories rule file Step 20).

---

## C. Approval Gate

Once all `[Answer]:` tags in Section A are filled in (or accepted as-is) and any follow-up clarifications are resolved, the user explicitly approves this plan. After approval, Part 2 executes the checklist in Section B without further questions until the completion message.
