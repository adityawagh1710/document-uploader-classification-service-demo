import { type S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type { S3Reader, S3Error } from "../../ports/S3Reader.js";
import type { S3Streamer } from "../../ports/S3Streamer.js";
import { mapS3Error } from "./map-s3-error.js";

export interface S3AdapterDeps {
  readonly s3: S3Client;
  readonly logger: Logger;
}

const S3_TIMEOUT_MS = 5_000;

// Combined adapter implementing both S3Reader and S3Streamer.
export function createS3Adapter(deps: S3AdapterDeps): S3Reader & S3Streamer {
  const { s3, logger } = deps;

  return Object.freeze({
    async getRange(input: { bucket: string; key: string; start: number; end: number }):
      Promise<Result<Uint8Array, S3Error>> {
      const start = performance.now();
      logger.debug("s3.getRange.start", { bucket: input.bucket, key: input.key });

      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Range: `bytes=${input.start}-${input.end}`,
          }),
          { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) },
        );

        const chunks: Uint8Array[] = [];
        const body = response.Body;
        if (body === undefined) return err("object-not-found");

        // SDK v3 returns a node Readable stream in Lambda; iterate via for-await.
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        const buffer = concatChunks(chunks);

        logger.debug("s3.getRange.ok", {
          bucket: input.bucket,
          durationMs: Math.round(performance.now() - start),
          bytes: buffer.length,
        });
        return ok(buffer);
      } catch (e) {
        const mapped = mapS3Error(e);
        logger.error("s3.getRange.error", {
          bucket: input.bucket,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },

    async *stream(input: { bucket: string; key: string }): AsyncIterable<Uint8Array> {
      logger.debug("s3.stream.start", { bucket: input.bucket, key: input.key });
      const response = await s3.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      const body = response.Body;
      if (body === undefined) {
        const e = new Error("S3 object body is undefined");
        e.name = "NoSuchKey";
        throw e;
      }
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        yield chunk;
      }
    },
  });
}

function concatChunks(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
