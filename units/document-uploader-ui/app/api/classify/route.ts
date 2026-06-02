import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import {
  ensureResourcesProvisioned,
  s3Client,
  BUCKET,
  archiveDispatcher,
  convertDispatcher,
  EMAIL_EXTRACTION_URL,
} from "@/lib/classifier";
import { recordFailure, recordSuccess } from "@/lib/stats";
import { recordRun } from "@/lib/runs";
import {
  recordEmailExtraction,
  type EmailExtractionResponse,
} from "@/lib/email-extractions";
// Type-only @svc imports are erased at compile time — they bundle nothing. The
// classification ENGINE is no longer embedded; we call the classification
// service's /classify endpoint over the wire instead (CLASSIFY_URL).
import type { TaskPayload } from "@svc/shared/types";
import type { ClassificationOutput, ClassificationFailure } from "@svc/application/index";

export const runtime = "nodejs";

// The classification service's synchronous classify endpoint (the wundergraph
// -router fronts the same surface for the createDocument flow; this legacy
// upload-then-classify route calls it directly). Default = local compose port.
const CLASSIFY_URL = (process.env.CLASSIFY_URL ?? "http://localhost:8091").replace(/\/+$/, "");

type ClassifyResult =
  | { ok: true; value: ClassificationOutput }
  | { ok: false; error: ClassificationFailure };

// classifyViaService replaces the former in-process getClassificationService()
// call — the engine now lives in the classification service, reached over HTTP.
async function classifyViaService(payload: TaskPayload): Promise<ClassifyResult> {
  const resp = await fetch(`${CLASSIFY_URL}/classify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (resp.ok) {
    return { ok: true, value: (await resp.json()) as ClassificationOutput };
  }
  const body = (await resp.json().catch(() => ({}))) as { error?: unknown };
  return {
    ok: false,
    error: (body.error ?? { kind: "unknown", reason: "classify-service-error" }) as ClassificationFailure,
  };
}
export const dynamic = "force-dynamic";

// Upload size guard — defensive cap for the test harness. The deployed
// Lambda streams reads and supports much larger objects (NFR-1 acceptance
// bar covers up to ~50 MB at p99 ≤ 15 s, but the underlying detection
// window is only the first 4100 bytes — the rest just feeds the SHA-256
// dedup hash). Raising this requires the upload path below to stay
// streaming, never buffering the full body into memory.
const MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

export async function POST(req: Request) {
  await ensureResourcesProvisioned();

  const form = await req.formData();
  const file = form.get("file");
  const workspaceId = (form.get("workspaceId") as string | null)?.trim() ?? "";
  // Pass through whatever the caller sent; the classifier auto-derives from
  // payload.s3.key when this is null (see extensionFromKey in
  // src/application/ClassificationService.ts), so no UI-side derivation here.
  const extensionHint = (form.get("extension") as string | null)?.trim() || null;
  const contentTypeHint = (form.get("contentType") as string | null)?.trim() || null;
  const overrideDuplicateCheck = form.get("overrideDuplicateCheck") === "true";
  const parentArchiveDepth = Number(form.get("parentArchiveDepth") ?? "0");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "missing workspaceId" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} > ${MAX_BYTES})` },
      { status: 413 },
    );
  }

  const inputName = (file as File).name || "upload.bin";
  const documentId = `doc-${randomUUID()}`;
  const objectKey = `ui/${documentId}/${inputName}`;

  try {
    // Stream upload via lib-storage's multipart Upload — never buffers the
    // full body in memory, so 1 GiB files don't OOM the container.
    // file.stream() returns a Web ReadableStream; Node's Readable.fromWeb
    // converts it for the SDK.
    const body = Readable.fromWeb(file.stream() as never);
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET,
        Key: objectKey,
        Body: body,
        ContentLength: file.size,
        ContentType: contentTypeHint ?? "application/octet-stream",
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024, // 8 MiB parts
    });
    await upload.done();
  } catch (e: unknown) {
    const rec = recordFailure({
      id: documentId,
      ts: new Date().toISOString(),
      inputName,
      workspaceId,
      elapsedMs: 0,
      failure: { kind: "s3", reason: "unknown" },
      objectKey,
    });
    await recordRun(rec);
    return NextResponse.json(
      { error: "s3 upload failed", detail: (e as Error)?.message },
      { status: 502 },
    );
  }

  const payload: TaskPayload = {
    taskToken: `ui-${randomUUID()}`,
    workspaceId,
    documentId,
    s3: { bucket: BUCKET, key: objectKey },
    hints: { extension: extensionHint, contentType: contentTypeHint },
    context: {
      parentArchiveDepth: Number.isFinite(parentArchiveDepth) ? parentArchiveDepth : 0,
      overrideDuplicateCheck,
    },
  };

  const start = Date.now();
  const result = await classifyViaService(payload);
  const elapsedMs = Date.now() - start;

  if (!result.ok) {
    const rec = recordFailure({
      id: documentId,
      ts: new Date().toISOString(),
      inputName,
      workspaceId,
      elapsedMs,
      failure: result.error,
      objectKey,
    });
    await recordRun(rec);
    // eslint-disable-next-line no-console
    console.error(
      "[classify] failed",
      JSON.stringify({
        documentId,
        objectKey,
        inputName,
        inputSize: file.size,
        workspaceId,
        hints: { extension: extensionHint, contentType: contentTypeHint },
        elapsedMs,
        error: result.error,
      }),
    );
    return NextResponse.json(
      { ok: false, error: result.error, elapsedMs, documentId, objectKey },
      { status: 422 },
    );
  }

  // Archive fan-out — mirror of the Lambda handler. Failures are logged but
  // never bubble up; classification is the primary contract.
  let archiveDispatch: "ok" | "skipped" | "failed" = "skipped";
  if (
    archiveDispatcher !== undefined &&
    result.value.classification.category === "archive"
  ) {
    const dispatch = await archiveDispatcher.dispatch({
      pipelineExecutionId: documentId,
      tenantId: workspaceId,
      documentId,
      sourceBucket: BUCKET,
      sourceKey: objectKey,
      correlationId: documentId,
    });
    archiveDispatch = dispatch.ok ? "ok" : "failed";
    if (!dispatch.ok) {
      // eslint-disable-next-line no-console
      console.error("[classify] archive dispatch failed", { documentId, error: dispatch.error });
    }
  }

  // Convert fan-out — parallel to archive. When category=convert, drop a
  // claim-check on the convert queue (feat/02) for the worker (feat/03+04)
  // to consume. `runId` is the classifications-dev SK that recordRun() will
  // compute the same way (ISO-ts # documentId) — we precompute it here so
  // the SQS body and the DDB row agree.
  //
  // DWG short-circuit: the worker also denies DWG (its 4-libs vendor path
  // has no Aspose.CAD), but we skip enqueue here too to avoid noisy queue
  // traffic + DLQ alarms for guaranteed-unsupported inputs. The UI still
  // gets a row marked convertStatus=failed via convertError below.
  const category = result.value.classification.category;
  const subCategory =
    "subCategory" in result.value.classification
      ? (result.value.classification as { subCategory: string | null }).subCategory ?? null
      : null;
  const isConvertCategory = category === "convert";
  const isDwg = /\.dwg$/i.test(inputName);
  let convertDispatch: "ok" | "skipped" | "failed" | "dwg-excluded" = "skipped";
  const runTs = new Date().toISOString();
  const runId = `${runTs}#${documentId}`;

  if (isConvertCategory && isDwg) {
    convertDispatch = "dwg-excluded";
  } else if (isConvertCategory && convertDispatcher !== undefined) {
    const dispatch = await convertDispatcher.dispatch({
      pipelineExecutionId: documentId,
      tenantId: workspaceId,
      documentId,
      runId,
      sourceBucket: BUCKET,
      sourceKey: objectKey,
      filename: inputName,
      subCategory,
      correlationId: documentId,
    });
    convertDispatch = dispatch.ok ? "ok" : "failed";
    if (!dispatch.ok) {
      // eslint-disable-next-line no-console
      console.error("[classify] convert dispatch failed", { documentId, error: dispatch.error });
    }
  }

  // Email fan-out — parallel to archive/convert, but over HTTP (App Runner)
  // instead of SQS. Fire-and-forget: failures are logged but never bubble up,
  // since classification is the primary contract. The Blob from formData() is
  // re-streamable, so re-using `file` here doesn't replay the S3 upload above.
  let emailDispatch: "ok" | "skipped" | "failed" = "skipped";
  if (
    EMAIL_EXTRACTION_URL !== "" &&
    category === "email"
  ) {
    const messageId = randomUUID();
    const url =
      `${EMAIL_EXTRACTION_URL.replace(/\/+$/, "")}/upload` +
      `?tenant=${encodeURIComponent(workspaceId)}` +
      `&document=${encodeURIComponent(documentId)}` +
      `&message=${encodeURIComponent(messageId)}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        body: file,
        headers: { "content-type": "application/octet-stream" },
      });
      if (resp.ok) {
        emailDispatch = "ok";
        // Cache the parsed extraction payload so the ResultPanel popup can
        // surface it later. JSON parse failures are non-fatal — dispatch
        // stays "ok" because the App Runner side did accept the upload.
        try {
          const ext = (await resp.json()) as EmailExtractionResponse;
          recordEmailExtraction(documentId, ext);
        } catch {
          // body wasn't JSON; skip caching but keep dispatch=ok
        }
      } else {
        emailDispatch = "failed";
        // eslint-disable-next-line no-console
        console.error("[classify] email dispatch non-2xx", {
          documentId,
          status: resp.status,
          body: (await resp.text()).slice(0, 500),
        });
      }
    } catch (e: unknown) {
      emailDispatch = "failed";
      // eslint-disable-next-line no-console
      console.error("[classify] email dispatch failed", {
        documentId,
        error: (e as Error)?.message,
      });
    }
  }

  const rec = recordSuccess({
    id: documentId,
    ts: runTs,
    inputName,
    workspaceId,
    result: result.value,
    elapsedMs,
    objectKey,
    archiveDispatch,
    convertDispatch,
  });
  await recordRun(rec);

  return NextResponse.json({
    ok: true,
    result: result.value,
    elapsedMs,
    documentId,
    objectKey,
    inputName,
    archiveDispatch,
    convertDispatch,
    emailDispatch,
  });
}
