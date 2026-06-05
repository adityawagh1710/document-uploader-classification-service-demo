import { fileTypeFromBuffer } from "file-type";
import type { Tier1FileTypeDetector, Tier1Result } from "./types.js";

export function createTier1FileTypeDetector(): Tier1FileTypeDetector {
  return Object.freeze({
    async detect(buffer: Uint8Array): Promise<Tier1Result> {
      const result = await fileTypeFromBuffer(buffer);
      if (!result) return { matched: false };
      return { matched: true, ext: result.ext, mime: result.mime };
    },
  });
}
