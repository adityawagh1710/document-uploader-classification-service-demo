import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const OFFICE_CONVERT_API_URL =
  process.env.OFFICE_CONVERT_API_URL ??
  "https://office-convert-api-dev-sandbox-v1.dev05.k8s.opus2dev.com";

export async function POST(req: Request) {
  const target = `${OFFICE_CONVERT_API_URL}/v1/convert`;
  console.log(`[convert] POST received; upstream=${target}`);

  let file: FormDataEntryValue | null;
  try {
    const form = await req.formData();
    file = form.get("file");
  } catch (e) {
    console.error("[convert] failed to parse form:", e);
    return NextResponse.json(
      { error: "failed to parse multipart form", detail: (e as Error)?.message },
      { status: 400 },
    );
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const fileName = (file as File).name || "upload.bin";
  console.log(`[convert] file="${fileName}" size=${file.size}`);

  const outboundForm = new FormData();
  outboundForm.append("file", file, fileName);

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: "POST", body: outboundForm });
  } catch (e) {
    console.error("[convert] upstream fetch threw:", e);
    return NextResponse.json(
      {
        error: "upstream fetch failed",
        target,
        detail: (e as Error)?.message ?? String(e),
        cause: (e as { cause?: unknown })?.cause
          ? String((e as { cause?: unknown }).cause)
          : undefined,
      },
      { status: 502 },
    );
  }

  console.log(`[convert] upstream status=${upstream.status} ok=${upstream.ok}`);

  if (!upstream.ok || upstream.body === null) {
    const errBody = await upstream.text().catch(() => "");
    console.error(`[convert] upstream non-OK body: ${errBody.slice(0, 1000)}`);
    return NextResponse.json(
      {
        error: "office-convert call failed",
        status: upstream.status,
        upstream: errBody.slice(0, 4000),
      },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
    );
  }

  const downloadName = fileName.replace(/\.[^./\\]+$/, "") + ".pdf";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "X-Request-ID": upstream.headers.get("X-Request-ID") ?? "",
    },
  });
}
