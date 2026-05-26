import { type Result, ok, err } from "../shared/result.js";
import type {
  ClassificationFailure,
  ClassificationOutput,
  ClassificationService,
  ClassificationServiceDeps,
  DetectionState,
} from "./types.js";
import type { TaskPayload, WorkspaceConfig } from "../shared/types.js";
import type { StoreError } from "../ports/ContentHashStore.js";
import type { S3Error } from "../ports/S3Reader.js";
import { buildContentHashRecord } from "../adapters/dynamo-content-hashes/index.js";
import { runStep } from "./run-step.js";
import { createOutputBuilder } from "./OutputBuilder.js";

const DETECTION_WINDOW_BYTES = 4100;
const OUTPUT_BUILDER = createOutputBuilder();

export function createClassificationService(deps: ClassificationServiceDeps): ClassificationService {
  return Object.freeze({
    async classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>> {
      const stepDeps = { logger: deps.logger, workspaceId: payload.workspaceId };

      // STEP 2: load-workspace-config
      const configResult = await runStep(stepDeps, "classify.step2.load-workspace-config", () =>
        deps.workspaceConfigStore.get(payload.workspaceId),
      );
      if (!configResult.ok) {
        return err({ kind: "store", reason: configResult.error });
      }
      const config = configResult.value;

      // STEP 3: read-detection-window
      const bufferResult = await runStep(stepDeps, "classify.step3.read-detection-window", () =>
        deps.s3Reader.getRange({
          bucket: payload.s3.bucket,
          key: payload.s3.key,
          start: 0,
          end: DETECTION_WINDOW_BYTES - 1,
        }),
      );
      if (!bufferResult.ok) {
        return err({ kind: "s3", reason: bufferResult.error });
      }
      const buffer = bufferResult.value;

      // STEPS 4-7: detect tiers (pure logic)
      const detectionState = await runStep(stepDeps, "classify.steps4-7.detect", () =>
        detectInSequence(deps, buffer, payload.hints),
      );

      // STEP 8: score (pure)
      const confidenceScore = deps.scorer.score({
        matchType: detectionState.matchType,
        detectedFormat: detectionState.detectedFormat,
        extension: payload.hints.extension,
        contentType: payload.hints.contentType,
      });

      // STEP 9: map-category (pure)
      const categoryDecision = detectionState.detectedFormat !== null
        ? deps.categoryMapper.map(detectionState.detectedFormat, detectionState.tier)
        : null;

      // STEP 10: decide-slipsheet (pure)
      const slipsheetDecision = deps.slipsheetDecider.decide({
        score: confidenceScore,
        threshold: config.threshold,
        detectedFormat: detectionState.detectedFormat,
        parentArchiveDepth: payload.context.parentArchiveDepth,
        maxZipDepth: config.maxZipDepth,
        quarantineMacros: config.quarantineMacros,
        slipsheetRules: config.slipsheetRules,
      });

      // STEP 11: stream-hash
      const hashResult = await runStep<Result<string, S3Error>>(stepDeps, "classify.step11.stream-hash", async () => {
        try {
          const stream = deps.s3Streamer.stream({
            bucket: payload.s3.bucket,
            key: payload.s3.key,
          });
          const contentHash = await deps.hasher.sha256(stream);
          return ok(contentHash);
        } catch (e) {
          return err(classifyStreamError(e));
        }
      });
      if (!hashResult.ok) {
        return err({ kind: "s3", reason: hashResult.error });
      }
      const contentHash = hashResult.value;

      // STEP 12: dedup-decision
      const finalFormat = deriveFinalFormat(detectionState);
      const dedupResult = await runStep<Result<{ isDuplicate: boolean }, StoreError>>(
        stepDeps,
        "classify.step12.dedup-decision",
        () => dedupDecide({
          deps,
          payload,
          config,
          contentHash,
          finalFormat,
          now: deps.nowProvider(),
        }),
      );
      if (!dedupResult.ok) {
        return err({ kind: "store", reason: dedupResult.error });
      }
      const { isDuplicate } = dedupResult.value;

      // STEP 13: build-output
      const output = OUTPUT_BUILDER.build({
        documentId: payload.documentId,
        workspaceId: payload.workspaceId,
        policyVersion: deps.policyVersionExtractor(config),
        contentHash,
        isDuplicate,
        detectionState,
        slipsheetDecision,
        confidenceScore,
        categoryDecision,
      });

      return ok(output);
    },
  });
}

// ---- Sub-procedures ---------------------------------------------------

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

// `file-type` returns these container types when it sees the magic bytes
// without seeing the refinement markers further in the file. They must fall
// through to the Tier 2 refiners (OLE2 CLSID parser / ZIP marker parser) to
// be turned into a usable specific format.
const GENERIC_TIER1_CONTAINERS = new Set<string>(["cfb", "zip"]);

function hasSignature(buffer: Uint8Array, signature: ReadonlyArray<number>): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

export async function detectInSequence(
  deps: ClassificationServiceDeps,
  buffer: Uint8Array,
  hints: { extension: string | null; contentType: string | null },
): Promise<DetectionState> {
  // Tier 1
  const t1 = await deps.tier1.detect(buffer);
  // `file-type` returns generic container types when its detection window
  // doesn't include the refinement hints (e.g. OOXML's [Content_Types].xml
  // sits past the first 4 KiB on big files). Fall through to the Tier 2
  // refiners so they can identify the specific format:
  //   - `cfb` → Tier 2 OLE2 reads the root-storage CLSID → doc/xls/ppt/msg
  //   - `zip` → Tier 2 ZIP scans local-file-header entries → docx/xlsx/pptx
  //     (OOXML), odt/ods/odp (ODF), or stays as `zip` for plain archives
  if (t1.matched && !GENERIC_TIER1_CONTAINERS.has(t1.ext.toLowerCase())) {
    return {
      tier: "file-type",
      detectedFormat: t1.ext.toLowerCase(),
      matchType: "exact-unique-signature",
    };
  }

  // Tier 2 OLE2 (signature-conditional)
  if (hasSignature(buffer, OLE2_SIGNATURE)) {
    const t2ole2 = deps.tier2OLE2.detect(buffer, hints.extension);
    if (t2ole2.matched) {
      return {
        tier: t2ole2.matchType === "ole2-or-zip-ext-fallback" ? "extension-fallback" : "ole2-clsid",
        detectedFormat: t2ole2.format,
        matchType: t2ole2.matchType,
        ...(t2ole2.matchType === "ole2-with-clsid" && "clsid" in t2ole2 && { clsid: t2ole2.clsid }),
      };
    }
  }

  // Tier 2 ZIP (signature-conditional)
  if (hasSignature(buffer, ZIP_SIGNATURE)) {
    const t2zip = deps.tier2ZIP.detect(buffer, hints.extension);
    if (t2zip.matched) {
      return {
        tier: "zip-marker",
        detectedFormat: t2zip.format,
        matchType: t2zip.matchType,
      };
    }
  }

  // Tier 3 text heuristic
  const t3 = deps.tier3Text.detect(buffer);
  if (t3.matched) {
    return {
      tier: "text-heuristic",
      detectedFormat: t3.format,
      matchType: "text-heuristic",
    };
  }

  // No match - extension-only fallback if hints provide
  if (hints.extension) {
    return {
      tier: "extension-fallback",
      detectedFormat: hints.extension.toLowerCase().replace(/^\./, ""),
      matchType: "extension-only",
    };
  }

  return { tier: "extension-fallback", detectedFormat: null, matchType: "no-match" };
}

async function dedupDecide(args: {
  deps: ClassificationServiceDeps;
  payload: TaskPayload;
  config: WorkspaceConfig;
  contentHash: string;
  finalFormat: string;
  now: string;
}): Promise<Result<{ isDuplicate: boolean }, StoreError>> {
  const { deps, payload, config, contentHash, finalFormat, now } = args;

  const existingResult = await deps.contentHashStore.get({
    workspaceId: payload.workspaceId,
    contentHash,
  });
  if (!existingResult.ok) return err(existingResult.error);

  const existing = existingResult.value;

  // CASE A: no existing record
  if (existing === null) {
    const newRecord = buildContentHashRecord({
      workspaceId: payload.workspaceId,
      contentHash,
      format: finalFormat,
      policyVersion: config.policyVersion,
      firstDocumentId: payload.documentId,
      now,
      hashTtlDays: config.hashTtlDays,
    });
    const putResult = await deps.contentHashStore.putIfAbsent(newRecord);
    if (!putResult.ok) return err(putResult.error);
    return ok({ isDuplicate: false });
  }

  // CASE B: override flag
  if (payload.context.overrideDuplicateCheck) {
    return ok({ isDuplicate: true });
  }

  // CASE C: policy-version mismatch
  if (existing.policyVersion !== config.policyVersion) {
    const refreshedRecord = buildContentHashRecord({
      workspaceId: payload.workspaceId,
      contentHash,
      format: finalFormat,
      policyVersion: config.policyVersion,
      firstDocumentId: payload.documentId,
      now,
      hashTtlDays: config.hashTtlDays,
    });
    const replaceResult = await deps.contentHashStore.replaceOnPolicyMismatch({
      record: refreshedRecord,
      expectedStalePolicyVersion: existing.policyVersion,
    });
    if (!replaceResult.ok) return err(replaceResult.error);
    return ok({ isDuplicate: false });
  }

  // CASE D: clean duplicate
  const updateResult = await deps.contentHashStore.updateOnDuplicateHit({
    workspaceId: payload.workspaceId,
    contentHash,
    now,
  });
  if (!updateResult.ok) return err(updateResult.error);
  return ok({ isDuplicate: true });
}

function deriveFinalFormat(state: DetectionState): string {
  return state.detectedFormat ?? "unknown";
}

function classifyStreamError(e: unknown): S3Error {
  if (!(e instanceof Error)) return "unknown";
  if (e.name === "NoSuchKey" || e.name === "NotFound") return "object-not-found";
  if (e.name === "AccessDenied" || e.name === "Forbidden") return "access-denied";
  if (e.name === "TimeoutError" || e.name === "AbortError") return "transient";
  const code = (e as Error & { code?: string }).code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT") return "transient";
  return "unknown";
}
