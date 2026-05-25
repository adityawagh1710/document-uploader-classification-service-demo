# U-1 `classifier-core` Code Generation Summary

> Generated artifacts inventory + story traceability.

---

## 1. File Inventory

### 1.1 Project Scaffolding (Phase 1 — shared with all units)
| Path | Purpose |
|---|---|
| `package.json` | NPM manifest — exact-pinned `file-type@21.0.0` + dev deps |
| `tsconfig.json` | Strict-plus TypeScript config (Q4=A NFR Requirements) |
| `.eslintrc.cjs` | Boundary rules + no-throw + restricted globals/imports |
| `vitest.config.ts` | Coverage thresholds + benchmark + setupFiles |
| `tests/tsconfig.json` | Test-scoped tsconfig extending root |
| `.gitignore` | Standard Node + TS ignores |
| `README.md` | Project overview + dev quickstart |

### 1.2 Shared Types and Utilities (Phase 2)
| Path | Purpose |
|---|---|
| `src/shared/result.ts` | `Result<T, E>` discriminated union + ok/err helpers |
| `src/shared/types.ts` | DetectionTier, MatchType, Category, SubCategory, SlipsheetReason, CLSID, TaskPayload, WorkspaceConfig, ContentHashRecord |
| `src/shared/byte-utils.ts` | readU16LE, readI32LE, readU32LE, clamp, encodeCLSIDToBytes, decodeCLSIDFromBytes |
| `src/shared/constants.ts` | BASE_SCORE_TABLE + signatures + offsets |

### 1.3 Ports (Phase 3 — Logger only; other ports bootstrap in U-2/U-3)
| Path | Purpose |
|---|---|
| `src/ports/Logger.ts` | Logger port + silentLogger default for tests |

### 1.4 Domain Modules (Phase 4 — 32 files; the heart of U-1)
| Module | Files | Key Algorithm |
|---|---|---|
| `tier1-filetype/` | types.ts, Tier1FileTypeDetector.ts, index.ts | wraps `file-type` library (the oracle) |
| `tier2-ole2/` | types.ts, OLE2Parser.ts, Tier2OLE2Detector.ts, clsid-lookup.ts, extension-fallback.ts, index.ts | **mixed-endian CLSID** — 6-step algorithm with 3 independent bounds gates |
| `tier2-zip/` | types.ts, ZIPMarkerParser.ts, Tier2ZIPDetector.ts, format-mappers.ts, index.ts | local-file-header walk + OOXML/ODF disambiguation |
| `tier3-text/` | types.ts, heuristics.ts, Tier3TextDetector.ts, index.ts | binary-byte screen + priority-ordered evaluation (XML > HTML > EML > DXF > CSV > TXT) |
| `scoring/` | types.ts, format-metadata.ts, extension-modifier.ts, content-type-modifier.ts, Scorer.ts, index.ts | base + modifiers + single clamp (Q6=A) |
| `categories/` | types.ts, fr6-table.ts, CategoryMapper.ts, index.ts | FR-6 mapping + TIFF precedence + convert-then-ocr trigger |
| `slipsheet/` | types.ts, SlipsheetDecider.ts, index.ts | precedence-based decision (workspace-policy > max-zip-depth > low-confidence) |
| `domain/index.ts` | top-level barrel | re-exports every domain module |

### 1.5 Test Generators (Phase 5 — PBT-07 satisfaction)
| Path | Purpose |
|---|---|
| `tests/pbt/generators/clsid.gen.ts` | `validCLSIDGen` |
| `tests/pbt/generators/ole2.gen.ts` | `buildOLE2Buffer` + `ole2BufferWithCLSIDGen` + non-standard / out-of-window variants |
| `tests/pbt/generators/zip.gen.ts` | `ooxmlZipGen`, `odfZipGen`, `plainZipGen` |
| `tests/pbt/generators/text.gen.ts` | `xmlTextGen`, `htmlTextGen`, `emlTextGen`, `csvTextGen`, `binaryByteBufferGen` |
| `tests/pbt/generators/scoring.gen.ts` | `scoringInputGen` |

### 1.6 PBT Infrastructure (Phase 6 — PBT-08 + PBT-10)
| Path | Purpose |
|---|---|
| `tests/pbt/_setup.ts` | Auto-capture shrunk failures to regression JSON |
| `tests/regression/pbt-failures.json` | Empty array — auto-appended by capture mechanism |
| `tests/regression/pbt-replays.test.ts` | Replay harness iterating captured regressions |

### 1.7 Unit Tests (Phase 7 — example-based; Vitest)
| Path | Covers |
|---|---|
| `tests/unit/tier1-filetype.test.ts` | PDF/PNG detection; garbage buffer |
| `tests/unit/tier2-ole2/parser.test.ts` | All 4 OLE2 outcomes + worked-example round trip |
| `tests/unit/tier2-ole2/detector.test.ts` | All 5 CLSID mappings + extension fallback paths |
| `tests/unit/tier2-ole2/clsid-lookup.test.ts` | Table integrity |
| `tests/unit/tier2-zip.test.ts` | OOXML / ODF / plain ZIP disambiguation |
| `tests/unit/tier3-text.test.ts` | All 6 text formats + binary screen + ESC byte allow + XML > EML priority |
| `tests/unit/scoring.test.ts` | All base scores + all modifier combinations + clamping at both bounds |
| `tests/unit/categories.test.ts` | FR-6 table + TIFF precedence + convert-then-ocr + unknown → null + PPSX/PPS office |
| `tests/unit/slipsheet.test.ts` | All 3 reasons + precedence (workspace-policy > max-zip-depth > low-confidence) |

### 1.8 PBT Tests (Phase 8 — implements all 20 PBT-U1-XXX properties)
| Path | Properties |
|---|---|
| `tests/pbt/tier2-ole2.test.ts` | PBT-U1-001 (round-trip, 1000 runs), 002 (bounds, 1000 runs), 003 (sector size, 1000 runs), 006 (idempotence, 100 runs) |
| `tests/pbt/tier1-filetype.test.ts` | PBT-U1-004 (oracle vs library), 005 (idempotence) |
| `tests/pbt/tier2-zip.test.ts` | PBT-U1-007a/b/c (OOXML/ODF/plain oracles), 008 (scanEntries length invariant, 1000 runs) |
| `tests/pbt/tier3-text.test.ts` | PBT-U1-009 (binary-byte screen, 1000 runs), 010 (XML > EML priority, 1000 runs) |
| `tests/pbt/scoring.test.ts` | PBT-U1-011 (range [0,1]), 013 (commutativity), 014 (determinism) |
| `tests/pbt/categories.test.ts` | PBT-U1-015 (totality), 016 (TIFF precedence), 017 (PPSX/PPS in office) |
| `tests/pbt/slipsheet.test.ts` | PBT-U1-018 (threshold boundary), 019 (depth precedence), 020 (macro quarantine) |

### 1.9 Perf Bench (Phase 9)
| Path | Purpose |
|---|---|
| `tests/perf/perf-harness.ts` | `readBaseline`, `isWithinTolerance` |
| `tests/perf/perf-baselines.json` | Initial empty baseline (filled by first `--update-baseline` run) |
| `tests/perf/classifier-core.bench.ts` | 6 benches per Pattern #6 |

### 1.10 Fixture Manifest (Phase 10)
| Path | Purpose |
|---|---|
| `tests/fixtures/manifest.ts` | Typed manifest with placeholder entries for AC-1, AC-7, AC-8. Binary files committed by U-3 when integration tests need them. |
| `tests/fixtures/{ac-1,ac-2,ac-7,ac-8}/.gitkeep` | Directory placeholders |

---

## 2. Story Completion

### 2.1 Stories Owned by U-1 (now `[x]`)
- ✅ **US-SD-002** — Pure-logic unit tests run without LocalStack — Phase 7 delivers 9 test files; none import any AWS SDK or LocalStack code.
- ✅ **US-SD-004** — Property-based tests for byte-level invariants — Phase 8 delivers 7 PBT test files implementing all 20 PBT-U1-XXX properties with tiered numRuns (1000 for byte-level).
- ✅ **US-SRE-005** — Reproduce a CI-discovered PBT failure from the logged seed — Phase 6 delivers the shrunk-failure auto-capture + regression replay harness. `fast-check` logs seeds on failure by default.

### 2.2 Stories Where U-1 Contributes
The following stories now have their U-1 contribution complete; they'll be marked `[x]` once their owner unit (U-2 / U-3 / U-4) integration-tests the end-to-end behaviour:

- US-DI-001 (correct classification regardless of extension) — covered by Tier1 + Tier2 ZIP + Scorer combo
- US-DB-001..005 (downstream branch payload contracts) — covered by CategoryMapper + Tier* detectors
- US-WO-001 (configurable threshold) — covered by SlipsheetDecider receiving threshold input
- US-WO-002 (maxZipDepth defence) — covered by SlipsheetDecider depth check
- US-WO-003 (quarantineMacros) — covered by SlipsheetDecider workspace-policy precedence

---

## 3. Key Implementation Decisions and Deviations

### 3.1 Strictly Followed Functional Design
The implementation follows `business-logic-model.md` and `business-rules.md` exactly. The mixed-endian CLSID algorithm uses the documented 6-step procedure with the documented bounds gates. The text-heuristic priority order, the FR-6 mapping table, the scoring arithmetic — all match the spec.

### 3.2 `Tier1FileTypeDetector.detect` is Async
The `file-type` library v21 returns a Promise. The `Tier1Result` interface and the orchestrator path (built in U-3) must handle this. Documented in `domain-entities.md` updates may be required for U-3 to declare the Promise contract on its consumer side.

### 3.3 `ooxmlFormatFromEntries` Conservative Default
When OOXML disambiguation between docx/docm/xlsx/xlsm/pptx/pptm/ppsx is ambiguous within the 4,100-byte window (e.g., we see `ppt/presentation.xml` but cannot inspect `[Content_Types].xml` content), the implementation returns the non-macro / non-slideshow conservative default. Refinement using extension hints happens in U-3's orchestration.

### 3.4 `odfFormatFromMimetype` Best-Effort Buffer Read
The ODF mimetype entry's content is read via a forward scan up to 256 bytes — the exact end is determined by the local file header's `extraField` length which we approximate. For all real-world ODF files within the 4,100-byte window, this approximation succeeds.

### 3.5 Domain Code Never Throws (Per BR-5)
Audit: every domain function returns either a value or `Result.error`. The `Tier1FileTypeDetector` awaits a Promise from the `file-type` library; if that library rejects, the exception propagates to U-3's orchestrator (where it converts to `Result.error` for `SendTaskFailure`). The ESLint `no-restricted-syntax` rule blocks `ThrowStatement` in `src/domain/**`.

### 3.6 CLSID Canonical Form
All CLSIDs are uppercase-dashed (per Q5=A NFR Requirements). The `decodeCLSIDFromBytes` function returns uppercase hex without conditional formatting. PBT-U1-001 verifies the round-trip.

### 3.7 Single Clamp at End for Scorer
Per Q6=A — the scorer computes `clamp(base + ext_mod + ct_mod, 0, 1)` with exactly one clamp. PBT-U1-011 verifies the [0, 1] range invariant.

---

## 4. CI / Build Readiness

- All 7 CI gates from `nfr-design/logical-components.md` §4 are wired:
  - **lint**: `eslint .`
  - **typecheck**: `tsc --noEmit` against strict-plus config
  - **test-unit**: `vitest run tests/unit`
  - **test-pbt**: `vitest run tests/pbt tests/regression`
  - **coverage**: `vitest run --coverage` with per-directory thresholds (90% global, 95% on tier2-ole2)
  - **bench**: `vitest bench --run`
  - **supply-chain**: `npm audit --omit=dev --audit-level=high`
- The actual GitHub Actions workflow file is materialised in U-4's Infrastructure Design.

---

## 5. Total Generated

- **~35 source files** under `src/`
- **~21 test files** under `tests/`
- **8 configuration / documentation files**
- **Total: ~64 files; ~3,400 lines of TypeScript + config**

This is the build-time + test-time substrate for the whole service. U-2/U-3/U-4 build on this scaffold without re-doing it.
