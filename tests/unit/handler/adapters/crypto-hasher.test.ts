import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createNodeCryptoHasher } from "../../../../src/adapters/crypto/index.js";

async function* fromString(s: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(s);
}

async function* multiChunk(parts: string[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield new TextEncoder().encode(p);
}

describe("NodeCryptoHasher", () => {
  const hasher = createNodeCryptoHasher();

  it("computes SHA-256 of empty stream", async () => {
    const hash = await hasher.sha256((async function* () {})());
    // SHA-256 of empty input
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches Node createHash for 'hello'", async () => {
    const expected = createHash("sha256").update("hello").digest("hex");
    const actual = await hasher.sha256(fromString("hello"));
    expect(actual).toBe(expected);
  });

  it("produces the same hash regardless of chunk boundaries", async () => {
    const single = await hasher.sha256(fromString("hello world"));
    const split = await hasher.sha256(multiChunk(["hello", " ", "world"]));
    expect(single).toBe(split);
  });

  it("produces 64 hex chars (256 bits)", async () => {
    const hash = await hasher.sha256(fromString("test content"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
