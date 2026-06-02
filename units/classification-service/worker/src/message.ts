import { z } from "zod";

/**
 * Convert claim-check — the message body the `/api/classify` route enqueues
 * to the convert queue when `category === "convert"`. Shape mirrors the
 * archive fan-out's claim-check (see `src/ports/ArchiveDispatcher.ts`), with
 * convert-specific extras: `filename` (office-convert hints content-type from
 * the extension) and `runId` (the classifications-dev sort key — saves the
 * worker from having to Query to locate the row to UpdateItem).
 *
 * Stable shape — used by both the dispatcher (feat/05) and the worker.
 * Schema is the source of truth; any field rename here is a coordinated
 * change across both branches + a redeploy in lock-step.
 */
export const ConvertClaimSchema = z.object({
  /**
   * Pipeline execution id — placeholder today (= documentId), populated by
   * the Step Functions execution id in production when the prod pipeline
   * exists. Carried end-to-end for correlation; never used to key DDB.
   */
  pipelineExecutionId: z.string().min(1),
  /** = workspaceId in classification-service. DDB partition key. */
  tenantId: z.string().min(1),
  documentId: z.string().min(1),
  /**
   * = classifications-dev sort key (`<ISO-ts>#<documentId>`). Lets the worker
   * UpdateItem directly instead of Querying. Stable for the life of the row.
   */
  runId: z.string().min(1),
  /** s3://{sourceBucket}/{sourceKey} is the office-convert s3_input. */
  sourceBucket: z.string().min(1),
  sourceKey: z.string().min(1),
  /** Original upload name. Drives office-convert's format detection. */
  filename: z.string().min(1),
  /** "office" | "tiff" | "convert-then-ocr" | null — for future routing. */
  subCategory: z.string().nullable(),
  /** End-to-end correlation id stamped into every log line for this run. */
  correlationId: z.string().min(1),
});

export type ConvertClaim = z.infer<typeof ConvertClaimSchema>;

export function parseConvertClaim(
  body: string,
): { ok: true; claim: ConvertClaim } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: `invalid_json: ${(e as Error).message}` };
  }
  const result = ConvertClaimSchema.safeParse(raw);
  if (!result.success) {
    // zod's error has structured `issues` but a flat single-line summary is
    // friendlier in JSON-lines log output.
    const summary = result.error.issues
      .map((i) => `${i.path.join(".")}:${i.message}`)
      .join("; ");
    return { ok: false, error: `schema_mismatch: ${summary}` };
  }
  return { ok: true, claim: result.data };
}
