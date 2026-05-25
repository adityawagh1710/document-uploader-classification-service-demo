import { describe, it } from "vitest";
import fc from "fast-check";
import { fileTypeFromBuffer } from "file-type";
import { createTier1FileTypeDetector } from "../../src/domain/tier1-filetype/index.js";

describe("PBT — Tier1 FileType", () => {
  const detector = createTier1FileTypeDetector();

  it("PBT-U1-004 — oracle: detector output matches file-type library directly", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 8, maxLength: 200 }), async (buf) => {
        const result = await detector.detect(buf);
        const oracle = await fileTypeFromBuffer(buf);
        if (oracle === undefined) return result.matched === false;
        return result.matched === true && result.ext === oracle.ext && result.mime === oracle.mime;
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-005 — idempotence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 8, maxLength: 200 }), async (buf) => {
        const a = await detector.detect(buf);
        const b = await detector.detect(buf);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      { numRuns: 100 },
    );
  });
});
