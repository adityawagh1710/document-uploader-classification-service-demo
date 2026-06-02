import { describe, it } from "vitest";
import fc from "fast-check";
import {
  createInputValidator,
  createOutputBuilder,
  mapFailureToErrorCode,
} from "../../src/application/index.js";
import {
  validTaskPayloadGen,
  classificationFailureGen,
  buildOutputInputGen,
} from "./generators/handler.gen.js";

describe("PBT — Handler", () => {
  const validator = createInputValidator();
  const builder = createOutputBuilder();

  it("PBT-U3-001 — InputValidator JSON round-trip preserves valid payloads", () => {
    fc.assert(
      fc.property(validTaskPayloadGen, (payload) => {
        const serialised = JSON.parse(JSON.stringify(payload)) as unknown;
        const result = validator.validate(serialised);
        return result.ok && JSON.stringify(result.value) === JSON.stringify(payload);
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U3-002 — InputValidator: missing required field always returns Result.error('input-validation')", () => {
    fc.assert(
      fc.property(
        validTaskPayloadGen,
        fc.constantFrom("taskToken", "workspaceId", "documentId"),
        (payload, fieldToRemove) => {
          const broken: Record<string, unknown> = { ...payload };
          delete broken[fieldToRemove];
          const result = validator.validate(broken);
          return !result.ok && result.error.kind === "input-validation";
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PBT-U3-003 — OutputBuilder: slipsheetReason !== null iff isForcedSlipsheet === true", () => {
    fc.assert(
      fc.property(buildOutputInputGen, (input) => {
        const out = builder.build(input);
        const isForced = out.classification.isForcedSlipsheet;
        const hasReason = out.classification.slipsheetReason !== null;
        return isForced === hasReason;
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U3-004 — OutputBuilder: subCategory !== null only when category === 'convert'", () => {
    fc.assert(
      fc.property(buildOutputInputGen, (input) => {
        const out = builder.build(input);
        if (out.classification.subCategory === null) return true;
        return out.classification.category === "convert";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U3-005 — mapFailureToErrorCode totality: every kind maps to non-empty code", () => {
    fc.assert(
      fc.property(classificationFailureGen, (failure) => {
        const { code, message } = mapFailureToErrorCode(failure);
        return typeof code === "string" && code.length > 0
          && typeof message === "string" && message.length > 0;
      }),
      { numRuns: 100 },
    );
  });
});
