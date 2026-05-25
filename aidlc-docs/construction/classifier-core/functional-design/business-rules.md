# Business Rules — U-1 `classifier-core`

> All business rules, lookup tables, and the PBT property catalogue for the classifier-core unit. Rules are organised by the module that owns them.

---

## 1. Universal Rules

| Rule ID | Rule | Source |
|---|---|---|
| BR-1   | Classification is deterministic per `(buffer bytes, extension, contentType, workspaceConfig)` tuple | NFR-5 |
| BR-2   | Detection uses at most 4,100 bytes — never more | NFR-1, NFR-3 |
| BR-3   | No domain module performs I/O, logging, or AWS SDK calls | Hexagonal layout (Q1=A of Application Design) |
| BR-4   | All string format identifiers are lowercase (e.g., `"docx"`, never `"DOCX"`) | Convention |
| BR-5   | All `Result.error` values are typed string literals (no opaque error classes) | Q2=B mixed style |

---

## 2. OLE2 Parser Rules (`OLE2Parser`)

| Rule | Behaviour | PBT property |
|---|---|---|
| BR-O-1 | The OLE2 signature is exactly the 8 bytes `D0 CF 11 E0 A1 B1 1A E1` at offset 0 | — |
| BR-O-2 | The sector-size field at offset 30 (u16 LE) MUST equal `0x0009`; any other value → `Result.error("non-standard-sector-size")` | PBT-U1-003 |
| BR-O-3 | The first directory sector ID at offset 48 (i32 LE) — negative values are treated as `directory-beyond-window` (per Step 3 bounds check) | — |
| BR-O-4 | Directory byte offset = `512 * (1 + sectorId)` | — |
| BR-O-5 | If `directoryOffset + 128 > 4100` OR `directoryOffset + 128 > buffer.length`, return `Result.error("directory-beyond-window")` | PBT-U1-002 |
| BR-O-6 | The CLSID is at directoryOffset+80 through directoryOffset+95 (16 bytes) | — |
| BR-O-7 | Mixed-endian decoding (see `business-logic-model.md` §2 STEP 6): bytes 0..3 LE, 4..5 LE, 6..7 LE, 8..9 BE, 10..15 BE | — |
| BR-O-8 | Canonical CLSID format: uppercase hex, dash-separated, 8-4-4-4-12 (per Q5=A) | PBT-U1-001 |
| BR-O-9 | Round-trip property: for any valid CLSID `c`, `parseCLSID(encode(c)) == Result.ok(c)` | PBT-U1-001 |

---

## 3. CLSID Lookup Table (`Tier2OLE2Detector`)

> Per Q1 (Requirements) — these CLSIDs map to `category=convert`, `subCategory=convert-then-ocr` (except MSG which is `category=email`).

| CLSID | Format | Category (set by `CategoryMapper`) | Sub-category |
|---|---|---|---|
| `00020906-0000-0000-C000-000000000046` | `doc` | `convert` | `convert-then-ocr` |
| `00020820-0000-0000-C000-000000000046` | `xls` | `convert` | `convert-then-ocr` |
| `64818D10-4F9B-11CF-86EA-00AA00B929E8` | `ppt` | `convert` | `convert-then-ocr` |
| `00020D0B-0000-0000-C000-000000000046` | `msg` | `email` | `null` |
| `00020900-0000-0000-C000-000000000046` | `vsd` | `convert` | `convert-then-ocr` |

**Note**: `pps` shares the PowerPoint CLSID with `ppt`. Disambiguation between `.ppt` and `.pps` happens via extension if both apply; otherwise the format is recorded as `ppt`.

**MPP (per Q3 Requirements = A)**: No entry in this table. OLE2 buffers without a matching CLSID fall through to extension fallback in `Tier2OLE2Detector`.

---

## 4. OLE2 Extension Fallback Table (`Tier2OLE2Detector`)

When `OLE2Parser.parseCLSID` returns an error OR the parsed CLSID is not in §3, `Tier2OLE2Detector` falls back via extension:

| Extension (lowercased) | Format |
|---|---|
| `doc`  | `doc`  |
| `xls`, `xlt` | `xls` |
| `ppt`, `pot` | `ppt` |
| `pps` | `pps` |
| `msg` | `msg` |
| `vsd`, `vst` | `vsd` |
| `mpp` | `mpp` |

Any extension not in this table results in `Tier2OLE2Result.matched: false` (i.e., the OLE2 signature didn't disambiguate; we move on to Tier 3 text or fall through to `no-match`).

---

## 5. ZIP Detection Rules (`Tier2ZIPDetector` + helpers)

| Rule | Behaviour |
|---|---|
| BR-Z-1 | ZIP signature: `50 4B 03 04` at offset 0 |
| BR-Z-2 | A buffer with the ZIP signature but no parseable local file headers is treated as plain ZIP (`format="zip"`, `family="plain"`) |
| BR-Z-3 | If the first entry's filename is exactly `[Content_Types].xml`, the file is OOXML (`family="ooxml"`) |
| BR-Z-4 | If any entry's filename is exactly `mimetype` AND its compression method is 0 (Stored), the file is ODF (`family="odf"`) |
| BR-Z-5 | OOXML format disambiguation: based on additional entries scanned (`word/`, `xl/`, `ppt/` prefixes) — see `ooxmlFormatFromEntries` below |
| BR-Z-6 | ODF format disambiguation: read the `mimetype` entry's content; map to ODT/ODS/ODP/ODG — see `odfFormatFromMimetype` below |

### `ooxmlFormatFromEntries(entries)`

Examine the filenames of entries (after `[Content_Types].xml`) and return the first match:

| Entry prefix found | Returned format |
|---|---|
| `word/document.xml` | depends on `[Content_Types].xml` content; if macro types present → `docm`, else → `docx` |
| `xl/workbook.xml` | similar; macros → `xlsm`, else → `xlsx` |
| `ppt/presentation.xml` | macros → `pptm`; if mainDocument is "slideshow" → `ppsx`; else → `pptx` |

(The macro determination requires reading `[Content_Types].xml` content; if within the 4,100-byte window, do so; if not, return the non-macro variant as a conservative default.)

### `odfFormatFromMimetype(buffer, mimetypeEntry)`

Read the uncompressed bytes at `mimetypeEntry.position` and map:

| Content | Format |
|---|---|
| `application/vnd.oasis.opendocument.text`         | `odt` |
| `application/vnd.oasis.opendocument.spreadsheet`  | `ods` |
| `application/vnd.oasis.opendocument.presentation` | `odp` |
| `application/vnd.oasis.opendocument.graphics`     | `odg` |
| (anything else)                                   | `null` → caller treats as plain ZIP |

---

## 6. Text Heuristic Rules (`Tier3TextDetector`)

### BR-T-1 — Binary-byte screen
Reject the buffer (return `{ matched: false, reason: "binary-bytes" }`) if **any** byte is in `[0x00..0x08] ∪ [0x0E..0x1F]`, **excluding** `0x1B` (ESC). Tabs (`0x09`), LF (`0x0A`), VT (`0x0B`), FF (`0x0C`), CR (`0x0D`) are all OK.

### BR-T-2 — XML (priority 1)
- Match: `text` starts with `<?xml` (case-insensitive), optionally preceded by a UTF-8 BOM (`EF BB BF`).
- The XML check only considers the first 10 bytes — XML declarations never appear later.

### BR-T-3 — HTML (priority 2, per Q2=A)
- Regex applied to the first 1 KB: `/<(html|!doctype html|head)(\s|>)/i`
- Case-insensitive; trailing `\s` or `>` required to avoid matching `<htmlfoo>` or `<headersomething>`.

### BR-T-4 — EML (priority 3, per Q3=A)
- Accepted RFC 5322 header names (case-insensitive, must appear at the start of a line):
  - `From:`, `To:`, `Cc:`, `Bcc:`, `Date:`, `Subject:`, `Received:`, `Return-Path:`, `Reply-To:`, `Message-ID:`, `In-Reply-To:`, `References:`, `MIME-Version:`
- Count **distinct** header names found in the first 1 KB.
- Match if the distinct count is ≥ 2.

### BR-T-5 — DXF (priority 4)
- Regex applied to first 1 KB: must contain both `\bSECTION\b` AND `\bHEADER\b` (case-sensitive — DXF spec uses uppercase keywords).

### BR-T-6 — CSV (priority 5, per Q1=B)
**`isCSV(buffer, tolerance=1)`** algorithm:

```
Split buffer text into lines (split on \n; ignore empty trailing line)
If lines.length < 3: return false

For each candidate delimiter d in [',', '\t', ';', '|']:
  countsPerLine := [line.count(d) for line in lines]

  if any count is 0:
    continue  // this delimiter is absent in some line — not consistent

  median := median(countsPerLine)
  // Tolerance: every line's count must be within ±1 of the median
  if all(abs(count - median) <= 1 for count in countsPerLine):
    return true

return false
```

### BR-T-7 — TXT (priority 6, fallback)
- Match if the buffer passed the binary screen (BR-T-1) AND has at least one printable character (any byte in `[0x20..0x7E]` OR `[0x80..]` UTF-8 continuation valid).
- This is the catch-all for text that doesn't match any other heuristic.

### BR-T-8 — Priority order is fixed
PBT-U1-010 enforces that if a buffer matches both XML and EML signatures, the result is `xml` — never `eml`.

---

## 7. Scoring Rules (`Scorer`)

### BR-S-1 — Base score table (FR-5)

| `matchType` | Base score |
|---|---|
| `exact-unique-signature`     | 0.95 |
| `ole2-with-clsid`            | 0.90 |
| `zip-with-ooxml-or-odf`      | 0.90 |
| `ole2-or-zip-ext-fallback`   | 0.70 |
| `text-heuristic`             | 0.65 |
| `extension-only`             | 0.40 |
| `no-match`                   | 0.00 |

### BR-S-2 — Extension modifier
- **Corroborates** (+0.05): the extension matches the detected format's expected extension list (see BR-S-4).
- **Contradicts** (−0.15): the extension is provided AND in the alphabet of known extensions BUT does not match the detected format.
- **Absent** (0.00): `extension === null`.

### BR-S-3 — Content-Type modifier
- **Corroborates** (+0.05): the S3 `Content-Type` MIME matches the detected format's expected MIME list (see BR-S-4).
- **Contradicts** (−0.10): the content type is provided AND in the alphabet of known MIME types BUT does not match the detected format.
- **Absent** (0.00): `contentType === null`.

### BR-S-4 — Format ↔ extension/MIME mapping (for modifier evaluation)

Excerpt (full table at code-generation time):

| Format | Expected extensions | Expected MIME types |
|---|---|---|
| `pdf`  | `pdf`               | `application/pdf` |
| `docx` | `docx`              | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `xlsx` | `xlsx`              | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `pptx` | `pptx`              | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `docm` | `docm`              | `application/vnd.ms-word.document.macroEnabled.12` |
| `xlsm` | `xlsm`              | `application/vnd.ms-excel.sheet.macroEnabled.12` |
| `pptm` | `pptm`              | `application/vnd.ms-powerpoint.presentation.macroEnabled.12` |
| `ppsx` | `ppsx`              | `application/vnd.openxmlformats-officedocument.presentationml.slideshow` |
| `doc`  | `doc`               | `application/msword` |
| `xls`  | `xls`               | `application/vnd.ms-excel` |
| `ppt`  | `ppt`, `pot`        | `application/vnd.ms-powerpoint` |
| `pps`  | `pps`               | `application/vnd.ms-powerpoint` |
| `msg`  | `msg`               | `application/vnd.ms-outlook` |
| `vsd`  | `vsd`, `vst`        | `application/vnd.visio` |
| `mpp`  | `mpp`               | `application/vnd.ms-project` |
| `odt`  | `odt`               | `application/vnd.oasis.opendocument.text` |
| `ods`  | `ods`               | `application/vnd.oasis.opendocument.spreadsheet` |
| `odp`  | `odp`               | `application/vnd.oasis.opendocument.presentation` |
| `odg`  | `odg`               | `application/vnd.oasis.opendocument.graphics` |
| `rtf`  | `rtf`               | `application/rtf`, `text/rtf` |
| `dwg`  | `dwg`               | `application/acad`, `image/vnd.dwg` |
| `tiff` | `tif`, `tiff`       | `image/tiff` |
| `png`  | `png`               | `image/png` |
| `jpg`  | `jpg`, `jpeg`       | `image/jpeg` |
| `bmp`  | `bmp`               | `image/bmp` |
| `gif`  | `gif`               | `image/gif` |
| `mp3`  | `mp3`               | `audio/mpeg` |
| `wav`  | `wav`               | `audio/wav` |
| `ogg`  | `ogg`               | `audio/ogg`, `video/ogg` |
| `mp4`  | `mp4`, `mov`        | `video/mp4`, `video/quicktime` |
| `zip`  | `zip`               | `application/zip` |
| `xml`  | `xml`               | `application/xml`, `text/xml` |
| `html` | `html`, `htm`       | `text/html` |
| `eml`  | `eml`               | `message/rfc822` |
| `dxf`  | `dxf`               | `image/vnd.dxf`, `application/dxf` |
| `csv`  | `csv`               | `text/csv` |
| `txt`  | `txt`               | `text/plain` |

### BR-S-5 — Single clamp (per Q6=A)
The score is computed once as `raw = base + ext_mod + ct_mod`, then `clamp(raw, 0.0, 1.0)` is applied exactly once at the end. No per-step clamping.

---

## 8. Category Mapping (`CategoryMapper`)

### BR-C-1 — Main FR-6 table

| Format(s) | Category | Sub-category |
|---|---|---|
| `pdf`, `jpg`, `png`, `bmp` | `ocr-direct` | `null` |
| `gif`, `mp3`, `wav`, `ogg`, `mp4` | `media` | `null` |
| `rtf`, `dwg` | `convert` | `office` (rtf), `null` (dwg) |
| `tiff` | `convert` | `tiff` (per Q2 Req — wins over `image`) |
| `doc`, `xls`, `ppt`, `pps`, `vsd` (via OLE2 CLSID detection) | `convert` | `convert-then-ocr` |
| `mpp` (OLE2 extension fallback) | `convert` | `office` |
| `msg` (OLE2 CLSID) | `email` | `null` |
| `docx`, `docm`, `xlsx`, `xlsm`, `pptx`, `pptm`, `ppsx`, `odt`, `ods`, `odp`, `odg` | `convert` | `office` |
| `zip` | `archive` | `null` |
| `xml`, `csv`, `dxf` | `convert` | `null` |
| `html` | `convert` | `html` |
| `txt` | `convert` | `null` |
| `eml` | `email` | `null` |

### BR-C-2 — TIFF precedence
`format === "tif" OR format === "tiff"` → `subCategory === "tiff"` always (PBT-U1-016).

### BR-C-3 — `convert-then-ocr` sub-category trigger
Activated only when `detectionTier === "ole2-clsid"` AND format ∈ `{doc, xls, ppt, pps, vsd}`. If the same format is detected via extension fallback, `subCategory === "office"` instead.

### BR-C-4 — Unknown format → null (per Q4=A)
Any format string not in the table returns `null`. The orchestrator handles `null` by routing to `category="slipsheet"`, `slipsheetReason="low-confidence"`.

### BR-C-5 — PPSX / PPS office membership (PBT-U1-017)
`format ∈ {"ppsx", "pps"}` → `subCategory === "office"`.

---

## 9. Slipsheet Decision Rules (`SlipsheetDecider`)

### BR-D-1 — Precedence (per Q7 reason-precedence)
Evaluated in this order; first match wins:
1. `workspace-policy` (most explicit operator intent)
2. `max-zip-depth` (security boundary)
3. `low-confidence` (fallback)

### BR-D-2 — Workspace-policy rule
- If `slipsheetRules[detectedFormat] === "always-slipsheet"` → slipsheet=true / reason=`workspace-policy`
- OR if `quarantineMacros === true` AND `detectedFormat ∈ {"docm", "xlsm", "pptm"}` → slipsheet=true / reason=`workspace-policy` (PBT-U1-020)

### BR-D-3 — Max-zip-depth rule
- If `parentArchiveDepth >= maxZipDepth` → slipsheet=true / reason=`max-zip-depth` (PBT-U1-019)

### BR-D-4 — Low-confidence rule
- If `score <= threshold` → slipsheet=true / reason=`low-confidence` (PBT-U1-018, AC-6)
- This is the spec's `score > threshold` rule restated inversely: `not (score > threshold)` ≡ `score <= threshold`.

### BR-D-5 — Negative case
- If none of BR-D-2..BR-D-4 trigger → `{ slipsheet: false, reason: null }`.

---

## 10. PBT Property Catalogue (PBT-01 satisfaction)

The 20 properties from `classifier-core-functional-design-plan.md` §A.7.1, expressed here as the testable contract carried into Code Generation:

| ID | Module | Property | PBT Rule |
|---|---|---|---|
| PBT-U1-001 | OLE2Parser | Round-trip CLSID encode/decode | PBT-02 |
| PBT-U1-002 | OLE2Parser | directory-bounds invariant | PBT-03 |
| PBT-U1-003 | OLE2Parser | non-standard sector size invariant | PBT-03 |
| PBT-U1-004 | Tier1FileTypeDetector | Oracle vs file-type library | PBT-05 |
| PBT-U1-005 | Tier1FileTypeDetector | Idempotence | PBT-04 |
| PBT-U1-006 | Tier2OLE2Detector | Idempotence + determinism | PBT-03, PBT-04 |
| PBT-U1-007 | Tier2ZIPDetector | Oracle vs synthetic ZIP generators | PBT-05 |
| PBT-U1-008 | ZIPMarkerParser | `scanEntries.length <= maxEntries` | PBT-03 |
| PBT-U1-009 | Tier3TextDetector | Binary-byte screen invariant | PBT-03 |
| PBT-U1-010 | Tier3TextDetector | XML wins over EML when both match | PBT-03 |
| PBT-U1-011 | Scorer | Output ∈ [0, 1] | PBT-03 |
| PBT-U1-012 | Scorer | Monotonicity in modifiers | PBT-03 |
| PBT-U1-013 | Scorer | Commutativity of modifier application | PBT-04 |
| PBT-U1-014 | Scorer | Determinism | PBT-03 |
| PBT-U1-015 | CategoryMapper | Totality on FR-6 formats | PBT-03 |
| PBT-U1-016 | CategoryMapper | TIFF precedence | PBT-03 |
| PBT-U1-017 | CategoryMapper | PPSX/PPS in office | PBT-03 |
| PBT-U1-018 | SlipsheetDecider | Threshold boundary (low-confidence) | PBT-03 |
| PBT-U1-019 | SlipsheetDecider | Depth precedence (max-zip-depth) | PBT-03 |
| PBT-U1-020 | SlipsheetDecider | Macro quarantine (workspace-policy) | PBT-03 |

Each property maps to a `fast-check` `fc.property(...)` test in Code Generation. Per PBT-08, all tests log the seed and shrunk minimal example on failure.

---

## 11. Component-to-Story Trace (within U-1)

| Component | Owns stories |
|---|---|
| `OLE2Parser`, `Tier2OLE2Detector` | (contributes to US-DB-002 — MSG detection) |
| `Tier3TextDetector` | (contributes to US-DB-002 — EML detection) |
| `Scorer`, `CategoryMapper`, `SlipsheetDecider` | (contributes to US-DI-001, US-DB-001..005, US-WO-001..003) |
| (whole unit) | US-SD-002 (unit tests), US-SD-004 (PBT), US-SRE-005 (PBT seed reproduction) |

---

## 12. Cross-cutting Reminders

- **NFR-5 determinism**: every algorithm in this unit MUST be pure — no `Date.now()`, no `Math.random()`, no global state read.
- **NFR-7 logging**: domain modules do not log. The orchestrator (in U-3) logs the inputs and outputs of each tier as part of the step instrumentation.
- **SECURITY-15 fail-safe defaults**: when an algorithm encounters an unexpected condition not enumerated in the rules above, it MUST return a `Result.error` or `matched: false` — never throw.
