# Story-to-Unit Map — Classification Service

> Per Q3=A: a story's **owner** unit is the unit whose acceptance test runs the AC. **Contributing** units are those whose code is touched by the story even though they don't own the AC.
>
> Cross-references `stories.md` (28 user stories) and `unit-of-work.md` (4 units).

---

## 1. Story Assignment Table

| Story ID | Title | Owner | Contributing Units |
|---|---|---|---|
| US-PO-001 | Submit a document for classification | U-3 handler | U-1, U-2 |
| US-PO-002 | Receive a complete, contract-compliant success payload | U-3 handler | U-1 |
| US-PO-003 | Receive a structured failure on unrecoverable error | U-3 handler | (cross-cutting: SECURITY-05/15) |
| US-PO-004 | Bypass duplicate suppression when override flag is set | U-3 handler | U-2 |
| US-WO-001 | Configure the classification threshold per workspace | U-3 handler | U-2 (provides `WorkspaceConfig`), U-1 (`Scorer`) |
| US-WO-002 | Set `maxZipDepth` to defend against ZIP-bomb attacks | U-3 handler | U-2, U-1 (`SlipsheetDecider`) |
| US-WO-003 | Enable macro quarantine | U-3 handler | U-2, U-1 (`SlipsheetDecider`) |
| US-WO-004 | Configure per-workspace TTL on `content-hashes` | U-2 persistence | U-4 (DDB TTL attribute config) |
| US-WO-005 | Trigger a policy-version bump that self-heals stale cache | U-3 handler | U-2 (`replaceOnPolicyMismatch`) |
| US-DI-001 | Correct classification regardless of file extension | U-3 handler | U-1 (`Tier2ZIPDetector` + `Scorer`) |
| US-DI-002 | Avoid being charged twice for the same document | U-3 handler | U-2 (conditional write + duplicate update) |
| US-DI-003 | Workspace isolation across tenants | U-2 persistence | U-3 (orchestrator passes `workspaceId`) |
| US-DI-004 | Understand why a document was placeholdered | U-3 handler | U-1 (`SlipsheetDecider`) |
| US-DB-001 | Consume `category=convert` with reliable `subCategory` | U-3 handler | U-1 (`CategoryMapper`) |
| US-DB-002 | Consume `category=email` for MSG and EML | U-3 handler | U-1 (`Tier2OLE2Detector`, `Tier3TextDetector`) |
| US-DB-003 | Consume `category=archive` only for genuine archive ZIPs | U-3 handler | U-1 (`Tier2ZIPDetector`) |
| US-DB-004 | Consume slipsheet payloads with full reason + context | U-3 handler | U-1 (`SlipsheetDecider`), `OutputBuilder` |
| US-DB-005 | Consume `ocr-direct` and `media` for direct-routing formats | U-3 handler | U-1 (`Tier1FileTypeDetector`, `CategoryMapper`) |
| US-SD-001 | Run the service locally against LocalStack | U-3 handler | U-1, U-2 (all units exercised) |
| US-SD-002 | Run unit tests on pure-logic modules without LocalStack | U-1 classifier-core | — |
| US-SD-003 | Verify all 11 ACs end-to-end against LocalStack | U-3 handler | U-1, U-2, U-4 (LocalStack-emulated DDB) |
| US-SD-004 | Run property-based tests for byte-level invariants | U-1 classifier-core | — |
| US-SD-005 | Pre-PR smoke test against the Lambda runtime | U-3 handler | U-4 (CDK synth produces the Lambda artifact) |
| US-SRE-001 | Investigate a `SendTaskFailure` from structured logs alone | U-3 handler | U-4 (CloudWatch log group config) |
| US-SRE-002 | Replay a failed input deterministically | U-3 handler | U-1 (NFR-5 determinism) |
| US-SRE-003 | Inspect per-workspace duplicate-cache metrics | U-4 infrastructure | U-3 (emits metrics via Powertools) |
| US-SRE-004 | Receive alerts on security-relevant anomalies | U-4 infrastructure | U-3 (emits underlying metrics) |
| US-SRE-005 | Reproduce a CI-discovered PBT failure from the logged seed | U-1 classifier-core | U-3 (CI test runner) |

---

## 2. Per-Unit Story View

### U-1 `classifier-core` (4 stories owned)
- US-SD-002 — Pure-logic unit tests run without LocalStack
- US-SD-004 — Property-based tests for byte-level invariants
- US-SRE-005 — Reproduce a CI-discovered PBT failure from seed
- Plus: contributes to virtually every U-3 story (provides the pure-logic detection that U-3 orchestrates)

### U-2 `persistence` (2 stories owned)
- US-WO-004 — Per-workspace TTL on `content-hashes`
- US-DI-003 — Workspace isolation across tenants
- Plus: contributes to US-PO-004, US-WO-001..005, US-DI-002, US-WO-005 (any story involving DDB I/O)

### U-3 `handler` (20 stories owned)
- All Pipeline Orchestrator stories: US-PO-001, US-PO-002, US-PO-003, US-PO-004
- Workspace Operator stories that need orchestration: US-WO-001, US-WO-002, US-WO-003, US-WO-005
- Document Ingestion Owner stories: US-DI-001, US-DI-002, US-DI-004
- Downstream Branch stories: US-DB-001, US-DB-002, US-DB-003, US-DB-004, US-DB-005
- Service Developer stories spanning end-to-end: US-SD-001, US-SD-003, US-SD-005
- SRE stories tied to handler-emitted state: US-SRE-001, US-SRE-002

### U-4 `infrastructure` (2 stories owned)
- US-SRE-003 — Per-workspace duplicate-cache metrics dashboard (owned because the CDK Observability stack defines the dashboard and metric filters)
- US-SRE-004 — Alarms on security-relevant anomalies (owned because the CDK stack defines the alarms)
- Plus: contributes to US-WO-004 (TTL attribute config), US-SD-005 (SAM Local needs the synthesised template), US-SRE-001 (log retention)

---

## 3. Audit — Coverage Validation

### 3.1 Every story has exactly one owner
| Total stories | Stories owned | Orphan stories |
|---|---|---|
| 28 | 28 | 0 ✓ |

### 3.2 Every unit has at least one story
| Unit | Stories owned |
|---|---|
| U-1 classifier-core | 4 ✓ |
| U-2 persistence | 2 ✓ |
| U-3 handler | 20 ✓ |
| U-4 infrastructure | 2 ✓ |

### 3.3 Ownership distribution comments
- U-3 (handler) owns the majority — this is expected since the orchestrator + Lambda entry composes everything, and most ACs are end-to-end behaviours.
- U-2 (persistence) and U-4 (infrastructure) own fewer stories but **contribute** to a large fraction. The contributing-unit column is what makes the load visible.
- U-1 (classifier-core) owns stories about the **test culture** (unit tests, PBT, PBT-seed reproducibility) — its biggest contribution lives behind every U-3 story as a contributor.

---

## 4. How to Use This Map

**During the per-unit Construction loops:**
- When U-1's loop runs, all stories with owner=U-1 must have passing tests in `tests/unit/` and `tests/pbt/` before the unit's Build and Test stage completes.
- When U-2's loop runs, U-2-owned stories must have passing tests in `tests/integration/persistence/`.
- When U-3's loop runs, U-3-owned stories must have passing tests in `tests/integration/handler/` and `tests/smoke/`.
- When U-4's loop runs, U-4-owned stories must have passing CDK snapshot tests and (where applicable) post-deploy verification.

**During PR review:**
- A PR that touches `src/domain/**` must reference at least one U-1-owned story OR demonstrate that it's contributing to a U-3 story (and the U-3 contributor section should be updated).
- A PR touching `src/ports/` or `src/shared/` is `cross-cutting` (Q2=B) and requires review from at least one owner of each unit that consumes the touched file.

**For iteration planning:**
- Group sprints by **story owner unit** for clean test-tier alignment.
- Schedule cross-cutting work (port changes, shared type changes) deliberately — never as a side-effect of feature work.

---

## 5. Story Status Tracking

The status of each story is tracked by its owner unit's Construction loop. As units progress through their per-unit Construction (Functional Design → NFR Requirements → NFR Design → Infrastructure Design → Code Generation → unit-level test pass), the owned stories advance accordingly.

The aggregate "ready to ship" gate is reached when:
- All 28 stories have passing tests in their owner unit's CI gate
- All 11 ACs (from `requirements.md` §8) pass the LocalStack-backed integration suite in U-3
- SAM Local smoke (US-SD-005) passes
- CDK snapshot tests in U-4 pass
- `cdk-nag` produces no high-severity findings
- Coverage thresholds met (≥90% branch on U-1; ≥70% on U-3 integration glue)

This aggregate gate is the Build and Test stage at the end of the Construction phase.
