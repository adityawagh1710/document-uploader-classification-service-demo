# Technical Input — Classification Service

> AIDLC technical input document. This file is the authoritative source for downstream AIDLC artifacts (intent → units of work → design → code → tests) for the **Classification Service** component of the document-processing pipeline.

---

## 1. Context & Intent

### 1.1 Purpose
The Classification Service is the **first decision point** in a document-ingestion pipeline. For every file that enters the pipeline it must answer three questions, in order:

1. **What is this file, really?** (independent of extension or MIME header)
2. **Have we already processed it?** (content-hash deduplication)
3. **Where should it go next?** (category + sub-category routing into a Step Function)

### 1.2 Position in the Pipeline
- **Upstream:** Files land in S3; a Step Function task token is passed to this service.
- **This service:** Reads, classifies, hashes, decides routing, and signals the state machine.
- **Downstream:** Conversion, OCR, email-extract, archive-extract, media, or slipsheet branches — selected by the category this service emits.

### 1.3 Non-Goals
- The service does **not** perform conversion, OCR, extraction, or transformation of content.
- It does **not** open archives or recurse into containers; it only flags them for the archive branch.
- It does **not** persist file content; it persists only the SHA-256 hash and classification metadata.

---

## 2. Functional Requirements

### FR-1 — File Type Detection
The service shall identify the **true** file format from binary content using a three-tier strategy, falling back through tiers only when the prior tier yields no result.

**Tier 1 — Library match.**
Use the `file-type` JavaScript library against the first 4,100 bytes obtained via an S3 ranged GET. If it returns an `{ext, mime}` pair, the format is considered resolved by Tier 1.

**Tier 2 — Container disambiguation.**
Two binary signatures are intentionally ambiguous and must be disambiguated by a custom layer registered with `file-type`:

| Signature (hex)            | Family | Members                                                                                       | Disambiguation method                    |
|----------------------------|--------|-----------------------------------------------------------------------------------------------|------------------------------------------|
| `D0 CF 11 E0 A1 B1 1A E1`  | OLE2   | DOC, XLS, PPT, PPS, MSG, VSD, MPP                                                             | Root Entry CLSID extraction              |
| `50 4B 03 04`              | ZIP    | ZIP, DOCX, DOCM, XLSX, XLSM, PPTX, PPTM, PPSX, ODT, ODS, ODP, ODG                             | Local file header marker inspection      |

**Tier 3 — Text heuristic.**
Invoked only when Tiers 1 and 2 produce no match. The buffer is first screened for binary bytes; if none, format signatures are tested in fixed priority order.

### FR-2 — OLE2 CLSID Disambiguation
When the OLE2 signature is found, the following algorithm shall run inside the Tier 2 custom layer:

| Step | Operation                                | Detail                                                                                                                                                                                                       |
|------|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1    | Read sector size                         | File offset 30 (2-byte unsigned int). Standard value `0x0009` (2^9 = 512 B/sector). Non-standard sector sizes **must** trigger extension fallback — the directory may sit beyond the 4,100-byte window.       |
| 2    | Read first directory sector ID           | File offset 48 (4-byte signed int, little-endian).                                                                                                                                                            |
| 3    | Compute directory byte offset            | `512 * (1 + sector_id)`. The `+1` accounts for the 512-byte header sector.                                                                                                                                    |
| 4    | Bounds-check the directory sector        | Root Entry is 128 bytes; CLSID begins at byte 80 within it. If `directory_offset + 128 > 4100`, fall back to extension-based identification.                                                                  |
| 5    | Read the CLSID                           | Bytes 80–95 of the Root Entry. Mixed-endian: bytes 0–3 LE DWORD, 4–5 LE WORD, 6–7 LE WORD, 8–15 big-endian.                                                                                                   |

**CLSID → format mapping:**

| CLSID                                    | Format               | Category            |
|------------------------------------------|----------------------|---------------------|
| `00020906-0000-0000-C000-000000000046`   | Word (.doc)          | `convert-then-ocr`  |
| `00020820-0000-0000-C000-000000000046`   | Excel (.xls)         | `convert-then-ocr`  |
| `64818D10-4F9B-11CF-86EA-00AA00B929E8`   | PowerPoint (.ppt/.pps) | `convert-then-ocr` |
| `00020D0B-0000-0000-C000-000000000046`   | Outlook Message (.msg) | `email-extract`   |
| `00020900-0000-0000-C000-000000000046`   | Visio (.vsd)         | `convert-then-ocr`  |

> **Note for AIDLC code-gen:** Mixed-endian CLSID parsing is a known source of bugs. Generate unit tests that round-trip each CLSID above from canonical hex to the 16-byte on-disk representation and back.

### FR-3 — ZIP Container Disambiguation
When the ZIP signature is found, scan the archive for the first few entry filenames:

- `[Content_Types].xml` as the **first** entry → **OOXML** (DOCX/XLSX/PPTX family).
- An uncompressed `mimetype` entry → **ODF** (ODT/ODS/ODP/ODG).
- Neither present → treat as a **standard ZIP archive** (category `archive`).

### FR-4 — Text Heuristic Detection (Tier 3)
First, scan the buffer for binary bytes in the ranges `0x00–0x08` and `0x0E–0x1F`, **excluding ESC (`0x1B`)**. If any such byte is found, the file is non-text and the tier returns no match.

Otherwise, evaluate signatures in this fixed priority order:

| Priority | Format | Heuristic                                                                          | Confidence |
|----------|--------|------------------------------------------------------------------------------------|------------|
| 1        | XML    | Starts with `<?xml` (optional BOM allowed)                                         | HIGH       |
| 2        | HTML   | Contains `<html`, `<!DOCTYPE html`, or `<head` in first 1 KB                       | MEDIUM     |
| 3        | EML    | ≥ 2 RFC 5322 headers (`From:`, `Received:`, `Date:`, …) in first 1 KB              | MEDIUM     |
| 4        | DXF    | Contains `SECTION`/`HEADER` keyword sequence                                       | MEDIUM     |
| 5        | CSV    | ≥ 3 lines with a consistent delimiter (`,`, `\t`, `;`, or `\|`)                    | LOW        |
| 6        | TXT    | No binary bytes; no other pattern matched                                          | FALLBACK   |

### FR-5 — Confidence Scoring
Each detection produces a base score; modifiers from the file extension and the S3 `Content-Type` header then adjust it.

**Base scores:**

| Match type                          | Base score |
|-------------------------------------|------------|
| Exact unique signature              | 0.95       |
| OLE2 with valid CLSID               | 0.90       |
| ZIP with OOXML/ODF marker           | 0.90       |
| OLE2/ZIP with extension fallback    | 0.70       |
| Text heuristic match                | 0.65       |
| Extension only (no magic bytes)     | 0.40       |
| No match                            | 0.00       |

**Modifiers:**

| Signal                  | Corroborates | Contradicts | Absent |
|-------------------------|--------------|-------------|--------|
| File extension          | +0.05        | −0.15       | 0.00   |
| S3 `Content-Type` header| +0.05        | −0.10       | 0.00   |

**Decision rule:**
```
score = clamp(base + ext_mod + content_type_mod, 0.0, 1.0)
classified = score > threshold     // threshold is workspace-configurable; default 0.5
```

A `score ≤ threshold` routes the file to the `slipsheet` category (see FR-8).

### FR-6 — Processing Category Assignment

| Formats                                                                                          | Detected by      | Category    |
|--------------------------------------------------------------------------------------------------|------------------|-------------|
| PDF, JPEG, PNG, BMP                                                                              | file-type        | `ocr-direct`|
| GIF, MP3 (ID3), WAV, OGG, MP4/MOV                                                                | file-type        | `media`     |
| RTF, DWG, TIFF (LE), TIFF (BE)                                                                   | file-type        | `convert`   |
| DOC, XLS, PPT/PPS, VSD                                                                           | OLE2 CLSID       | `convert`   |
| MSG                                                                                              | OLE2 CLSID       | `email`     |
| DOCX, XLSX, PPTX/PPSX, DOCM, XLSXM, PPTM, ODT/ODS/ODP/ODG                                         | ZIP/OOXML        | `convert`   |
| ZIP                                                                                              | ZIP/OOXML        | `archive`   |
| TXT, HTML, CSV, XML, DXF                                                                         | Text heuristic   | `convert`   |
| EML                                                                                              | Text heuristic   | `email`     |

When category is `convert`, the service must also assign a sub-category:

| `subCategory` | Extensions                                                          |
|---------------|---------------------------------------------------------------------|
| `office`      | DOC, DOCX, DOCM, XLS, XLSX, XLSM, PPT, PPTX, PPTM, ODF, RTF         |
| `image`       | PNG, JPG, BMP, GIF, TIFF                                            |
| `tiff`        | TIF, TIFF                                                           |
| `html`        | HTML, HTM                                                           |

> **Ambiguity to resolve at design time:** TIFF appears in both `image` and `tiff` sub-categories. AIDLC design phase must capture which takes precedence (working assumption: `tiff` is the specific sub-category and wins over `image` for `.tif`/`.tiff`).

### FR-7 — Deduplication
After detection and category assignment, the service shall:

1. Compute the **SHA-256** of the source file's bytes.
2. Look up the hash in the workspace-scoped **`content-hashes`** table.
3. **Miss:** write the hash with classification metadata; continue the pipeline.
4. **Hit:** halt the pipeline (short-circuit), **unless** the document is flagged as an override (see FR-8).

### FR-8 — Forced-Slipsheet Override
The pipeline shall divert to slipsheet generation in two cases:

1. **Workspace policy:** the workspace is configured to always slipsheet a particular document type.
2. **ZIP depth enforcement:** during archive expansion, the current file's nesting depth exceeds the workspace's `maxZipDepth`. The Classification Service must reject recursive embedding beyond this depth.

Forced-slipsheet bypasses normal category assignment but **does not** bypass the duplicate check unless the override flag is set.

### FR-9 — State Machine Signaling
On successful classification (including slipsheet diversion), the service shall call `SendTaskSuccess` on the Step Function with at minimum:

- `category`, `subCategory` (when applicable)
- `detectedFormat`, `confidenceScore`
- `contentHash`
- `isDuplicate`, `isForcedSlipsheet`
- `workspaceId`, `documentId`

On unrecoverable failure, the service shall call `SendTaskFailure` with a structured error.

---

## 3. Non-Functional Requirements

| ID     | Requirement                                                                                                      |
|--------|------------------------------------------------------------------------------------------------------------------|
| NFR-1  | The first read from S3 shall be a ranged GET of **exactly the first 4,100 bytes** — never the full object.       |
| NFR-2  | The SHA-256 computation streams the object; full-file buffering in memory is prohibited.                         |
| NFR-3  | The 4,100-byte detection window is fixed; any logic that assumes more must explicitly fall back.                 |
| NFR-4  | Workspace isolation is mandatory — `content-hashes` lookups must be scoped by `workspaceId`.                     |
| NFR-5  | Classification must be deterministic for a given `(bytes, extension, contentType, workspaceConfig)` tuple.       |
| NFR-6  | All thresholds, score weights, sub-category precedence, and `maxZipDepth` must be config-driven, not hard-coded. |
| NFR-7  | Service must emit structured logs sufficient to reconstruct the tier-by-tier decision for any document.           |

---

## 4. Data Contracts

### 4.1 Input — Step Function task payload
```jsonc
{
  "taskToken": "string",
  "workspaceId": "string",
  "documentId": "string",
  "s3": { "bucket": "string", "key": "string" },
  "hints": {
    "extension": "string | null",
    "contentType": "string | null"
  },
  "context": {
    "parentArchiveDepth": 0,
    "overrideDuplicateCheck": false
  }
}
```

### 4.2 Output — `SendTaskSuccess` payload
```jsonc
{
  "documentId": "string",
  "classification": {
    "format": "string",          // e.g. "docx", "pdf", "msg"
    "category": "ocr-direct | media | convert | email | archive | slipsheet",
    "subCategory": "office | image | tiff | html | null",
    "confidenceScore": 0.0,
    "detectionTier": "file-type | ole2-clsid | zip-marker | text-heuristic | extension-fallback",
    "isForcedSlipsheet": false
  },
  "dedup": {
    "contentHash": "sha256-hex",
    "isDuplicate": false
  }
}
```

### 4.3 Persistence — `content-hashes` table (DynamoDB)
| Attribute      | Type   | Notes                                                |
|----------------|--------|------------------------------------------------------|
| `workspaceId`  | S      | Partition key                                        |
| `contentHash`  | S      | Sort key (SHA-256 hex)                               |
| `firstSeenAt`  | S      | ISO-8601                                             |
| `firstDocumentId` | S   | The document that introduced the hash                |
| `format`       | S      | Detected format at first ingest                      |

---

## 5. Edge Cases & Decision Branches

| #  | Edge case                                                                  | Required behavior                                                                                                  |
|----|-----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| 1  | OLE2 with non-standard sector size                                          | Skip CLSID read, fall back to extension-based identification (score 0.70).                                          |
| 2  | OLE2 directory beyond 4,100-byte window                                     | Same as #1 — extension fallback.                                                                                    |
| 3  | OLE2 CLSID not in the lookup table                                          | Extension fallback (score 0.70).                                                                                    |
| 4  | ZIP with `[Content_Types].xml` not first                                    | Not OOXML; check for ODF mimetype; else treat as plain ZIP.                                                         |
| 5  | Text buffer contains ESC (`0x1B`) but no other binary bytes                 | Still considered text-eligible; ESC is excluded from the binary-byte set.                                           |
| 6  | Extension and detected format conflict                                      | Apply −0.15 modifier; if score still > threshold, trust the magic-byte result.                                      |
| 7  | Score lands exactly on threshold                                            | Treat as **not classified** — route to `slipsheet`. (Rule is `score > threshold`, not `≥`.)                          |
| 8  | Duplicate hash hit, but `overrideDuplicateCheck = true`                     | Continue pipeline; **do not** rewrite the existing hash record.                                                     |
| 9  | ZIP file at `parentArchiveDepth ≥ maxZipDepth`                              | Forced slipsheet; do not emit `category: archive`.                                                                  |
| 10 | TIFF detected via file-type                                                 | Category `convert`, sub-category `tiff` (more specific than `image`).                                               |
| 11 | S3 object smaller than 4,100 bytes                                          | Use whatever bytes are available; the OLE2 bounds-check naturally degrades to extension fallback.                   |

---

## 6. Architecture & Integration

- **Runtime:** Node.js (required by the `file-type` library and the custom layer extension model).
- **Entry point:** Step Function task with task-token callback pattern (long-running async).
- **External services:**
  - **S3** — ranged GET for detection window; full streaming read for hashing.
  - **DynamoDB** — `content-hashes` table, partitioned by `workspaceId`.
  - **Step Functions** — `SendTaskSuccess` / `SendTaskFailure`.
  - **Workspace config store** — source of threshold, slipsheet rules, and `maxZipDepth` (assumed DynamoDB or Parameter Store; AIDLC design phase to confirm).

---

## 7. Open Questions for AIDLC Clarification Phase

1. **TIFF sub-category precedence** — confirm `tiff` wins over `image` for `.tif`/`.tiff`, or define disambiguation.
2. **`convert-then-ocr` category** — the OLE2 CLSID table maps to `convert-then-ocr`, but FR-6 lists only `convert`. Is `convert-then-ocr` a distinct downstream category or a sub-category of `convert`?
3. **MPP (Microsoft Project)** — listed under the OLE2 family but absent from the CLSID lookup. Intended behavior on detection?
4. **`PPSX`** — listed in the ZIP family but not in the `office` sub-category extension list. Should it be added?
5. **DOCM/XLSM/PPTM macros** — same `convert` path as their non-macro counterparts, or quarantined?
6. **Slipsheet output schema** — what does the slipsheet branch need from this service beyond `isForcedSlipsheet`?
7. **Hash collision policy** — SHA-256 collisions are practically impossible, but is byte-length comparison required as a secondary check?
8. **Re-classification on workspace policy change** — if the slipsheet rules change, does the duplicate cache invalidate?

---

## 8. Assumptions (to be confirmed)

- The 4,100-byte detection window is sufficient for all in-scope formats; no format requires deeper magic-byte inspection at this stage.
- The `file-type` library version selected supports the custom layer / fallback registration interface used by Tier 2.
- Workspace configuration is read once per invocation; no live config-change handling is required mid-classification.
- All files reach the service via S3; no direct upload path bypasses this stage.

---

## 9. Acceptance Criteria (seed for downstream AIDLC test generation)

- **AC-1:** Given a `.docx` whose extension has been renamed to `.pdf`, the service shall detect `docx`, emit `category=convert`, `subCategory=office`, and apply the −0.15 extension contradiction modifier.
- **AC-2:** Given an OLE2 file with a non-standard sector size, the service shall fall back to extension identification and emit a base score of 0.70.
- **AC-3:** Given two uploads of byte-identical files within the same workspace, the second shall short-circuit with `isDuplicate=true` and not advance the Step Function.
- **AC-4:** Given the same two uploads across two different workspaces, both shall proceed normally.
- **AC-5:** Given a ZIP at `parentArchiveDepth = maxZipDepth`, the service shall emit `isForcedSlipsheet=true` and `category=slipsheet`.
- **AC-6:** Given a file whose final score equals the threshold exactly, the service shall emit `category=slipsheet`.
- **AC-7:** Given an `.msg` file, the service shall emit `category=email` via OLE2 CLSID `00020D0B-…`.
- **AC-8:** Given an `.eml` file (text), the service shall emit `category=email` via the text heuristic tier with ≥ 2 RFC 5322 headers.
