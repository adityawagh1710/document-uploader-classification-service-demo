export interface S3Streamer {
  // AsyncIterable may throw mid-stream; orchestrator catches and maps to S3Error.
  stream(input: { bucket: string; key: string }): AsyncIterable<Uint8Array>;
}

export type { S3Error } from "./S3Reader.js";
