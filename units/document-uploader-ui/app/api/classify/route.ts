import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";
import type { ClassificationOutput, ClassificationFailure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upload size guard — defensive cap for the test harness. The streaming PUT
// below never buffers the full body, so large files don't OOM the container.
const MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

interface PresignUploadResult {
  documentId: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
}

interface ClassifyOutcome {
  ok: boolean;
  result: ClassificationOutput | null;
  error: ClassificationFailure | null;
  elapsedMs: number;
  documentId: string;
  objectKey: string;
  inputName: string;
  archiveDispatch: string | null;
  convertDispatch: string | null;
  emailDispatch: string | null;
}

// The UI no longer touches S3/SQS/the engine directly. The flow is now entirely
// router-fronted:
//   1. presignUpload  → { documentId, bucket, objectKey, uploadUrl }
//   2. PUT the bytes straight to S3 via the presigned URL (plain fetch, no SDK —
//      sidesteps the LocalStack CRC32 quirk that bit lib-storage multipart).
//   3. classifyUploaded → classifies + fans out archive/convert/email + records
//      the run, returning the full outcome.
export async function POST(req: Request) {
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

  // 1. Mint the presigned PUT + document id.
  let presign: PresignUploadResult;
  try {
    const data = await routerGraphQL<{ presignUpload: PresignUploadResult }>(
      `mutation($i: PresignUploadInput!){ presignUpload(input: $i){ documentId bucket objectKey uploadUrl } }`,
      { i: { workspaceId, inputName, contentType: contentTypeHint } },
    );
    presign = data.presignUpload;
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "presign failed", detail: (e as Error)?.message },
      { status: 502 },
    );
  }

  // 2. Stream the bytes straight to S3. The presigned PUT doesn't sign the
  // content-type, so sending one is harmless. A Blob body is streamed by undici
  // — no full-body buffering.
  try {
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": contentTypeHint ?? "application/octet-stream" },
    });
    if (!put.ok) {
      return NextResponse.json(
        { error: "s3 upload failed", detail: `PUT ${put.status}` },
        { status: 502 },
      );
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "s3 upload failed", detail: (e as Error)?.message },
      { status: 502 },
    );
  }

  // 3. Classify + fan out + record the run, all in the router.
  let outcome: ClassifyOutcome;
  try {
    const data = await routerGraphQL<{ classifyUploaded: ClassifyOutcome }>(
      `mutation($i: ClassifyUploadedInput!){ classifyUploaded(input: $i){
        ok result error elapsedMs documentId objectKey inputName
        archiveDispatch convertDispatch emailDispatch
      } }`,
      {
        i: {
          workspaceId,
          documentId: presign.documentId,
          bucket: presign.bucket,
          objectKey: presign.objectKey,
          inputName,
          extension: extensionHint,
          contentType: contentTypeHint,
          overrideDuplicateCheck,
          parentArchiveDepth: Number.isFinite(parentArchiveDepth) ? parentArchiveDepth : 0,
        },
      },
    );
    outcome = data.classifyUploaded;
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "classify failed", detail: (e as Error)?.message },
      { status: 502 },
    );
  }

  if (!outcome.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: outcome.error,
        elapsedMs: outcome.elapsedMs,
        documentId: outcome.documentId,
        objectKey: outcome.objectKey,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    result: outcome.result,
    elapsedMs: outcome.elapsedMs,
    documentId: outcome.documentId,
    objectKey: outcome.objectKey,
    inputName: outcome.inputName,
    archiveDispatch: outcome.archiveDispatch,
    convertDispatch: outcome.convertDispatch,
    emailDispatch: outcome.emailDispatch,
  });
}
