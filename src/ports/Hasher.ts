export interface Hasher {
  // Streaming SHA-256; returns hex-encoded digest.
  sha256(stream: AsyncIterable<Uint8Array>): Promise<string>;
}
