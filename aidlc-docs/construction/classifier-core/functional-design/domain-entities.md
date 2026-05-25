# Domain Entities — U-1 `classifier-core`

> All entities are **pure value types** with no methods. They flow between domain modules through factory-injected functions.

---

## 1. Entity Index

| Entity | Layer | Used By | Defined In |
|---|---|---|---|
| `CLSID` | shared | `OLE2Parser`, `Tier2OLE2Detector` | `src/shared/types.ts` |
| `DetectionTier` (enum) | shared | All tier detectors, `CategoryMapper` | `src/shared/types.ts` |
| `MatchType` (enum) | shared | `Scorer` | `src/shared/types.ts` |
| `Category` (enum) | shared | `CategoryMapper`, `SlipsheetDecider` | `src/shared/types.ts` |
| `SubCategory` (enum) | shared | `CategoryMapper` | `src/shared/types.ts` |
| `SlipsheetReason` (enum) | shared | `SlipsheetDecider` | `src/shared/types.ts` |
| `Tier1Result` | domain | `Tier1FileTypeDetector` | `src/domain/tier1-filetype/types.ts` |
| `Tier2OLE2Result` | domain | `Tier2OLE2Detector` | `src/domain/tier2-ole2/types.ts` |
| `Tier2ZIPResult` | domain | `Tier2ZIPDetector` | `src/domain/tier2-zip/types.ts` |
| `Tier3Result` | domain | `Tier3TextDetector` | `src/domain/tier3-text/types.ts` |
| `ZIPEntry` | domain | `ZIPMarkerParser`, `Tier2ZIPDetector` | `src/domain/tier2-zip/types.ts` |
| `ScoringInput` | domain | `Scorer` | `src/domain/scoring/types.ts` |
| `CategoryDecision` | domain | `CategoryMapper` | `src/domain/categories/types.ts` |
| `SlipsheetInput` | domain | `SlipsheetDecider` | `src/domain/slipsheet/types.ts` |
| `SlipsheetDecision` | domain | `SlipsheetDecider` | `src/domain/slipsheet/types.ts` |
| `OLE2ParseError` (union) | domain | `OLE2Parser` | `src/domain/tier2-ole2/types.ts` |

---

## 2. Shared Enums (canonical values + validation)

### `DetectionTier`
```typescript
export type DetectionTier =
  | "file-type"
  | "ole2-clsid"
  | "zip-marker"
  | "text-heuristic"
  | "extension-fallback";
```

**Validation rule**: Exactly one of these five string literals. No other value is permitted in any payload or log entry.

### `MatchType` (used by `Scorer` to look up the base score)
```typescript
export type MatchType =
  | "exact-unique-signature"     // 0.95
  | "ole2-with-clsid"            // 0.90
  | "zip-with-ooxml-or-odf"      // 0.90
  | "ole2-or-zip-ext-fallback"   // 0.70
  | "text-heuristic"             // 0.65
  | "extension-only"             // 0.40
  | "no-match";                  // 0.00
```

### `Category`
```typescript
export type Category =
  | "ocr-direct" | "media" | "convert" | "email" | "archive" | "slipsheet";
```

### `SubCategory`
```typescript
export type SubCategory =
  | "office" | "image" | "tiff" | "html" | "convert-then-ocr" | null;
```

**Validation rule**: `SubCategory` is non-null only when `Category === "convert"`.

### `SlipsheetReason`
```typescript
export type SlipsheetReason =
  | "workspace-policy" | "max-zip-depth" | "low-confidence" | null;
```

**Validation rule**: Non-null iff `SlipsheetDecision.slipsheet === true`.

### `CLSID`
```typescript
export type CLSID = string;   // Format: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                              // - Uppercase hex digits 0-9, A-F
                              // - Five groups separated by hyphens
                              // - Group lengths: 8, 4, 4, 4, 12
```

**Validation rule** (per Q5=A): Canonical form is uppercase, dash-separated, 8-4-4-4-12. Any `CLSID` produced by `OLE2Parser.parseCLSID` MUST conform; downstream consumers MAY assume conformance.

**Round-trip property** (PBT-U1-001): `encode(decode(clsid)) === clsid` for all valid canonical CLSIDs.

---

## 3. Tier Result Entities

Each tier returns a discriminated union — `{ matched: true, …data }` or `{ matched: false, …reason? }`. This makes the orchestrator's early-exit logic type-safe.

### `Tier1Result`
```typescript
export type Tier1Result =
  | { matched: true; ext: string; mime: string }
  | { matched: false };
```

**Field rules**:
- `ext`: lowercase string from the `file-type` library (e.g., `"pdf"`, `"png"`, `"docx"`)
- `mime`: full MIME type from the `file-type` library (e.g., `"application/pdf"`)

### `Tier2OLE2Result`
```typescript
export type Tier2OLE2Result =
  | { matched: true; format: string; clsid: CLSID; matchType: "ole2-with-clsid" }
  | { matched: true; format: string; matchType: "ole2-or-zip-ext-fallback" }
  | { matched: false };
```

**Field rules**:
- `format`: lowercase format string (`"doc"`, `"xls"`, `"ppt"`, `"pps"`, `"msg"`, `"vsd"`, `"mpp"`)
- `clsid`: canonical CLSID (only present in the `matched: true & matchType: "ole2-with-clsid"` variant)

### `Tier2ZIPResult`
```typescript
export type Tier2ZIPResult =
  | { matched: true; format: string; family: "ooxml" | "odf"; matchType: "zip-with-ooxml-or-odf" }
  | { matched: true; format: "zip"; family: "plain"; matchType: "exact-unique-signature" }
  | { matched: false };
```

**Field rules**:
- For `family: "ooxml"`: format ∈ `{"docx","docm","xlsx","xlsm","pptx","ppsx","pptm"}`
- For `family: "odf"`: format ∈ `{"odt","ods","odp","odg"}`
- For `family: "plain"`: format === `"zip"`

### `Tier3Result`
```typescript
export type Tier3Result =
  | { matched: true; format: "xml" | "html" | "eml" | "dxf" | "csv" | "txt"; matchType: "text-heuristic" }
  | { matched: false; reason: "binary-bytes" | "no-pattern-matched" };
```

**Field rules**:
- `format` is exactly one of the six allowed strings; priority order is the order listed in FR-4 (XML > HTML > EML > DXF > CSV > TXT)

### `ZIPEntry`
```typescript
export interface ZIPEntry {
  filename: string;        // raw filename bytes decoded as UTF-8
  uncompressed: boolean;   // true if compression method == 0 (Stored)
  position: number;        // byte offset within the buffer (for diagnostics)
}
```

---

## 4. `OLE2ParseError` Discriminator

```typescript
export type OLE2ParseError =
  | "non-standard-sector-size"   // sectorSize at offset 30 != 0x0009
  | "directory-beyond-window"    // computed directory_offset + 128 > 4100
  | "missing-ole2-signature";    // buffer doesn't start with D0 CF 11 E0 A1 B1 1A E1
```

**Behavioural rule (per Q4=A, edge cases #1 #2):** When `OLE2Parser.parseCLSID` returns any of these errors, `Tier2OLE2Detector` falls back to extension-based identification — it does NOT return `Tier2OLE2Result.matched: false`.

---

## 5. `ScoringInput`

```typescript
export interface ScoringInput {
  matchType: MatchType;
  detectedFormat: string | null;        // null when matchType === "no-match"
  extension: string | null;              // lowercased file extension from §4.1 hints
  contentType: string | null;            // S3 Content-Type header from §4.1 hints
}
```

**Field rules**:
- `extension`: lowercase, no leading dot (e.g., `"pdf"` not `".pdf"`). Null when absent from input.
- `contentType`: full MIME type string (e.g., `"application/pdf"`). Null when absent.
- `detectedFormat`: lowercased; null only when `matchType === "no-match"`.

**Relationship to `Scorer`**: this is the entire input — the score is a pure function of these four fields.

---

## 6. `CategoryDecision`

```typescript
export interface CategoryDecision {
  category: Category;
  subCategory: SubCategory;
}
```

**Invariant** (per Q4=A and §4.2): `CategoryMapper.map` returns `null` (not a `CategoryDecision`) when the `detectedFormat` is not in the FR-6 table. The orchestrator handles `null` by routing to `category="slipsheet"`.

---

## 7. `SlipsheetInput` and `SlipsheetDecision`

```typescript
export interface SlipsheetInput {
  score: number;                                           // ∈ [0, 1]
  threshold: number;                                       // ∈ [0, 1]
  detectedFormat: string | null;
  parentArchiveDepth: number;                              // ≥ 0
  maxZipDepth: number;                                     // ≥ 0
  quarantineMacros: boolean;
  slipsheetRules: Record<string, "always-slipsheet">;      // workspace-policy rules per format
}

export interface SlipsheetDecision {
  slipsheet: boolean;
  reason: SlipsheetReason;
}
```

**Invariants**:
- If `slipsheet === false`, `reason === null`.
- If `slipsheet === true`, `reason !== null`.
- Reason precedence (when multiple conditions trigger):
  1. `"workspace-policy"` wins over `"max-zip-depth"` wins over `"low-confidence"`.
  2. Rationale: workspace-policy is the most-explicit operator intent; depth is a security boundary; low-confidence is the fallback.

---

## 8. Entity Flow Through the Classify Pipeline

```
Input: TaskPayload (from §4.1)
   │
   ▼
[Tier1FileTypeDetector] ──► Tier1Result
   │
   ├─ matched: true  ──► extract { format, matchType: "exact-unique-signature" }
   │
   ▼ (on Tier 1 miss)
[Tier2OLE2Detector]    ──► Tier2OLE2Result
   │   (uses OLE2Parser  ──► Result<CLSID, OLE2ParseError>)
   │
   ▼ (on Tier 2 OLE2 miss + ZIP signature)
[Tier2ZIPDetector]     ──► Tier2ZIPResult
   │   (uses ZIPMarkerParser ──► ZIPEntry[])
   │
   ▼ (on all Tier 2 miss)
[Tier3TextDetector]    ──► Tier3Result
   │
   ▼
Consolidate to { matchType, detectedFormat, detectionTier }
   │
   ▼
[Scorer]              ──► number ∈ [0, 1]
   │
   ▼
[CategoryMapper]      ──► CategoryDecision | null
   │
   ▼
[SlipsheetDecider]    ──► SlipsheetDecision
   │
   ▼
Output: ClassificationOutput (from `component-methods.md`)
```

All entities are immutable. The orchestrator builds the final `ClassificationOutput` by composing these results — no entity is ever mutated after creation.
