# Requirements — Classification Service

> Consolidated requirements document. Derived from `technical_input.md` (authoritative source) and the 23 clarifying answers in `requirement-verification-questions.md`.

---

## 1. Intent Analysis Summary

| Aspect | Value |
|---|---|
| User Request | "Using AI-DLC can you understand requirements" — bootstrap a greenfield Classification Service component for a document-ingestion pipeline. |
| Request Type | New Project (greenfield) |
| Scope Estimate | Single Component (Classification Service) with multiple AWS integrations (S3, DynamoDB, Step Functions) |
| Complexity Estimate | Complex — multi-tier binary detection, mixed-endian CLSID parsing, container disambiguation, deduplication, conditional slipsheet routing |
| Depth Selected | Comprehensive |
| Authoritative Inputs | `technical_input.md` v1 + `requirement-verification-questions.md` answers |

### 1.1 Project Purpose
The Classification Service is the **first decision point** in a document-ingestion pipeline. For every file entering the pipeline it answers, in order:

1. **What is this file, really?** — independent of file extension or MIME header
2. **Have we already processed it?** — content-hash deduplication
3. **Where should it go next?** — category + sub-category routing into a Step Function

### 1.2 Non-Goals
- Does **not** perform conversion, OCR, extraction, or content transformation
- Does **not** open archives or recurse into containers
- Does **not** persist file content; only persists SHA-256 hash and classification metadata

---

## 2. Functional Requirements

### FR-1: Three-Tier File Type Detection
The service shall identify the **true** file format from binary content using a three-tier strategy, falling back through tiers only when the prior tier yields no result.

- **Tier 1 — Library match.** Use the `file-type` JavaScript library against the first 4,100 bytes obtained via an S3 ranged GET.
- **Tier 2 — Container disambiguation.** Custom layer registered with `file-type` that disambiguates two ambiguous binary signatures:
  - OLE2 (`D0 CF 11 E0 A1 B1 1A E1`) — Root Entry CLSID extraction
  - ZIP (`50 4B 03 04`) — local file header marker inspection
- **Tier 3 — Text heuristic.** Invoked only when Tiers 1 and 2 produce no match.

### FR-2: OLE2 CLSID Disambiguation
When the OLE2 signature is detected, the Tier 2 custom layer shall:

| Step | Operation | Detail |
|---|---|---|
| 1 | Read sector size | File offset 30 (2-byte LE uint). Standard `0x0009` (512 B/sector). Non-standard → extension fallback. |
| 2 | Read first directory sector ID | File offset 48 (4-byte signed int, little-endian). |
| 3 | Compute directory byte offset | `512 * (1 + sector_id)`. |
| 4 | Bounds-check the directory sector | Root Entry is 128 bytes; CLSID begins at byte 80. If `directory_offset + 128 > 4100`, fall back to extension. |
| 5 | Read the CLSID | Bytes 80–95 of Root Entry. **Mixed-endian**: bytes 0–3 LE DWORD, 4–5 LE WORD, 6–7 LE WORD, 8–15 big-endian. |

**CLSID → format mapping:**

| CLSID | Format | Category |
|---|---|---|
| `00020906-0000-0000-C000-000000000046` | Word (.doc) | `convert` / sub-category `convert-then-ocr` |
| `00020820-0000-0000-C000-000000000046` | Excel (.xls) | `convert` / sub-category `convert-then-ocr` |
| `64818D10-4F9B-11CF-86EA-00AA00B929E8` | PowerPoint (.ppt/.pps) | `convert` / sub-category `convert-then-ocr` |
| `00020D0B-0000-0000-C000-000000000046` | Outlook Message (.msg) | `email` |
| `00020900-0000-0000-C000-000000000046` | Visio (.vsd) | `convert` / sub-category `convert-then-ocr` |

> **Resolved by Q1=C:** `convert-then-ocr` is a sub-category under `category=convert`, not a distinct top-level category. The Step Function output enum (§4.2) remains `ocr-direct | media | convert | email | archive | slipsheet`.

> **Resolved by Q3=A:** MPP (Microsoft Project) files have no CLSID mapping; OLE2 detection without a CLSID match falls back to extension-based identification (score 0.70) → `category=convert`, `subCategory=office`.

### FR-3: ZIP Container Disambiguation
When the ZIP signature is detected, scan the first few entry filenames:

- `[Content_Types].xml` as the **first** entry → **OOXML** (DOCX/XLSX/PPTX family)
- An uncompressed `mimetype` entry → **ODF** (ODT/ODS/ODP/ODG)
- Neither present → treat as a **standard ZIP archive** (category `archive`)

### FR-4: Text Heuristic Detection (Tier 3)
First, screen the buffer for binary bytes in ranges `0x00–0x08` and `0x0E–0x1F`, **excluding ESC (`0x1B`)**. If any such byte is found, the tier returns no match.

Otherwise, evaluate signatures in this fixed priority order:

| Priority | Format | Heuristic | Confidence |
|---|---|---|---|
| 1 | XML | Starts with `<?xml` (optional BOM allowed) | HIGH |
| 2 | HTML | Contains `<html`, `<!DOCTYPE html`, or `<head` in first 1 KB | MEDIUM |
| 3 | EML | ≥ 2 RFC 5322 headers (`From:`, `Received:`, `Date:`, …) in first 1 KB | MEDIUM |
| 4 | DXF | Contains `SECTION`/`HEADER` keyword sequence | MEDIUM |
| 5 | CSV | ≥ 3 lines with a consistent delimiter (`,`, `\t`, `;`, `\|`) | LOW |
| 6 | TXT | No binary bytes; no other pattern matched | FALLBACK |

### FR-5: Confidence Scoring
Each detection produces a base score; modifiers from the file extension and the S3 `Content-Type` header adjust it.

**Base scores:**

| Match type | Base score |
|---|---|
| Exact unique signature | 0.95 |
| OLE2 with valid CLSID | 0.90 |
| ZIP with OOXML/ODF marker | 0.90 |
| OLE2/ZIP with extension fallback | 0.70 |
| Text heuristic match | 0.65 |
| Extension only (no magic bytes) | 0.40 |
| No match | 0.00 |

**Modifiers:**

| Signal | Corroborates | Contradicts | Absent |
|---|---|---|---|
| File extension | +0.05 | −0.15 | 0.00 |
| S3 `Content-Type` header | +0.05 | −0.10 | 0.00 |

**Decision rule:**
```
score = clamp(base + ext_mod + content_type_mod, 0.0, 1.0)
classified = score > threshold     // threshold workspace-configurable; default 0.5
```

A `score ≤ threshold` routes the file to `category=slipsheet` (rule is `>`, not `≥`).

### FR-6: Processing Category Assignment

| Formats | Detected by | Category |
|---|---|---|
| PDF, JPEG, PNG, BMP | file-type | `ocr-direct` |
| GIF, MP3 (ID3), WAV, OGG, MP4/MOV | file-type | `media` |
| RTF, DWG, TIFF (LE), TIFF (BE) | file-type | `convert` |
| DOC, XLS, PPT/PPS, VSD | OLE2 CLSID | `convert` (sub-category `convert-then-ocr`) |
| MSG | OLE2 CLSID | `email` |
| MPP | OLE2 → extension fallback (Q3=A) | `convert` (sub-category `office`) |
| DOCX, XLSX, PPTX, PPSX, DOCM, XLSM, PPTM, ODT, ODS, ODP, ODG | ZIP/OOXML | `convert` (see FR-6.1 for macro-enabled handling) |
| ZIP (no OOXML/ODF markers) | ZIP/OOXML | `archive` |
| TXT, HTML, CSV, XML, DXF | Text heuristic | `convert` |
| EML | Text heuristic | `email` |

**Sub-categories (assigned when category=`convert`):**

| `subCategory` | Extensions |
|---|---|
| `office` | DOC, DOCX, DOCM, XLS, XLSX, XLSM, PPT, PPTX, PPSX, **PPS**, PPTM, ODT, ODS, ODP, ODG, RTF, **MPP** |
| `image` | PNG, JPG, BMP, GIF |
| `tiff` | TIF, TIFF (wins over `image` per Q2=A) |
| `html` | HTML, HTM |
| `convert-then-ocr` | DOC, XLS, PPT, PPS, VSD (the OLE2 Office formats requiring OCR after conversion) |

> **Resolved by Q2=A:** `tiff` sub-category wins over `image` for `.tif`/`.tiff` files.
> **Resolved by Q4=A:** `PPSX` (ZIP/OOXML) and `PPS` (OLE2 CLSID) are added to the `office` sub-category extension list.

#### FR-6.1: Macro-Enabled Office Formats (Q5=C)
DOCM / XLSM / PPTM (macro-enabled OOXML formats) follow a **workspace-policy-driven** routing:
- Workspace config exposes a boolean `quarantineMacros` (default `false`)
- When `quarantineMacros=false`: same `convert` path as non-macro counterparts
- When `quarantineMacros=true`: forced `category=slipsheet`, `isForcedSlipsheet=true`, `slipsheetReason="workspace-policy"`

### FR-7: Deduplication
After detection and category assignment, the service shall:

1. Compute the **SHA-256** of the source file's bytes via streaming (per NFR-2).
2. Look up `(workspaceId, contentHash)` in the **`content-hashes`** DynamoDB table.
3. **Miss:** write the hash record with classification metadata; continue the pipeline.
4. **Hit:** halt the pipeline (short-circuit), **unless** the document is flagged as an override (FR-8) OR the cached `policyVersion` differs from the current workspace policy version (FR-7.1).

#### FR-7.1: Policy-Versioned Cache (Q13=B)
- Every `content-hashes` record stores `policyVersion` — the workspace policy version under which classification was performed
- On a duplicate hit, compare cached `policyVersion` against the current workspace policy version
- **Mismatch** → re-classify under current policy; overwrite the record with the new classification and `policyVersion`
- **Match** → short-circuit as duplicate

#### FR-7.2: Hash Record Update Semantics (Q15=C)
- **Override hits** (`overrideDuplicateCheck=true`): existing record is **fully immutable** — nothing is updated.
- **Non-override hits**: existing record's `format`, `firstSeenAt`, `firstDocumentId`, and `policyVersion` are **immutable**; `lastSeenAt` and `hitCount` are updated (increment `hitCount`, set `lastSeenAt` to now).

#### FR-7.3: Hash Collision Policy (Q12=A)
No secondary check beyond SHA-256 — collisions are cryptographically infeasible. Byte-length comparison is **not** required.

### FR-8: Forced-Slipsheet Override
The pipeline shall divert to slipsheet generation in three cases:

1. **Workspace policy:** the workspace is configured to always slipsheet a particular document type (e.g., `quarantineMacros=true`).
2. **ZIP depth enforcement:** the current file's nesting depth exceeds the workspace's `maxZipDepth`.
3. **Low confidence:** the final score ≤ threshold (this is naturally folded into the slipsheet path).

Forced-slipsheet bypasses normal category assignment but **does not** bypass the duplicate check unless `overrideDuplicateCheck=true`.

#### FR-8.1: Slipsheet Output Schema (Q6=B — Standard)
Slipsheet output includes:
- `category="slipsheet"`, `isForcedSlipsheet=true`
- `documentId`, `workspaceId`
- `detectedFormat` (best-effort, may be `null` if classification produced no result)
- `confidenceScore` (final score after modifiers)
- `slipsheetReason` enum: `"workspace-policy" | "max-zip-depth" | "low-confidence"`

### FR-9: State Machine Signaling
On successful classification (including slipsheet diversion), the service shall call `SendTaskSuccess` on the Step Function with at minimum:

- `category`, `subCategory` (when applicable)
- `detectedFormat`, `confidenceScore`
- `contentHash`
- `isDuplicate`, `isForcedSlipsheet`, `slipsheetReason` (when `isForcedSlipsheet=true`)
- `workspaceId`, `documentId`
- `detectionTier` (which tier produced the result)
- `policyVersion`

On unrecoverable failure (e.g., S3 object NotFound, malformed required-field input), the service shall call `SendTaskFailure` with a structured error code and message.

### FR-10: Retry Policy (Q9=C)
- **Layer 1 — AWS SDK retries**: standard mode, max 3 retries with exponential backoff
- **Layer 2 — Step Function task retry**: the State Machine retries the Lambda invocation on transient failures (handler is idempotent per NFR-5 + FR-7)
- **`SendTaskFailure`** is called only on genuinely unrecoverable conditions after both layers exhaust

---

## 3. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The first read from S3 shall be a ranged GET of **exactly the first 4,100 bytes** — never the full object. |
| NFR-2 | The SHA-256 computation streams the object; full-file buffering in memory is prohibited. |
| NFR-3 | The 4,100-byte detection window is fixed; any logic that assumes more must explicitly fall back. |
| NFR-4 | Workspace isolation is mandatory — `content-hashes` lookups must be scoped by `workspaceId`. |
| NFR-5 | Classification must be deterministic for a given `(bytes, extension, contentType, workspaceConfig, policyVersion)` tuple. |
| NFR-6 | All thresholds, score weights, sub-category precedence, `maxZipDepth`, and `quarantineMacros` must be config-driven, not hard-coded. |
| NFR-7 | Service must emit structured logs sufficient to reconstruct the tier-by-tier decision for any document. |
| NFR-8 | Observability stack: structured JSON logs to CloudWatch Logs; custom CloudWatch metrics per emitted category, per detection tier, and for end-to-end latency; AWS X-Ray tracing (Q10=A). |
| NFR-9 | Concurrency: one Lambda invocation per Step Function task — no batching (Q11=A). |
| NFR-10 | `content-hashes` TTL is configurable per workspace; default no TTL (Q14=B). |

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
  "workspaceId": "string",
  "classification": {
    "format": "string",
    "category": "ocr-direct | media | convert | email | archive | slipsheet",
    "subCategory": "office | image | tiff | html | convert-then-ocr | null",
    "confidenceScore": 0.0,
    "detectionTier": "file-type | ole2-clsid | zip-marker | text-heuristic | extension-fallback",
    "isForcedSlipsheet": false,
    "slipsheetReason": "workspace-policy | max-zip-depth | low-confidence | null"
  },
  "dedup": {
    "contentHash": "sha256-hex",
    "isDuplicate": false
  },
  "policyVersion": "string"
}
```

### 4.3 Persistence — `content-hashes` DynamoDB table
| Attribute | Type | Notes |
|---|---|---|
| `workspaceId` | S | Partition key |
| `contentHash` | S | Sort key (SHA-256 hex) |
| `firstSeenAt` | S | ISO-8601, immutable after first write |
| `firstDocumentId` | S | The document that introduced the hash, immutable |
| `format` | S | Detected format at first ingest, immutable |
| `policyVersion` | S | Workspace policy version at classification, refreshed only on policy-mismatch re-classify |
| `lastSeenAt` | S | ISO-8601, updated on every non-override duplicate hit |
| `hitCount` | N | Incremented on every non-override duplicate hit |
| `expiresAt` | N (TTL) | Optional, populated only when workspace TTL config is set |

### 4.4 Persistence — `workspace-config` DynamoDB table (Q8=C)
| Attribute | Type | Notes |
|---|---|---|
| `workspaceId` | S | Partition key |
| `policyVersion` | S | Monotonically updated when any policy field changes |
| `threshold` | N | Classification threshold (default 0.5) |
| `maxZipDepth` | N | Max nested archive depth before forced slipsheet |
| `quarantineMacros` | BOOL | If true, route DOCM/XLSM/PPTM → slipsheet (default false) |
| `slipsheetRules` | M | Map of format → "always slipsheet" rules |
| `hashTtlDays` | N | Optional; populated only when workspace requires record expiry |

---

## 5. Edge Cases & Decision Branches

| # | Edge case | Required behavior |
|---|---|---|
| 1 | OLE2 with non-standard sector size | Skip CLSID read, extension fallback (score 0.70). |
| 2 | OLE2 directory beyond 4,100-byte window | Extension fallback. |
| 3 | OLE2 CLSID not in lookup table (e.g., MPP) | Extension fallback (score 0.70). |
| 4 | ZIP with `[Content_Types].xml` not first | Not OOXML; check for ODF mimetype; else plain ZIP. |
| 5 | Text buffer contains ESC (`0x1B`) but no other binary bytes | Still text-eligible; ESC excluded from binary-byte set. |
| 6 | Extension and detected format conflict | Apply −0.15 modifier; if score still > threshold, trust magic-byte result. |
| 7 | Score lands exactly on threshold | Treat as **not classified** — route to `slipsheet` with `slipsheetReason="low-confidence"`. |
| 8 | Duplicate hash hit + `overrideDuplicateCheck=true` | Continue pipeline; do not update the existing hash record. |
| 9 | ZIP at `parentArchiveDepth ≥ maxZipDepth` | Forced slipsheet with `slipsheetReason="max-zip-depth"`; do not emit `category=archive`. |
| 10 | TIFF detected via file-type | `category=convert`, `subCategory=tiff` (wins over `image`). |
| 11 | S3 object smaller than 4,100 bytes | Use available bytes; OLE2 bounds-check naturally degrades to extension fallback. |
| 12 | Duplicate hash hit + cached `policyVersion` mismatch | Re-classify; overwrite record. (Q13=B) |
| 13 | DOCM/XLSM/PPTM + `quarantineMacros=true` | Forced slipsheet with `slipsheetReason="workspace-policy"`. |

---

## 6. Architecture & Integration

| Concern | Decision | Source |
|---|---|---|
| Runtime | AWS Lambda (Node.js 20.x or later) | Q7=A |
| Language | TypeScript (strict mode); compiled to JS for Lambda deploy | Q18=A |
| Entry point | Step Function task with task-token callback pattern | §6 input doc |
| S3 | Ranged GET for detection window; streaming read for SHA-256 | NFR-1, NFR-2 |
| DynamoDB | `content-hashes` table (FR-7), `workspace-config` table (Q8=C) |
| Step Functions | `SendTaskSuccess` / `SendTaskFailure` | FR-9 |
| Workspace config | DynamoDB `workspace-config` table, one read per invocation | Q8=C |
| Observability | CloudWatch Logs + custom CloudWatch metrics + AWS X-Ray | Q10=A, NFR-8 |
| Retry strategy | SDK retries + Step Function task retry; handler idempotent | Q9=C, FR-10 |

---

## 7. Local Development & Testing

| Concern | Decision | Rationale Source |
|---|---|---|
| Test framework | **Vitest** (TypeScript-native, fast, supports `fast-check`) | Q20=A |
| PBT framework | **fast-check** (per PBT-09 mapping for TypeScript) | Q17=A, PBT-09 |
| Local AWS emulation | **LocalStack community edition** via `testcontainers`; SDK clients point at `http://localhost:4566` | Q19=A |
| Dev runner — daily loop | **Direct Node invocation** of the handler against LocalStack with synthetic Step Function task events (JSON files) | Q21=D |
| Dev runner — pre-PR | **AWS SAM Local** invoke against LocalStack for Lambda-runtime fidelity (cold start, layers, env wiring) | Q21=D |
| Binary fixtures | **Hybrid** — committed real binaries under `tests/fixtures/` for AC-1…AC-8 + programmatic byte-level generators for OLE2/ZIP property-based shrinks | Q22=D |
| Coverage gate | **90% branch** on classification logic (`src/classifier/**`); **70% branch** on integration glue | Q23=A |
| Lint / format | ESLint + Prettier (deferred to Code Generation planning for exact rule set) | — |

### 7.1 Local Test Tiers
1. **Pure-logic unit tests** (no LocalStack) — CLSID parsing, ZIP marker scan, text heuristic, scoring math. Runs in milliseconds.
2. **PBT tests** (no LocalStack) — round-trip CLSID encoding, byte-buffer invariants, scoring monotonicity, dedup idempotency. `fast-check` with seed logging on failure.
3. **Integration tests** (LocalStack) — AC-1…AC-8 acceptance criteria with real S3 fixtures, DynamoDB writes, and Step Function task tokens. `testcontainers` starts LocalStack once per run.
4. **Smoke tests** (SAM Local + LocalStack) — runs handler in Lambda Docker runtime against LocalStack-emulated AWS. Catches runtime regressions (memory, cold start, environment).

---

## 8. Acceptance Criteria

- **AC-1:** Given a `.docx` whose extension has been renamed to `.pdf`, the service shall detect `docx`, emit `category=convert`, `subCategory=office`, and apply the −0.15 extension contradiction modifier.
- **AC-2:** Given an OLE2 file with a non-standard sector size, the service shall fall back to extension identification and emit a base score of 0.70.
- **AC-3:** Given two uploads of byte-identical files within the same workspace, the second shall short-circuit with `isDuplicate=true` and not advance the Step Function.
- **AC-4:** Given the same two uploads across two different workspaces, both shall proceed normally.
- **AC-5:** Given a ZIP at `parentArchiveDepth = maxZipDepth`, the service shall emit `isForcedSlipsheet=true`, `category=slipsheet`, `slipsheetReason="max-zip-depth"`.
- **AC-6:** Given a file whose final score equals the threshold exactly, the service shall emit `category=slipsheet`, `slipsheetReason="low-confidence"`.
- **AC-7:** Given an `.msg` file, the service shall emit `category=email` via OLE2 CLSID `00020D0B-…`.
- **AC-8:** Given an `.eml` file (text), the service shall emit `category=email` via the text heuristic tier with ≥ 2 RFC 5322 headers.
- **AC-9 (new from Q13):** Given a duplicate hash hit where cached `policyVersion` differs from current workspace policy, the service shall re-classify, overwrite the record with new `policyVersion`, and treat as a non-duplicate result.
- **AC-10 (new from Q5):** Given a `.docm` file in a workspace with `quarantineMacros=true`, the service shall emit `category=slipsheet`, `isForcedSlipsheet=true`, `slipsheetReason="workspace-policy"`.
- **AC-11 (new from Q15):** Given a non-override duplicate hit, the existing record's `lastSeenAt` is updated and `hitCount` incremented; `format`, `firstSeenAt`, `firstDocumentId` unchanged.

---

## 9. Assumptions (Confirmed)

- The 4,100-byte detection window is sufficient for all in-scope formats; no format requires deeper magic-byte inspection at this stage.
- The `file-type` library version selected supports the custom layer / fallback registration interface used by Tier 2.
- Workspace configuration is read once per invocation; no live config-change handling is required mid-classification.
- All files reach the service via S3; no direct upload path bypasses this stage.

---

## 10. Extension Compliance Summary

### 10.1 SECURITY (opted IN — Q16=A)
The following rules apply to this service. Compliance will be re-evaluated at each subsequent stage (Application Design, NFR Design, Infrastructure Design, Code Generation, Build and Test).

| Rule | Applicability | Notes |
|---|---|---|
| SECURITY-01 — Encryption at rest & in transit | **Applies** | S3 bucket + DynamoDB tables MUST have SSE enabled; TLS enforced for all SDK calls. |
| SECURITY-02 — Access logging on network intermediaries | **N/A** | No load balancers, API gateways, or CDNs in this service. |
| SECURITY-03 — Application-level logging | **Applies** | CloudWatch Logs with structured JSON; correlation ID = `taskToken` or `documentId`; no PII in logs. |
| SECURITY-04 — HTTP security headers | **N/A** | Service has no HTML-serving endpoints. |
| SECURITY-05 — Input validation | **Applies** | Step Function input payload MUST be schema-validated (e.g., Zod, AJV) before processing. |
| SECURITY-06 — Least-privilege IAM | **Applies** | Lambda execution role MUST scope to specific S3 bucket ARNs, specific DynamoDB table ARNs, and `states:SendTaskSuccess`/`SendTaskFailure` on the specific State Machine. |
| SECURITY-07 — Restrictive network configuration | **Applies** | Lambda in private subnet; VPC endpoints for S3, DynamoDB, Step Functions where possible. |
| SECURITY-08 — Application-level access control | **Applies (limited)** | Object-level authorization implicit via `workspaceId` partition key on `content-hashes`; MUST verify the requested S3 object's prefix is within the workspace's scope. |
| SECURITY-09 — Hardening & misconfiguration | **Applies** | No default credentials; error responses to Step Function are generic; S3 bucket public access blocked. |
| SECURITY-10 — Supply chain | **Applies** | `package-lock.json` committed; `npm audit` in CI; SBOM generation; pinned Lambda runtime + base layer versions. |
| SECURITY-11 — Secure design | **Applies** | Classification logic isolated in `src/classifier/`; rate limiting via Lambda reserved concurrency; abuse case = ZIP-bomb depth attack handled by FR-8 + `maxZipDepth`. |
| SECURITY-12 — Auth & credential mgmt | **N/A** | No user authentication; service-to-service auth via IAM. No hardcoded secrets. |
| SECURITY-13 — Software & data integrity | **Applies** | No unsafe deserialization; `package-lock.json` integrity hashes verified; CI pipeline access-controlled; critical changes to `workspace-config` auditable. |
| SECURITY-14 — Alerting & monitoring | **Applies** | CloudWatch alarms on `SendTaskFailure` rate, on auth failures (unauthorized S3 object access), and on classification latency p99. CloudWatch Logs retention ≥ 90 days. |
| SECURITY-15 — Exception handling & fail-safe defaults | **Applies** | Global error handler at Lambda entry point; fail-closed on any S3/DynamoDB error → `SendTaskFailure`; resources cleaned in `finally` blocks. |

### 10.2 PBT (opted IN — Q17=A)
Property-based testing is mandatory for this service. Compliance will be enforced in Functional Design (PBT-01), NFR Requirements (PBT-09), Code Generation, and Build and Test stages.

| Rule | Status at this stage |
|---|---|
| PBT-01 — Property identification during design | **Deferred** — properties will be enumerated in Functional Design. Pre-identified candidates: round-trip CLSID encoding (PBT-02), scoring monotonicity invariant (PBT-03), dedup idempotency (PBT-04), tier-fallback oracle test against the spec's truth table (PBT-05). |
| PBT-09 — Framework selection | **Compliant** — `fast-check` selected (TypeScript / Vitest integration). |
| All other PBT rules | **Deferred** to Code Generation. |

---

## 11. Key Requirements Summary

**Functional core**: Multi-tier file-type detection (file-type library → OLE2 CLSID disambiguation → ZIP container disambiguation → text heuristic), with confidence scoring modulated by extension and Content-Type signals. Category routing into a Step Function with deduplication via SHA-256 content hashing scoped per workspace.

**Critical resolved ambiguities**:
- `convert-then-ocr` is a **sub-category** under `convert` (Q1=C)
- `tiff` sub-category wins over `image` for TIFFs (Q2=A)
- Macro-enabled formats follow workspace-policy `quarantineMacros` flag (Q5=C)
- Slipsheet payload includes `slipsheetReason` enum (Q6=B)
- `content-hashes` records carry `policyVersion` for self-healing re-classification (Q13=B)
- Non-override duplicate hits update `lastSeenAt` + `hitCount` (Q15=C)

**Operational core**: AWS Lambda (Node.js 20+, TypeScript strict), DynamoDB for `content-hashes` and `workspace-config`, Step Function task-token callback pattern, CloudWatch + X-Ray observability, SDK + Step Function dual-layer retry.

**Quality core**: 90% branch coverage on classifier; PBT for byte-level invariants; LocalStack for integration-test fidelity; SAM Local for pre-PR Lambda-runtime smoke; security baseline (SECURITY-01…15) enforced from design onward.

**Risk profile**: Multi-tier byte parsing (mixed-endian CLSID is a known bug source) + untrusted binary input (ZIP bombs, malformed OLE2) + workspace isolation requirements → PBT and security baselines are not optional.
