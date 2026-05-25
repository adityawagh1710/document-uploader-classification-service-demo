# Functional Design Plan — U-1 `classifier-core`

> Per-unit Construction stage 1/5. This plan pins down the **detailed business logic** for the pure-domain unit before code generation. The 7 questions below resolve remaining ambiguities in `requirements.md` and identify property-based testing properties (PBT-01 mandatory).
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override any letter to change the design.

---

## A. Functional Design Questions

### Question 1 — CSV "consistent delimiter" definition
`requirements.md` FR-4 Tier 3 priority 5 says CSV detection requires "≥ 3 lines with a consistent delimiter (`,`, `\t`, `;`, `|`)". What does *consistent* mean precisely?

A) **Same delimiter character across all lines AND same delimiter count per line.** Strictest — rejects ragged CSVs that real-world tools sometimes produce.

B) **Same delimiter character across all lines; delimiter count per line may differ by ±1** (to tolerate trailing newlines, optional quoted fields with embedded commas). Pragmatic.

C) **Same delimiter character; line-count-of-delimiter must occur in ≥ 80% of the lines.** Very permissive; risks false positives.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: Pragmatic strictness fits the "LOW confidence" classification this tier already carries. Real-world CSVs sometimes omit trailing delimiters on the last line or include quoted fields with delimiters inside; ±1 tolerance handles those without admitting random text that happens to have commas. Strictest (A) creates an annoying class of false negatives; permissive (C) admits genuinely-not-CSV content.

### Question 2 — HTML detection case-sensitivity + attributes
FR-4 priority 2 says HTML is detected by `<html`, `<!DOCTYPE html`, or `<head` in the first 1 KB. Should the match be case-insensitive, and should we permit attributes / whitespace after the tag name?

A) **Case-insensitive AND tolerant of attributes/whitespace.** Match the regex `/<(html|!doctype html|head)(\s|>)/i` in the first 1 KB. Most permissive within the spec — matches `<HTML>`, `<html lang="en">`, `<!DOCTYPE HTML>`, `<head class="…">`.

B) **Case-sensitive, exact tag match only.** Matches only the exact byte strings `<html`, `<!DOCTYPE html`, `<head`. Strictest reading of the spec.

C) **Case-insensitive but exact tag (no trailing chars).** Matches `<html` and `<HTML` but not `<html lang="en">`.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: HTML in the wild is wildly inconsistent on case (`<HTML>` from older tools, `<html>` modern, `<!DOCTYPE HTML>` in some templating systems) and almost always has attributes on `<html lang>` / `<head class>`. Strictest reading (B) misses the majority of real-world HTML. The trailing `(\s|>)` anchor prevents matching `<htmlfoo>` or `<headersomething>`.

### Question 3 — EML RFC 5322 header set
FR-4 priority 3 says EML requires "≥ 2 RFC 5322 headers (`From:`, `Received:`, `Date:`, …) in first 1 KB". Pin the exact accepted header set.

A) **Accept any header from this set** (must be at the start of a line, header name + colon, case-insensitive): `From:`, `To:`, `Cc:`, `Bcc:`, `Date:`, `Subject:`, `Received:`, `Return-Path:`, `Reply-To:`, `Message-ID:`, `In-Reply-To:`, `References:`, `MIME-Version:`. The ≥ 2 threshold counts distinct header names (not duplicates of the same header).

B) **Smaller, stricter set**: only `From:`, `Date:`, `Received:`, `Message-ID:`, `MIME-Version:`. Lower false-positive rate; misses some forwarded emails that lose some headers.

C) **Accept any line matching the RFC 5322 header grammar** (any `[A-Za-z][A-Za-z0-9-]*:` start-of-line pattern). Highest recall; risk of matching non-email text like config files.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The 13-header set in (A) covers all common EML producers (Outlook export, Gmail download, Postfix, Sendmail). Counting *distinct* header names (not duplicates) prevents a buffer with five `Received:` headers from being mistaken for an EML when no other header is present. Stricter set (B) misses common forwarded-email cases where `Subject:` + `To:` are the only headers preserved. Pure grammar match (C) admits `[Section]:` from INI files.

### Question 4 — `CategoryMapper` behavior on unknown formats
What happens if a tier returns a `detectedFormat` string that the `CategoryMapper` has no rule for (e.g., a future `file-type` library version detects a new format)?

A) **Return null** → orchestrator routes to `category=slipsheet`, `slipsheetReason="low-confidence"`. Safe default.

B) **Return `{ category: "convert", subCategory: null }`** → assume any unknown format is a "best guess convert candidate".

C) **Throw an error** → unrecoverable; surfaces as `SendTaskFailure`. Forces the operator to add the format explicitly.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Returning null and routing to slipsheet is the *safe* default: an unknown format flows through the same slipsheet placeholder that already handles low-confidence detections. The Document Ingestion Owner (US-DI-004) sees a clear "low-confidence" slipsheet reason. Option B silently expands the `convert` contract — downstream branches will fail when handed a format they don't recognise. Option C is too aggressive — a `file-type` library upgrade should never break production by default.

### Question 5 — CLSID canonical storage format
Canonical CLSID lookups need a consistent string form. Which format is canonical for the CLSID lookup table and log output?

A) **Uppercase, dashed, 8-4-4-4-12** — `00020906-0000-0000-C000-000000000046`. Standard Microsoft DCOM string form.

B) **Lowercase, dashed, 8-4-4-4-12** — `00020906-0000-0000-c000-000000000046`. Standard UUID form.

C) **Uppercase, undashed** — `0002090600000000C000000000000046`. Compact; less readable.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The CLSID lookup table in `requirements.md` §2.2 already uses uppercase-dashed form. Microsoft documentation universally uses uppercase-dashed for COM CLSIDs. Lowercase (B) is the general UUID convention but inconsistent with the Office CLSIDs canonical sources. We'll normalise to uppercase-dashed inside `OLE2Parser.parseCLSID` so the round-trip property in PBT-02 has a single canonical form.

### Question 6 — Scorer clamp/modifier application order
The decision rule in FR-5 is `score = clamp(base + ext_mod + content_type_mod, 0.0, 1.0)`. Confirm the application order:

A) **Add all modifiers first, then clamp once at the end.** Single clamp. Matches the rule as written.

B) **Clamp after each modifier application.** Per-step clamp; result may differ from (A) at boundaries (e.g., base 0.95 + ext +0.05 → 1.00 clamped → +0.05 ct → would be 1.05 if not clamped, but second clamp keeps at 1.00).

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The spec's pseudocode is `clamp(base + ext_mod + content_type_mod, 0.0, 1.0)` — a single clamp at the end. Per-step clamping (B) would be a different function and changes results at the [0,1] boundaries in pathological cases (e.g., contradicting modifiers that would otherwise cancel out). Single clamp is mathematically cleaner and easier to express as a PBT property: `score(input) ∈ [0, 1]` is true by construction, and `score(input) == clamp(base(input) + ext_mod(input) + ct_mod(input), 0, 1)` is the algebraic statement.

### Question 7 — Property-Based Testing Property Catalogue (PBT-01 mandatory)
Confirm the property catalogue for U-1. PBT-01 requires this enumeration during Functional Design. The pre-filled list below covers the modules in U-1; add or remove via the **Other** option.

A) **Accept the proposed property catalogue below.** (See list in Section A.7.1)

B) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The proposed catalogue covers every U-1 module with at least one PBT property of the most-suitable category (round-trip / invariant / idempotence / oracle / commutativity). It's the minimum to satisfy PBT-01 + PBT-02 + PBT-03 + PBT-04 + PBT-05 for this unit and aligns with the candidates already pre-identified in `requirements.md` §10.2.

#### A.7.1 — Proposed PBT Property Catalogue for U-1

| ID | Component | Category | Property | PBT rule |
|---|---|---|---|---|
| PBT-U1-001 | `OLE2Parser` | Round-trip (invertible) | `parseCLSID(encode(clsid))` returns `Result.ok(clsid)` for every valid CLSID | PBT-02 |
| PBT-U1-002 | `OLE2Parser` | Invariant | For any buffer where `directory_offset + 128 > 4100`, `parseCLSID` returns `Result.error("directory-beyond-window")` | PBT-03 |
| PBT-U1-003 | `OLE2Parser` | Invariant | For any buffer where `sectorSize != 0x0009`, `parseCLSID` returns `Result.error("non-standard-sector-size")` | PBT-03 |
| PBT-U1-004 | `Tier1FileTypeDetector` | Oracle (reference) | `Tier1FileTypeDetector.detect(b)` matches the `file-type` library's `fromBuffer(b)` output (the library IS the oracle) | PBT-05 |
| PBT-U1-005 | `Tier1FileTypeDetector` | Idempotence | `detect(b) == detect(b)` for any buffer `b` | PBT-04 |
| PBT-U1-006 | `Tier2OLE2Detector` | Idempotence + Determinism | Same input → same output | PBT-04, PBT-03 |
| PBT-U1-007 | `Tier2ZIPDetector` | Oracle | For synthetic ZIPs built from `tests/fixtures/synthetic-generators.ts`, the detector identifies OOXML/ODF/plain correctly | PBT-05 |
| PBT-U1-008 | `ZIPMarkerParser` | Invariant | `scanEntries(buffer, n).length <= n` for any buffer and any non-negative `n` | PBT-03 |
| PBT-U1-009 | `Tier3TextDetector` | Invariant | If the buffer contains any byte in `0x00..0x08 ∪ 0x0E..0x1F` excluding `0x1B`, `detect(b).matched === false` | PBT-03 |
| PBT-U1-010 | `Tier3TextDetector` | Invariant | Priority ordering: if both XML and EML signatures match, the result is XML (priority 1 < priority 3) | PBT-03 |
| PBT-U1-011 | `Scorer` | Invariant (range) | `score(input) ∈ [0, 1]` for every input | PBT-03 |
| PBT-U1-012 | `Scorer` | Invariant (monotonicity) | Holding other inputs fixed, adding a corroborating modifier never decreases the score, and a contradicting modifier never increases it | PBT-03 |
| PBT-U1-013 | `Scorer` | Commutativity | The order in which extension and content-type modifiers are applied does not affect the output (within the spec's clamp-at-end model) | PBT-04 (per Q6=A) |
| PBT-U1-014 | `Scorer` | Determinism | Same input → same output | PBT-03 |
| PBT-U1-015 | `CategoryMapper` | Totality | For every format string in the FR-6 mapping table, `map(format, tier)` returns a non-null `{ category, subCategory }` | PBT-03 |
| PBT-U1-016 | `CategoryMapper` | Invariant (TIFF precedence) | For format ∈ {`tif`, `tiff`}, `subCategory === "tiff"` (never `"image"`) | PBT-03 (per Q2 of Requirements) |
| PBT-U1-017 | `CategoryMapper` | Invariant (PPSX/PPS office) | For format ∈ {`ppsx`, `pps`}, `subCategory === "office"` | PBT-03 (per Q4 of Requirements) |
| PBT-U1-018 | `SlipsheetDecider` | Invariant (boundary) | When `score === threshold`, `decide(input).slipsheet === true && .reason === "low-confidence"` | PBT-03 (per AC-6) |
| PBT-U1-019 | `SlipsheetDecider` | Invariant (depth) | When `parentArchiveDepth >= maxZipDepth`, `decide(input).slipsheet === true && .reason === "max-zip-depth"` | PBT-03 (per AC-5) |
| PBT-U1-020 | `SlipsheetDecider` | Invariant (macro quarantine) | When `quarantineMacros === true` AND `detectedFormat ∈ {"docm","xlsm","pptm"}`, `decide(input).slipsheet === true && .reason === "workspace-policy"` | PBT-03 (per AC-10) |

20 properties total covering all 9 U-1 components. PBT-08 (shrinking + reproducibility) and PBT-09 (framework — `fast-check`) are framework concerns satisfied at NFR Requirements + Code Generation.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — Domain Entities
- [x] B1. Create `aidlc-docs/construction/classifier-core/functional-design/domain-entities.md`:
  - Entity definitions for `Tier1Result`, `Tier2OLE2Result`, `Tier2ZIPResult`, `Tier3Result`, `ScoringInput`, `CategoryDecision`, `SlipsheetInput`, `SlipsheetDecision`, `CLSID`, `ZIPEntry`, `MatchType`
  - Field-by-field validation rules
  - Relationship diagram (how entities flow through the classify pipeline)

### Phase 2 — Business Logic Model
- [x] B2. Create `aidlc-docs/construction/classifier-core/functional-design/business-logic-model.md`:
  - Per-module algorithm specifications:
    - **`OLE2Parser.parseCLSID`** — byte-by-byte mixed-endian extraction (CRITICAL — known bug source)
    - **`Tier1FileTypeDetector.detect`** — wraps `file-type` library; result mapping
    - **`Tier2OLE2Detector.detect`** — orchestration: signature check → parser → lookup → fallback
    - **`ZIPMarkerParser.scanEntries`** — local file header walk algorithm
    - **`Tier2ZIPDetector.detect`** — OOXML / ODF / plain ZIP decision flow
    - **`Tier3TextDetector.detect`** — binary-byte screen + priority-ordered signature evaluation (per Q1, Q2, Q3 answers)
    - **`Scorer.score`** — single-clamp arithmetic (per Q6)
    - **`CategoryMapper.map`** — FR-6 lookup with TIFF precedence + Office variants (per Q4 behaviour on unknown)
    - **`SlipsheetDecider.decide`** — combined decision logic (workspace policy + depth + low confidence)
  - Pseudocode + flow diagrams per module

### Phase 3 — Business Rules
- [x] B3. Create `aidlc-docs/construction/classifier-core/functional-design/business-rules.md`:
  - Detection rules (per tier)
  - Scoring rules (base + modifiers)
  - Mapping rules (format → category/sub)
  - Slipsheet rules (precedence among low-confidence / max-zip-depth / workspace-policy)
  - Boundary rules (≥ vs >, inclusive/exclusive)
  - Error rules (when to return `Result.error`)
  - PBT property catalogue (the 20 properties from A.7.1)

### Phase 4 — Validation
- [x] B4. Verify every component in U-1 has a defined algorithm and at least one PBT property.
- [x] B5. Verify all 20 properties from A.7.1 map to a specific assertion in the generated test plan.
- [x] B6. Verify business rules cover all the answered questions Q1–Q6.

### Phase 5 — Wrap-up
- [x] B7. Update `aidlc-docs/aidlc-state.md` — U-1 Functional Design marked Completed.
- [x] B8. Update `aidlc-docs/audit.md`.
- [x] B9. Present the 2-option completion message ("🔧 Functional Design Complete - classifier-core").

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
