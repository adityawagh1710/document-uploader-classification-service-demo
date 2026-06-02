import { request, type Dispatcher } from "undici";
import type { Logger } from "./logger.js";

/**
 * Outcome of a single `/v1/convert` call.
 *
 * - `success`: 200 OK, PDF was written to `s3_output`. We drained the stream
 *   to confirm the upload completed (office-convert writes the PDF AS it
 *   streams the response — abandoning the stream early could truncate the S3
 *   object).
 * - `caller_error`: 4xx — the request was rejected (unsupported format,
 *   bucket not allowlisted, etc.). NOT retryable; we mark the row failed and
 *   delete the SQS message.
 * - `server_error`: 5xx — office-convert crashed or is unhealthy. Retryable;
 *   we DON'T delete the message so SQS redelivers after visibility timeout.
 * - `network_error`: connection refused, DNS failure, TLS error, abort.
 *   Same retry semantics as server_error.
 * - `timeout`: our local HTTP timeout fired before office-convert responded.
 *   Retryable up to maxReceiveCount; eventually DLQ.
 */
export type ConvertOutcome =
  | { kind: "success"; requestId: string; status: number; outputBucket?: string; outputKey?: string }
  | { kind: "caller_error"; status: number; failureClass: string; detail: string; requestId?: string }
  | { kind: "server_error"; status: number; failureClass: string; detail: string; requestId?: string }
  | { kind: "network_error"; cause: string }
  | { kind: "timeout"; afterMs: number };

export interface OfficeConvertClient {
  convert(args: ConvertArgs): Promise<ConvertOutcome>;
}

export interface ConvertArgs {
  /** s3://bucket/key — must be in office-convert's `s3_input` allowlist. */
  readonly s3Input: string;
  /** s3://bucket/key — must be in office-convert's `s3_output` allowlist. */
  readonly s3Output: string;
  /** Surfaces in logs + ties our convertRequestId field on the DDB row. */
  readonly correlationId: string;
}

export interface OfficeConvertClientDeps {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  /** Override for tests — defaults to undici's global dispatcher. */
  readonly dispatcher?: Dispatcher;
}

export function createOfficeConvertClient(
  deps: OfficeConvertClientDeps,
): OfficeConvertClient {
  const { baseUrl, timeoutMs, logger } = deps;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/convert`;

  return {
    async convert(args) {
      // FormData is the cleanest way to model office-convert's multipart
      // contract on the server side too — the s3_input / s3_output fields
      // are `Annotated[str | None, Form()]` in server.py, so undici needs to
      // submit them as form fields, not JSON or query params.
      const form = new FormData();
      form.append("s3_input", args.s3Input);
      form.append("s3_output", args.s3Output);

      const start = performance.now();
      logger.info("office_convert.request.start", {
        s3Input: args.s3Input,
        s3Output: args.s3Output,
        correlationId: args.correlationId,
        timeoutMs,
      });

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs).unref();
      try {
        const res = await request(url, {
          method: "POST",
          body: form,
          signal: ac.signal,
          bodyTimeout: timeoutMs,
          headersTimeout: timeoutMs,
          ...(deps.dispatcher !== undefined ? { dispatcher: deps.dispatcher } : {}),
        });
        const requestId = String(
          res.headers["x-request-id"] ?? res.headers["X-Request-Id"] ?? "",
        );
        const outputBucket = String(
          res.headers["x-s3-output-bucket"] ?? res.headers["X-S3-Output-Bucket"] ?? "",
        );
        const outputKey = String(
          res.headers["x-s3-output-key"] ?? res.headers["X-S3-Output-Key"] ?? "",
        );
        const durationMs = Math.round(performance.now() - start);

        if (res.statusCode === 200) {
          // Drain the PDF body before we treat this as success. office-convert
          // writes to S3 as it streams the response back to us — abandoning
          // the stream early can truncate the s3_output object.
          await drain(res.body);
          logger.info("office_convert.request.ok", {
            status: 200,
            durationMs,
            requestId,
            outputBucket,
            outputKey,
            correlationId: args.correlationId,
          });
          return {
            kind: "success",
            requestId,
            status: 200,
            ...(outputBucket ? { outputBucket } : {}),
            ...(outputKey ? { outputKey } : {}),
          };
        }

        // Non-200: read body for the JSON error envelope.
        let bodyText = "";
        try {
          bodyText = await res.body.text();
        } catch (e) {
          bodyText = `<body-read-failed: ${(e as Error).message}>`;
        }
        const parsed = safeParseJson(bodyText);
        const failureClass =
          typeof parsed?.failure_class === "string" ? parsed.failure_class : "unknown";
        const detail =
          typeof parsed?.detail === "string" ? parsed.detail : bodyText.slice(0, 500);

        const kind: ConvertOutcome["kind"] =
          res.statusCode >= 500 ? "server_error" : "caller_error";
        logger.warn("office_convert.request.non2xx", {
          status: res.statusCode,
          durationMs,
          requestId,
          failureClass,
          detail,
          kind,
          correlationId: args.correlationId,
        });
        return {
          kind,
          status: res.statusCode,
          failureClass,
          detail,
          ...(requestId ? { requestId } : {}),
        };
      } catch (e) {
        const durationMs = Math.round(performance.now() - start);
        const isAbort = (e as Error)?.name === "AbortError" || ac.signal.aborted;
        if (isAbort) {
          logger.error("office_convert.request.timeout", {
            durationMs,
            timeoutMs,
            correlationId: args.correlationId,
          });
          return { kind: "timeout", afterMs: durationMs };
        }
        const cause = (e as Error)?.message ?? String(e);
        logger.error("office_convert.request.network_error", {
          durationMs,
          cause,
          correlationId: args.correlationId,
        });
        return { kind: "network_error", cause };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function drain(body: Dispatcher.ResponseData["body"]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of body) {
    // discard — we just need to fully consume the stream.
  }
}

function safeParseJson(s: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
