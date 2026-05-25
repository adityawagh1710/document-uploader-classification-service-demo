import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import {
  getClassificationService,
  ensureResourcesProvisioned,
  s3Client,
  BUCKET,
} from "@/lib/classifier";
import { recordFailure, recordSuccess } from "@/lib/stats";
import type { TaskPayload } from "@svc/shared/types";

export const runtime = "nodejs";
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
    recordFailure({
      id: documentId,
      ts: new Date().toISOString(),
      inputName,
      workspaceId,
      elapsedMs: 0,
      failure: { kind: "s3", reason: "unknown" },
      objectKey,
    });
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

  const service = getClassificationService();
  const start = Date.now();
  const result = await service.classify(payload);
  const elapsedMs = Date.now() - start;

  if (!result.ok) {
    recordFailure({
      id: documentId,
      ts: new Date().toISOString(),
      inputName,
      workspaceId,
      elapsedMs,
      failure: result.error,
      objectKey,
    });
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

  recordSuccess({
    id: documentId,
    ts: new Date().toISOString(),
    inputName,
    workspaceId,
    result: result.value,
    elapsedMs,
    objectKey,
  });

  return NextResponse.json({
    ok: true,
    result: result.value,
    elapsedMs,
    documentId,
    objectKey,
    inputName,
  });
}
