# Business Logic Model — U-1 `classifier-core`

> Per-module algorithm specifications. Pseudocode is language-agnostic but oriented to the TypeScript implementation chosen in Application Design. The **mixed-endian CLSID byte algorithm in §2** is the highest-risk algorithm in the unit (flagged in `requirements.md` §2.2) — read it carefully.

---

## 1. `Tier1FileTypeDetector.detect(buffer)`

**Purpose**: Tier 1 detection via the `file-type` library.

**Algorithm**:
1. Pass `buffer` directly to `fileTypeFromBuffer(buffer)` (the npm `file-type` library's async API). Capture the result.
2. If the library returns `undefined`, return `{ matched: false }`.
3. If the library returns `{ ext, mime }`, return `{ matched: true, ext, mime }`.

**Notes**:
- The library is the oracle for PBT-U1-004.
- Library version pinned in `package.json`; bumps require regenerating the snapshot of expected results.

---

## 2. `OLE2Parser.parseCLSID(buffer)` — THE CRITICAL ALGORITHM

**Purpose**: Pure byte-level extraction of the Root Entry CLSID from an OLE2 buffer, with mixed-endian decoding per Microsoft's Compound File Binary Format.

**Algorithm**:

```
parseCLSID(buffer):

  ┌──── STEP 1: signature check ────────────────────────────┐
  │ If buffer.length < 8                                    │
  │   OR buffer[0..7] != [D0, CF, 11, E0, A1, B1, 1A, E1]   │
  │ → return Result.error("missing-ole2-signature")         │
  └─────────────────────────────────────────────────────────┘

  ┌──── STEP 2: sector size check ──────────────────────────┐
  │ If buffer.length < 32                                   │
  │ → return Result.error("non-standard-sector-size")       │
  │                                                         │
  │ sectorSize := read_u16_le(buffer, offset=30)            │
  │ If sectorSize != 0x0009                                 │
  │ → return Result.error("non-standard-sector-size")       │
  └─────────────────────────────────────────────────────────┘

  ┌──── STEP 3: directory sector ID ────────────────────────┐
  │ If buffer.length < 52                                   │
  │ → return Result.error("directory-beyond-window")        │
  │                                                         │
  │ sectorId := read_i32_le(buffer, offset=48)              │
  │ directoryOffset := 512 * (1 + sectorId)                 │
  │                                                         │
  │ If directoryOffset < 0                                  │
  │ → return Result.error("directory-beyond-window")        │
  └─────────────────────────────────────────────────────────┘

  ┌──── STEP 4: bounds check ───────────────────────────────┐
  │ // Root Entry is 128 bytes; CLSID is at bytes 80..95    │
  │ // within the Root Entry, so we need bytes              │
  │ // [directoryOffset, directoryOffset + 96)              │
  │ // But for safety we require the full Root Entry        │
  │ // (128 bytes) to be readable — matches the spec.       │
  │                                                         │
  │ If directoryOffset + 128 > 4100                         │
  │   OR directoryOffset + 128 > buffer.length              │
  │ → return Result.error("directory-beyond-window")        │
  └─────────────────────────────────────────────────────────┘

  ┌──── STEP 5: read CLSID bytes (16 bytes) ────────────────┐
  │ clsidStart := directoryOffset + 80                      │
  │ raw[0..15] := buffer[clsidStart..clsidStart+16]         │
  └─────────────────────────────────────────────────────────┘

  ┌──── STEP 6: mixed-endian decode ────────────────────────┐
  │ // Bytes 0..3:   little-endian DWORD → group 1 (8 hex)  │
  │ // Bytes 4..5:   little-endian WORD  → group 2 (4 hex)  │
  │ // Bytes 6..7:   little-endian WORD  → group 3 (4 hex)  │
  │ // Bytes 8..9:   big-endian          → group 4 (4 hex)  │
  │ // Bytes 10..15: big-endian          → group 5 (12 hex) │
  │                                                         │
  │ g1 := hex_u32_be(reverse(raw[0..4]))   // LE → BE for   │
  │ g2 := hex_u16_be(reverse(raw[4..6]))   // hex emission  │
  │ g3 := hex_u16_be(reverse(raw[6..8]))                    │
  │ g4 := hex_u16_be(raw[8..10])           // already BE    │
  │ g5 := hex_u48_be(raw[10..16])          // already BE    │
  │                                                         │
  │ canonical := uppercase(g1 + "-" + g2 + "-" + g3 + "-" + │
  │                        g4 + "-" + g5)                   │
  │                                                         │
  │ → return Result.ok(canonical as CLSID)                  │
  └─────────────────────────────────────────────────────────┘
```

**Worked example** — the Word `.doc` CLSID `00020906-0000-0000-C000-000000000046`:
- On-disk bytes: `06 09 02 00 00 00 00 00 C0 00 00 00 00 00 00 46`
- Bytes 0..3 reversed = `00 02 09 06` → group 1 `00020906`
- Bytes 4..5 reversed = `00 00` → group 2 `0000`
- Bytes 6..7 reversed = `00 00` → group 3 `0000`
- Bytes 8..9 unchanged = `C0 00` → group 4 `C000`
- Bytes 10..15 unchanged = `00 00 00 00 00 46` → group 5 `000000000046`
- Final: `00020906-0000-0000-C000-000000000046` ✓

**PBT properties**: PBT-U1-001 (round-trip), PBT-U1-002 (bounds), PBT-U1-003 (sector size).

**Implementation notes**:
- Use Node `Buffer.readUInt16LE`, `readInt32LE`, etc. (these exist in browser-shim form too).
- Hex emission MUST be uppercase (Q5=A).
- The `reverse(raw[0..4])` operation is the LE→BE swap for the hex emission — *not* a byte-mirror of the field.

---

## 3. `Tier2OLE2Detector.detect(buffer, extension)`

**Purpose**: Orchestrate Tier 2 OLE2 detection — signature check → CLSID parse → table lookup → extension fallback.

**Algorithm**:

```
detect(buffer, extension):

  if buffer.length < 8 OR buffer[0..7] != [D0,CF,11,E0,A1,B1,1A,E1]:
    return { matched: false }

  result := OLE2Parser.parseCLSID(buffer)

  if result is Result.error:
    // Per Q4 (Requirements) — fall back to extension
    fallbackFormat := ole2ExtensionToFormat(extension)
    if fallbackFormat is null:
      return { matched: false }
    return {
      matched: true,
      format: fallbackFormat,
      matchType: "ole2-or-zip-ext-fallback"
    }

  clsid := result.value
  format := CLSID_LOOKUP_TABLE[clsid]    // see §4 of business-rules.md

  if format is undefined:
    // CLSID parsed but not in our table — also fall back
    fallbackFormat := ole2ExtensionToFormat(extension)
    if fallbackFormat is null:
      return { matched: false }
    return {
      matched: true,
      format: fallbackFormat,
      matchType: "ole2-or-zip-ext-fallback"
    }

  return {
    matched: true,
    format: format,            // e.g., "doc", "xls", "ppt", "msg", "vsd"
    clsid: clsid,
    matchType: "ole2-with-clsid"
  }
```

Where `ole2ExtensionToFormat(ext)` returns one of `"doc","xls","ppt","pps","msg","vsd","mpp"` if the extension matches; null otherwise.

---

## 4. `ZIPMarkerParser.scanEntries(buffer, maxEntries)`

**Purpose**: Walk the ZIP local file headers and emit up to `maxEntries` entries.

**Algorithm**:

```
scanEntries(buffer, maxEntries):

  entries := []
  offset := 0

  while entries.length < maxEntries AND offset + 30 <= buffer.length:

    // 30 bytes is the fixed local file header size before filename + extra
    if buffer[offset..offset+4] != [50, 4B, 03, 04]:
      break   // not a local file header — end of scannable region

    compressionMethod := read_u16_le(buffer, offset + 8)
    filenameLength    := read_u16_le(buffer, offset + 26)
    extraFieldLength  := read_u16_le(buffer, offset + 28)

    filenameStart := offset + 30
    filenameEnd   := filenameStart + filenameLength

    if filenameEnd > buffer.length:
      break   // truncated; bail

    filename := utf8_decode(buffer[filenameStart..filenameEnd])

    entries.push({
      filename: filename,
      uncompressed: (compressionMethod == 0),
      position: offset
    })

    // Compressed data starts right after extra field — but we can't
    // know its length from the local header alone (it's encoded in
    // bytes 18-22). Read u32_le at offset+18 to skip safely:
    compressedSize := read_u32_le(buffer, offset + 18)

    offset := filenameEnd + extraFieldLength + compressedSize

  return entries
```

**Notes**:
- The 4,100-byte detection window limits practical maxEntries to ~10–20 entries depending on filename lengths.
- We deliberately don't validate CRC or decompress anything — that's outside Tier 2's responsibility.
- The walk stops on any inconsistency (no error returned; we just emit what we successfully parsed).

---

## 5. `Tier2ZIPDetector.detect(buffer)`

**Purpose**: Distinguish OOXML, ODF, and plain ZIP using the first few local file headers.

**Algorithm**:

```
detect(buffer):

  if buffer.length < 4 OR buffer[0..4] != [50, 4B, 03, 04]:
    return { matched: false }

  entries := ZIPMarkerParser.scanEntries(buffer, maxEntries=4)

  if entries.length == 0:
    // ZIP signature present but no parseable entries — treat as plain
    return {
      matched: true,
      format: "zip",
      family: "plain",
      matchType: "exact-unique-signature"
    }

  // Rule 1: [Content_Types].xml as the FIRST entry → OOXML
  if entries[0].filename == "[Content_Types].xml":
    return {
      matched: true,
      format: ooxmlFormatFromEntries(entries),   // see business-rules.md §5
      family: "ooxml",
      matchType: "zip-with-ooxml-or-odf"
    }

  // Rule 2: uncompressed "mimetype" entry (typically first in ODF) → ODF
  mimetypeEntry := entries.find(e => e.filename == "mimetype" && e.uncompressed)
  if mimetypeEntry is not null:
    return {
      matched: true,
      format: odfFormatFromMimetype(buffer, mimetypeEntry),  // see business-rules.md §5
      family: "odf",
      matchType: "zip-with-ooxml-or-odf"
    }

  // Else: plain ZIP archive
  return {
    matched: true,
    format: "zip",
    family: "plain",
    matchType: "exact-unique-signature"
  }
```

---

## 6. `Tier3TextDetector.detect(buffer)`

**Purpose**: Text-format heuristic with binary-byte screen and fixed priority order.

**Algorithm**:

```
detect(buffer):

  // STEP 1: binary-byte screen (per FR-4 + edge case #5)
  for each byte b in buffer:
    if (b >= 0x00 AND b <= 0x08) OR (b >= 0x0E AND b <= 0x1F):
      if b != 0x1B:   // ESC is excluded from the binary set
        return { matched: false, reason: "binary-bytes" }

  // STEP 2: priority-ordered signature evaluation
  text := utf8_decode(buffer)
  first1KB := text.slice(0, 1024)

  // Priority 1: XML — starts with <?xml (allow optional BOM)
  if /^(﻿)?<\?xml/i.test(text.slice(0, 10)):
    return { matched: true, format: "xml", matchType: "text-heuristic" }

  // Priority 2: HTML — case-insensitive, attribute-tolerant (Q2=A)
  if /<(html|!doctype html|head)(\s|>)/i.test(first1KB):
    return { matched: true, format: "html", matchType: "text-heuristic" }

  // Priority 3: EML — ≥ 2 distinct RFC 5322 headers (Q3=A)
  emlHeaderCount := countDistinctEmailHeaders(first1KB)
  if emlHeaderCount >= 2:
    return { matched: true, format: "eml", matchType: "text-heuristic" }

  // Priority 4: DXF — contains SECTION + HEADER keyword sequence
  if /\bSECTION\b/.test(first1KB) AND /\bHEADER\b/.test(first1KB):
    return { matched: true, format: "dxf", matchType: "text-heuristic" }

  // Priority 5: CSV — ≥ 3 lines, consistent delimiter (Q1=B)
  if isCSV(buffer, tolerance=1):
    return { matched: true, format: "csv", matchType: "text-heuristic" }

  // Priority 6: TXT fallback — text with no recognised pattern
  if hasAnyPrintableContent(buffer):
    return { matched: true, format: "txt", matchType: "text-heuristic" }

  return { matched: false, reason: "no-pattern-matched" }
```

**Helper specifications** in `business-rules.md` §6 (header set, CSV detector, etc.).

---

## 7. `Scorer.score(input)` — Single-Clamp Arithmetic

**Algorithm** (per Q6=A):

```
score(input):

  base := BASE_SCORE_TABLE[input.matchType]   // see business-rules.md §7

  extMod := extensionModifier(input)         // see §7
  ctMod  := contentTypeModifier(input)       // see §7

  raw := base + extMod + ctMod
  return clamp(raw, 0.0, 1.0)

clamp(x, lo, hi):
  return max(lo, min(hi, x))
```

**Properties** (from PBT catalogue):
- PBT-U1-011: Output ∈ [0, 1]
- PBT-U1-012: Monotonic in corroborating modifiers
- PBT-U1-013: Commutative in extension/content-type modifier application (since both are pre-clamp additions)
- PBT-U1-014: Deterministic — pure function of input

---

## 8. `CategoryMapper.map(detectedFormat, detectionTier)`

**Algorithm**:

```
map(detectedFormat, detectionTier):

  format := detectedFormat.lowercased()

  // Special case 1: TIFF precedence (Q2 of Requirements)
  if format == "tif" OR format == "tiff":
    return { category: "convert", subCategory: "tiff" }

  // Special case 2: convert-then-ocr sub-category for OLE2 Office
  if format in {"doc", "xls", "ppt", "pps", "vsd"} AND
     detectionTier == "ole2-clsid":
    return { category: "convert", subCategory: "convert-then-ocr" }

  // Look up in main FR-6 table
  decision := FR6_TABLE[format]            // see business-rules.md §8
  return decision                          // may be null (per Q4=A)
```

---

## 9. `SlipsheetDecider.decide(input)` — Precedence-Based Decision

**Algorithm** (per Q7 reason-precedence in domain-entities.md §7):

```
decide(input):

  // Precedence 1: workspace policy (explicit operator intent wins)
  if input.detectedFormat != null AND
     (input.slipsheetRules[input.detectedFormat] == "always-slipsheet" OR
      (input.quarantineMacros AND input.detectedFormat in {"docm","xlsm","pptm"})):
    return { slipsheet: true, reason: "workspace-policy" }

  // Precedence 2: archive depth (security boundary)
  if input.parentArchiveDepth >= input.maxZipDepth:
    return { slipsheet: true, reason: "max-zip-depth" }

  // Precedence 3: low confidence (FR-5 boundary rule — strict >)
  if input.score <= input.threshold:
    return { slipsheet: true, reason: "low-confidence" }

  return { slipsheet: false, reason: null }
```

**Properties** (from PBT catalogue):
- PBT-U1-018: At threshold boundary (`score === threshold`), slipsheet=true / reason=low-confidence
- PBT-U1-019: Depth precedence — when depth condition holds (and no workspace-policy match), reason=max-zip-depth
- PBT-U1-020: Macro quarantine — when `quarantineMacros && format ∈ {docm,xlsm,pptm}`, reason=workspace-policy

---

## 10. Module Composition Diagram

```
TaskPayload + buffer (4100 B)
        │
        ▼
┌───────────────────┐
│ Tier1FileTypeDet  │ ◄── file-type lib (Tier 1)
└─────────┬─────────┘
          │ on miss
          ▼
┌───────────────────┐    ┌─────────────────┐
│ Tier2OLE2Det      │◄───│ OLE2Parser      │
└─────────┬─────────┘    └─────────────────┘
          │ on miss
          ▼
┌───────────────────┐    ┌─────────────────┐
│ Tier2ZIPDet       │◄───│ ZIPMarkerParser │
└─────────┬─────────┘    └─────────────────┘
          │ on miss
          ▼
┌───────────────────┐
│ Tier3TextDet      │
└─────────┬─────────┘
          │
          ▼
{ matchType, detectedFormat, detectionTier }
          │
          ├──────────────────┐
          ▼                  ▼
┌───────────────────┐  ┌───────────────────┐
│ Scorer            │  │ CategoryMapper    │
└─────────┬─────────┘  └─────────┬─────────┘
          │                      │
          └──────┬───────────────┘
                 ▼
       ┌───────────────────┐
       │ SlipsheetDecider  │ ◄── workspace config + parentArchiveDepth
       └─────────┬─────────┘
                 ▼
       ClassificationOutput (built by handler unit's OutputBuilder)
```

All arrows are synchronous in-process function calls. Each module is a pure function — no I/O, no logger, no AWS SDK.
