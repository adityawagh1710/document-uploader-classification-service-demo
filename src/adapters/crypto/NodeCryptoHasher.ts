import { createHash } from "node:crypto";
import type { Hasher } from "../../ports/Hasher.js";

// Streaming SHA-256 per NFR-2 — never buffers the full payload.
export function createNodeCryptoHasher(): Hasher {
  return Object.freeze({
    async sha256(stream: AsyncIterable<Uint8Array>): Promise<string> {
      const hash = createHash("sha256");
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      return hash.digest("hex");
    },
  });
}
