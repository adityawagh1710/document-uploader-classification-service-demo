import fc from "fast-check";
import type { TaskPayload } from "../../../src/shared/types.js";
import type {
  BuildOutputInput,
  ClassificationFailure,
  DetectionState,
} from "../../../src/application/index.js";

export const validTaskPayloadGen: fc.Arbitrary<TaskPayload> = fc.record({
  taskToken: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.length > 0),
  workspaceId: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.length > 0),
  documentId: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.length > 0),
  s3: fc.record({
    bucket: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.length > 0),
    key: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.length > 0),
  }),
  hints: fc.record({
    extension: fc.oneof(fc.constantFrom("pdf", "docx", "msg", "eml", "txt"), fc.constant(null)),
    contentType: fc.oneof(fc.constantFrom("application/pdf", "text/html"), fc.constant(null)),
  }),
  context: fc.record({
    parentArchiveDepth: fc.integer({ min: 0, max: 10 }),
    overrideDuplicateCheck: fc.boolean(),
  }),
});

const sdkErrorReasonGen = fc.constantFrom("object-not-found", "access-denied", "transient", "throttled", "unknown") as fc.Arbitrary<"object-not-found" | "access-denied" | "transient" | "throttled" | "unknown">;
const storeErrorReasonGen = fc.constantFrom("conditional-check-failed", "throttled", "transient", "not-found", "unknown") as fc.Arbitrary<"conditional-check-failed" | "throttled" | "transient" | "not-found" | "unknown">;
const signalErrorReasonGen = fc.constantFrom("task-not-found", "transient", "unknown") as fc.Arbitrary<"task-not-found" | "transient" | "unknown">;

export const classificationFailureGen: fc.Arbitrary<ClassificationFailure> = fc.oneof(
  fc.record({
    kind: fc.constant("input-validation" as const),
    field: fc.string({ minLength: 1, maxLength: 20 }),
    message: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  fc.record({
    kind: fc.constant("s3" as const),
    reason: sdkErrorReasonGen,
  }),
  fc.record({
    kind: fc.constant("store" as const),
    reason: storeErrorReasonGen,
  }),
  fc.record({
    kind: fc.constant("signal" as const),
    reason: signalErrorReasonGen,
  }),
  fc.record({
    kind: fc.constant("unexpected" as const),
    message: fc.string({ minLength: 1, maxLength: 40 }),
  }),
);

const detectionTierGen = fc.constantFrom("file-type", "ole2-clsid", "zip-marker", "text-heuristic", "extension-fallback") as fc.Arbitrary<"file-type" | "ole2-clsid" | "zip-marker" | "text-heuristic" | "extension-fallback">;
const matchTypeGen = fc.constantFrom(
  "exact-unique-signature",
  "ole2-with-clsid",
  "zip-with-ooxml-or-odf",
  "ole2-or-zip-ext-fallback",
  "text-heuristic",
  "extension-only",
  "no-match",
) as fc.Arbitrary<"exact-unique-signature" | "ole2-with-clsid" | "zip-with-ooxml-or-odf" | "ole2-or-zip-ext-fallback" | "text-heuristic" | "extension-only" | "no-match">;

export const detectionStateGen: fc.Arbitrary<DetectionState> = fc.record({
  tier: detectionTierGen,
  detectedFormat: fc.oneof(fc.constantFrom("pdf", "docx", "msg", "eml"), fc.constant(null)),
  matchType: matchTypeGen,
});

const categoryGen = fc.constantFrom("ocr-direct", "media", "convert", "email", "archive") as fc.Arbitrary<"ocr-direct" | "media" | "convert" | "email" | "archive">;
// `subCategoryGen` was used by the prior unconstrained generator. The tightened
// version below (PBT-U3-004 invariant: subCategory non-null ⇒ category=convert)
// inlines the non-null branch, so no standalone arbitrary is needed.

export const buildOutputInputGen: fc.Arbitrary<BuildOutputInput> = fc.record({
  documentId: fc.string({ minLength: 1, maxLength: 30 }),
  workspaceId: fc.string({ minLength: 1, maxLength: 30 }),
  policyVersion: fc.string({ minLength: 1, maxLength: 10 }),
  contentHash: fc.string({ minLength: 64, maxLength: 64 }),
  isDuplicate: fc.boolean(),
  detectionState: detectionStateGen,
  slipsheetDecision: fc.oneof(
    fc.record({
      slipsheet: fc.constant(false as const),
      reason: fc.constant(null),
    }),
    fc.record({
      slipsheet: fc.constant(true as const),
      reason: fc.constantFrom("workspace-policy", "max-zip-depth", "low-confidence") as fc.Arbitrary<"workspace-policy" | "max-zip-depth" | "low-confidence">,
    }),
  ),
  confidenceScore: fc.float({ min: 0, max: 1, noNaN: true }),
  categoryDecision: fc.oneof(
    // Any category with subCategory = null is always valid.
    fc.record({
      category: categoryGen,
      subCategory: fc.constant(null) as fc.Arbitrary<null>,
    }),
    // subCategory non-null is only valid for category = "convert" — this is
    // the invariant the real CategoryMapper produces and PBT-U3-004 asserts.
    fc.record({
      category: fc.constant("convert" as const),
      subCategory: fc.constantFrom("office", "image", "tiff", "html", "convert-then-ocr") as fc.Arbitrary<"office" | "image" | "tiff" | "html" | "convert-then-ocr">,
    }),
    fc.constant(null),
  ),
});
