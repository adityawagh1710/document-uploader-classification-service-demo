import type { Result } from "../shared/result.js";

export type S3Error =
  | "object-not-found"
  | "access-denied"
  | "transient"
  | "throttled"
  | "unknown";

export interface S3Reader {
  getRange(input: { bucket: string; key: string; start: number; end: number }):
    Promise<Result<Uint8Array, S3Error>>;
}
