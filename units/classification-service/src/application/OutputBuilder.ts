import type { BuildOutputInput, ClassificationOutput, OutputBuilder } from "./types.js";

export function createOutputBuilder(): OutputBuilder {
  return Object.freeze({
    build(input: BuildOutputInput): ClassificationOutput {
      const {
        documentId, workspaceId, policyVersion, contentHash, isDuplicate,
        detectionState, slipsheetDecision, confidenceScore, categoryDecision,
      } = input;

      // Slipsheet path overrides category
      if (slipsheetDecision.slipsheet) {
        return {
          documentId,
          workspaceId,
          classification: {
            format: detectionState.detectedFormat ?? "unknown",
            category: "slipsheet",
            subCategory: null,
            confidenceScore,
            detectionTier: detectionState.tier,
            isForcedSlipsheet: true,
            slipsheetReason: slipsheetDecision.reason,
          },
          dedup: { contentHash, isDuplicate },
          policyVersion,
        };
      }

      // Unknown format -> fall into slipsheet with low-confidence reason (BR-3-OUT-3)
      if (categoryDecision === null) {
        return {
          documentId,
          workspaceId,
          classification: {
            format: detectionState.detectedFormat ?? "unknown",
            category: "slipsheet",
            subCategory: null,
            confidenceScore,
            detectionTier: detectionState.tier,
            isForcedSlipsheet: true,
            slipsheetReason: "low-confidence",
          },
          dedup: { contentHash, isDuplicate },
          policyVersion,
        };
      }

      return {
        documentId,
        workspaceId,
        classification: {
          format: detectionState.detectedFormat ?? "unknown",
          category: categoryDecision.category,
          subCategory: categoryDecision.subCategory,
          confidenceScore,
          detectionTier: detectionState.tier,
          isForcedSlipsheet: false,
          slipsheetReason: null,
        },
        dedup: { contentHash, isDuplicate },
        policyVersion,
      };
    },
  });
}
