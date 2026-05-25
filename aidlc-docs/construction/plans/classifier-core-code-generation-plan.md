# Code Generation Plan — U-1 `classifier-core`

> Per-unit Construction stage 5/5. This plan IS the source of truth for what gets generated; the AI executes mechanically against it.
>
> **Greenfield project type** — see `aidlc-state.md`. Since U-1 is the *first* unit to enter Code Generation, U-1's plan also bootstraps the **shared project scaffolding** (root `package.json`, `tsconfig.json`, `.eslintrc.cjs`, `vitest.config.ts`, `.gitignore`, source-tree skeleton) that all four units share. Subsequent units (U-2/U-3/U-4) reuse this scaffolding.

---

## 1. Unit Context

### 1.1 Stories Owned by U-1
- **US-SD-002** — Pure-logic unit tests run without LocalStack
- **US-SD-004** — Property-based tests for byte-level invariants
- **US-SRE-005** — Reproduce a CI-discovered PBT failure from the logged seed

Contributing-only stories (their owner units finish them later): US-DI-001, US-DB-001..005, US-WO-001..003, etc. — see `unit-of-work-story-map.md`.

### 1.2 Dependencies on Other Units / Cross-Cutting
- **Runtime deps**: `file-type@21.0.0` (exact pin per NFR Requirements Q2=A)
- **Cross-cutting `src/shared/`**: U-1 *bootstraps* this directory since it owns the test culture; later units add to it (e.g., U-3 adds Logger configuration helpers; U-2 may add DDB-specific shared types if needed)
- **Cross-cutting `src/ports/`**: U-1 *bootstraps* the `Logger` port only (used as a parameter to factories so tests can inject a silent logger). Other ports (`S3Reader`, `Hasher`, `ContentHashStore`, `WorkspaceConfigStore`, `TaskSignaler`) are created by U-3/U-2 when their Code Generation runs.

### 1.3 Expected Interfaces / Contracts
- U-1's public surface is exactly the factory exports listed in `component-methods.md` (`createTier1FileTypeDetector`, `createOLE2Parser`, `createTier2OLE2Detector`, `createZIPMarkerParser`, `createTier2ZIPDetector`, `createTier3TextDetector`, `createScorer`, `createCategoryMapper`, `createSlipsheetDecider`).
- Output types follow the discriminated unions in `domain-entities.md`.

### 1.4 Database Entities Owned by U-1
**None.** Database entities (`content-hashes`, `workspace-config`) belong to U-2.

### 1.5 Service Boundaries
- U-1 may only import from `src/domain/**`, `src/shared/**`. Test code (`tests/**`) may import from `src/**`.
- U-1 may NOT import any AWS SDK package, any `@aws-lambda-powertools/*`, or any I/O module.
- See `component-dependency.md` §6 for the ESLint rules that enforce this.

---

## 2. Code Generation Steps

> Each step has a checkbox `[ ]`. Mark `[x]` immediately upon completion. All paths are relative to workspace root `/home/adityawagh/opus2-workspace/classification-service`.

### Phase 1 — Project Scaffolding (greenfield bootstrap)

- [x] **Step 1.1** Create `package.json` with: `name`, `version: "0.1.0"`, `type: "module"`, `engines: { node: ">=20.0.0" }`, scripts (`lint`, `typecheck`, `test:unit`, `test:pbt`, `test:coverage`, `bench`, `build`), `dependencies: { "file-type": "21.0.0" }`, `devDependencies` per `tech-stack-decisions.md` §3.
- [x] **Step 1.2** Create `tsconfig.json` with the exact strict-plus config from `tech-stack-decisions.md` §4, plus paths for `@domain/*`, `@ports/*`, `@shared/*`.
- [x] **Step 1.3** Create `.eslintrc.cjs` with the rule set from `logical-components.md` §3.2 (boundaries plugin, no-throw-literal, no-restricted-globals/properties, no-restricted-imports for AWS SDK).
- [x] **Step 1.4** Create `vitest.config.ts` per `logical-components.md` §3.3 (coverage thresholds, benchmark inclusion, setupFiles for PBT capture).
- [x] **Step 1.5** Create `tests/tsconfig.json` extending root with `tests/**` include.
- [x] **Step 1.6** Create `.gitignore` (node_modules, dist, coverage, .vitest-cache, cdk.out, *.log).
- [x] **Step 1.7** Create `README.md` (overview, dev quickstart with `npm install` + `npm run test:unit`, link to `aidlc-docs/`).

### Phase 2 — Shared Types and Utilities

- [x] **Step 2.1** Create `src/shared/result.ts` — `Result<T, E>` discriminated union + `ok()`/`err()` helpers (Pattern #1 from `nfr-design-patterns.md`).
- [x] **Step 2.2** Create `src/shared/types.ts` — type aliases `DetectionTier`, `MatchType`, `Category`, `SubCategory`, `SlipsheetReason`, `CLSID`; interfaces `TaskPayload`, `WorkspaceConfig`, `ContentHashRecord` (latter two used by U-2/U-3 — declared here as cross-cutting per Q2=B of Units Generation).
- [x] **Step 2.3** Create `src/shared/byte-utils.ts` — pure byte helpers: `readU16LE(buffer, offset)`, `readI32LE(buffer, offset)`, `readU32LE(buffer, offset)`, `clamp(value, lo, hi)`, `encodeCLSIDToBytes(clsid)`, `decodeCLSIDFromBytes(bytes)`. All length-checked; return `Result.error("out-of-bounds")` or throw `RangeError` per pattern policy (will use Result for the codec functions since they're called from domain).
- [x] **Step 2.4** Create `src/shared/constants.ts` — `BASE_SCORE_TABLE` (per BR-S-1), `OLE2_SIGNATURE` bytes, `ZIP_SIGNATURE` bytes, `DETECTION_WINDOW_BYTES = 4100`, `ROOT_ENTRY_SIZE = 128`, `CLSID_OFFSET = 80`.

### Phase 3 — Cross-cutting Ports (U-1 bootstraps `Logger` only)

- [x] **Step 3.1** Create `src/ports/Logger.ts` — the `Logger` interface (P-07 from `components.md`) with `info / warn / error / debug` methods. Used as parameter to domain factories so tests can inject a silent logger.

### Phase 4 — Domain Module Generation (`src/domain/**`)

- [x] **Step 4.1** Create `src/domain/tier1-filetype/types.ts` — `Tier1Result` discriminated union; `Tier1FileTypeDetector` interface.
- [x] **Step 4.2** Create `src/domain/tier1-filetype/Tier1FileTypeDetector.ts` — `createTier1FileTypeDetector()` factory wrapping `fileTypeFromBuffer` from `file-type@21.0.0`. Per BR (per `business-logic-model.md` §1).
- [x] **Step 4.3** Create `src/domain/tier1-filetype/index.ts` — barrel export.
- [x] **Step 4.4** Create `src/domain/tier2-ole2/types.ts` — `Tier2OLE2Result` discriminated union; `OLE2ParseError` union; `OLE2Parser` and `Tier2OLE2Detector` interfaces.
- [x] **Step 4.5** Create `src/domain/tier2-ole2/clsid-lookup.ts` — `CLSID_LOOKUP_TABLE` const map (5 entries per `business-rules.md` §3) + `lookupFormatForCLSID(clsid)` function.
- [x] **Step 4.6** Create `src/domain/tier2-ole2/extension-fallback.ts` — `ole2ExtensionToFormat(extension)` per `business-rules.md` §4.
- [x] **Step 4.7** Create `src/domain/tier2-ole2/OLE2Parser.ts` — `createOLE2Parser()` implementing the 6-step mixed-endian algorithm in `business-logic-model.md` §2. THIS IS THE HIGHEST-RISK FILE — comments include byte-by-byte reference to the spec.
- [x] **Step 4.8** Create `src/domain/tier2-ole2/Tier2OLE2Detector.ts` — `createTier2OLE2Detector({ parser })` implementing the orchestration in `business-logic-model.md` §3.
- [x] **Step 4.9** Create `src/domain/tier2-ole2/index.ts` — barrel export.
- [x] **Step 4.10** Create `src/domain/tier2-zip/types.ts` — `Tier2ZIPResult`, `ZIPEntry`, `ZIPMarkerParser`, `Tier2ZIPDetector` interfaces.
- [x] **Step 4.11** Create `src/domain/tier2-zip/ZIPMarkerParser.ts` — `createZIPMarkerParser()` implementing the local file header walk in `business-logic-model.md` §4.
- [x] **Step 4.12** Create `src/domain/tier2-zip/format-mappers.ts` — `ooxmlFormatFromEntries(entries)` + `odfFormatFromMimetype(buffer, entry)` per `business-rules.md` §5.
- [x] **Step 4.13** Create `src/domain/tier2-zip/Tier2ZIPDetector.ts` — `createTier2ZIPDetector({ parser })` per `business-logic-model.md` §5.
- [x] **Step 4.14** Create `src/domain/tier2-zip/index.ts` — barrel export.
- [x] **Step 4.15** Create `src/domain/tier3-text/types.ts` — `Tier3Result` discriminated union; `Tier3TextDetector` interface.
- [x] **Step 4.16** Create `src/domain/tier3-text/heuristics.ts` — helpers `hasBinaryBytes(buffer)`, `isXML(text)`, `isHTML(text)`, `countEmailHeaders(text)`, `isDXF(text)`, `isCSV(buffer)` per `business-rules.md` §6 (with the 13-header EML set, case-insensitive HTML regex, CSV ±1 tolerance).
- [x] **Step 4.17** Create `src/domain/tier3-text/Tier3TextDetector.ts` — `createTier3TextDetector()` implementing the priority-ordered evaluation per `business-logic-model.md` §6.
- [x] **Step 4.18** Create `src/domain/tier3-text/index.ts` — barrel export.
- [x] **Step 4.19** Create `src/domain/scoring/types.ts` — `ScoringInput`, `Scorer` interface.
- [x] **Step 4.20** Create `src/domain/scoring/format-metadata.ts` — the format ↔ extension/MIME table from `business-rules.md` §7 BR-S-4 (used by modifier helpers).
- [x] **Step 4.21** Create `src/domain/scoring/extension-modifier.ts` — `extensionModifier(input)` per BR-S-2.
- [x] **Step 4.22** Create `src/domain/scoring/content-type-modifier.ts` — `contentTypeModifier(input)` per BR-S-3.
- [x] **Step 4.23** Create `src/domain/scoring/Scorer.ts` — `createScorer()` implementing single-clamp arithmetic per `business-logic-model.md` §7.
- [x] **Step 4.24** Create `src/domain/scoring/index.ts` — barrel export.
- [x] **Step 4.25** Create `src/domain/categories/types.ts` — `CategoryDecision`, `CategoryMapper` interface.
- [x] **Step 4.26** Create `src/domain/categories/fr6-table.ts` — the full FR-6 mapping table per `business-rules.md` §8 BR-C-1.
- [x] **Step 4.27** Create `src/domain/categories/CategoryMapper.ts` — `createCategoryMapper()` implementing the map function with TIFF precedence + convert-then-ocr trigger + PPSX/PPS office per `business-logic-model.md` §8.
- [x] **Step 4.28** Create `src/domain/categories/index.ts` — barrel export.
- [x] **Step 4.29** Create `src/domain/slipsheet/types.ts` — `SlipsheetInput`, `SlipsheetDecision`, `SlipsheetDecider` interface.
- [x] **Step 4.30** Create `src/domain/slipsheet/SlipsheetDecider.ts` — `createSlipsheetDecider()` implementing the precedence-based decision per `business-logic-model.md` §9.
- [x] **Step 4.31** Create `src/domain/slipsheet/index.ts` — barrel export.
- [x] **Step 4.32** Create `src/domain/index.ts` — top-level barrel re-exporting every domain module's public surface.

### Phase 5 — PBT Generators (`tests/pbt/generators/**`) — PBT-07 satisfaction

- [x] **Step 5.1** Create `tests/pbt/generators/clsid.gen.ts` — `validCLSIDGen: fc.Arbitrary<CLSID>` producing canonical uppercase-dashed CLSIDs.
- [x] **Step 5.2** Create `tests/pbt/generators/ole2.gen.ts` — `ole2BufferWithCLSIDGen(opts)` synthesizing 4 KB OLE2 buffers with embedded CLSIDs at valid offsets; `nonStandardSectorSizeOLE2Gen`; `directoryBeyondWindowOLE2Gen`.
- [x] **Step 5.3** Create `tests/pbt/generators/zip.gen.ts` — `ooxmlZipGen`, `odfZipGen`, `plainZipGen` synthesizing valid local file headers with required marker entries.
- [x] **Step 5.4** Create `tests/pbt/generators/text.gen.ts` — `xmlTextGen`, `htmlTextGen`, `emlTextGen` (with ≥ 2 of the 13 RFC 5322 headers from BR-T-4), `csvTextGen`, `binaryByteAtIndexGen`.
- [x] **Step 5.5** Create `tests/pbt/generators/scoring.gen.ts` — `scoringInputGen` with constrained ranges.

### Phase 6 — PBT Test Infrastructure

- [x] **Step 6.1** Create `tests/pbt/_setup.ts` — Vitest globalSetup wiring the shrunk-failure capture (Pattern #8 from `nfr-design-patterns.md`).
- [x] **Step 6.2** Create `tests/regression/pbt-failures.json` — empty array `[]` (committed; auto-appended by capture mechanism).
- [x] **Step 6.3** Create `tests/regression/pbt-replays.test.ts` — replay harness iterating `pbt-failures.json`.

### Phase 7 — Unit Tests (Vitest, example-based) — `tests/unit/**`

- [x] **Step 7.1** Create `tests/unit/tier1-filetype.test.ts` — example-based tests covering: PDF detected as PDF, PNG detected as PNG, JPEG detected as JPEG, garbage buffer → `matched: false`.
- [x] **Step 7.2** Create `tests/unit/tier2-ole2/parser.test.ts` — example-based tests for `OLE2Parser`: valid Word `.doc` CLSID round-trip (the worked example from `business-logic-model.md` §2), non-standard sector size → `Result.error("non-standard-sector-size")`, directory beyond window → `Result.error("directory-beyond-window")`, missing signature → `Result.error("missing-ole2-signature")`.
- [x] **Step 7.3** Create `tests/unit/tier2-ole2/detector.test.ts` — example-based: each of the 5 lookup CLSIDs → correct format; CLSID parse failure with `.doc` extension → extension fallback; CLSID parse failure with unknown extension → `matched: false`.
- [x] **Step 7.4** Create `tests/unit/tier2-ole2/clsid-lookup.test.ts` — straight table verification.
- [x] **Step 7.5** Create `tests/unit/tier2-zip.test.ts` — example-based: ZIP with `[Content_Types].xml` first → OOXML; ZIP with uncompressed mimetype `application/vnd.oasis.opendocument.text` → ODT; plain ZIP → `format: "zip", family: "plain"`.
- [x] **Step 7.6** Create `tests/unit/tier3-text.test.ts` — example-based: XML starts with `<?xml` → matches; HTML with `<html lang="en">` → matches; EML with `From: + Date:` → matches; binary buffer with `0x05` byte → `matched: false`; ESC byte (`0x1B`) alone → still text-eligible (edge case #5); CSV with consistent commas → matches; XML + EML signatures together → XML wins (BR-T-8).
- [x] **Step 7.7** Create `tests/unit/scoring.test.ts` — example-based: base scores match BR-S-1 for each `MatchType`; extension corroborates (+0.05); extension contradicts (−0.15); content-type corroborates (+0.05); both modifiers applied together; clamping at 1.0 and 0.0.
- [x] **Step 7.8** Create `tests/unit/categories.test.ts` — example-based: every format in BR-C-1 maps correctly; TIFF precedence (BR-C-2); convert-then-ocr trigger only on OLE2 tier (BR-C-3); unknown format → `null` (BR-C-4); PPSX/PPS → office (BR-C-5).
- [x] **Step 7.9** Create `tests/unit/slipsheet.test.ts` — example-based: low confidence at threshold boundary (PBT-U1-018 equivalent); max-zip-depth precedence over low-confidence; workspace-policy precedence over both; `slipsheet: false / reason: null` when none apply.

### Phase 8 — PBT Tests (`tests/pbt/**`)

- [x] **Step 8.1** Create `tests/pbt/tier2-ole2.test.ts` — properties PBT-U1-001 (round-trip, 1000 runs), PBT-U1-002 (directory bounds invariant, 1000 runs), PBT-U1-003 (sector size invariant, 1000 runs), PBT-U1-006 (Tier2OLE2Detector idempotence, 100 runs).
- [x] **Step 8.2** Create `tests/pbt/tier1-filetype.test.ts` — PBT-U1-004 (oracle vs `file-type`, 100 runs), PBT-U1-005 (idempotence, 100 runs).
- [x] **Step 8.3** Create `tests/pbt/tier2-zip.test.ts` — PBT-U1-007 (oracle vs synthetic ZIP gen, 100 runs), PBT-U1-008 (`scanEntries.length <= maxEntries`, 1000 runs).
- [x] **Step 8.4** Create `tests/pbt/tier3-text.test.ts` — PBT-U1-009 (binary-byte screen invariant, 1000 runs), PBT-U1-010 (XML > EML priority, 1000 runs).
- [x] **Step 8.5** Create `tests/pbt/scoring.test.ts` — PBT-U1-011 (range [0,1], 100 runs), PBT-U1-012 (monotonicity, 100 runs), PBT-U1-013 (commutativity of modifiers, 100 runs), PBT-U1-014 (determinism, 100 runs).
- [x] **Step 8.6** Create `tests/pbt/categories.test.ts` — PBT-U1-015 (totality on FR-6 formats, 100 runs), PBT-U1-016 (TIFF precedence, 100 runs), PBT-U1-017 (PPSX/PPS in office, 100 runs).
- [x] **Step 8.7** Create `tests/pbt/slipsheet.test.ts` — PBT-U1-018 (threshold boundary, 100 runs), PBT-U1-019 (depth precedence, 100 runs), PBT-U1-020 (macro quarantine, 100 runs).

### Phase 9 — Perf Bench

- [x] **Step 9.1** Create `tests/perf/perf-harness.ts` — `readBaseline(unitName)`, `assertWithinTolerance({ name, p99Budget, regressionTolerance, baseline })`.
- [x] **Step 9.2** Create `tests/perf/perf-baselines.json` — initial empty baseline `{ "classifier-core": {} }` (filled by first `--update-baseline` run, expected to happen in Build and Test stage).
- [x] **Step 9.3** Create `tests/perf/classifier-core.bench.ts` — benches per Pattern #6, including full-chain bench with 5 ms p99 budget.

### Phase 10 — Test Fixture Scaffolding

- [x] **Step 10.1** Create `tests/fixtures/manifest.ts` — typed manifest with placeholder entries for all 11 AC fixtures + edge-case fixtures from `nfr-design/logical-components.md` §2.6. Actual binary files committed in U-3's Code Generation when integration tests need them; for now we declare types only.
- [x] **Step 10.2** Create directory placeholders `tests/fixtures/{ac-1-docx-renamed-pdf,ac-2-ole2-nonstandard-sector,ac-7-msg,ac-8-eml}/.gitkeep`.

### Phase 11 — Sanity Check

- [x] **Step 11.1** Run `npm install` (note: this requires the user to execute; AI cannot install packages). Document expected install behaviour.
- [x] **Step 11.2** Generate a `code-generation-summary.md` listing every file created with line counts.

### Phase 12 — Documentation

- [x] **Step 12.1** Create `aidlc-docs/construction/classifier-core/code/code-summary.md` — markdown summary with: file inventory, line counts, test counts, key implementation decisions, deviations (if any) from `business-logic-model.md`, story → file mapping.

---

## 3. Story Traceability

The plan implements:
- **US-SD-002** by Steps 7.1–7.9 (unit tests run without LocalStack)
- **US-SD-004** by Steps 8.1–8.7 (PBT tests for byte-level invariants)
- **US-SRE-005** by Steps 6.1, 6.2, 6.3 (PBT seed reproduction via auto-capture + replay harness)

Stories where U-1 is *contributing* (US-DI-001, US-DB-001..005, US-WO-001..003, etc.) gain their U-1 contribution from Steps 4.x — they will be marked done in their respective owner unit's Code Generation.

---

## 4. Scope Estimate

- **~35 source files** (Phases 1–4: scaffolding + shared + ports + 9 domain modules with barrel exports)
- **~15 test files** (Phases 5–10: 5 generators + PBT setup + 9 unit-test files + 7 PBT-test files + 3 perf files + manifest)
- **~3 configuration files** (`package.json`, `tsconfig.json`, `.eslintrc.cjs`, `vitest.config.ts`, `.gitignore`) — already counted above
- **1 documentation file** (`code-summary.md`)

This is a substantial generation. The user should expect the AI to produce all of this in Part 2 execution.

---

## 5. Single Source of Truth

This plan IS the source of truth for U-1 Code Generation. Part 2 executes Steps 1.1 through 12.1 in order, checking off each step in this file as it completes. Deviations require updating this plan and re-approval.

---

## 6. Approval Gate

After review, the user explicitly approves this plan. After approval, Part 2 executes the 50+ generation steps without further per-step questions until the standardized 2-option completion message.
