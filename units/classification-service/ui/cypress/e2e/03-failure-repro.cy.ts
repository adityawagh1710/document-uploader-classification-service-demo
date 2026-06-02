/// <reference types="cypress" />

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

// Reproducer for the {"kind":"s3","reason":"unknown"} failure the user saw
// on a real PPTX upload. Tries multiple PPTX-shaped fixtures of varying
// sizes to narrow down whether the bug is bound to (a) PPTX content, (b)
// file size, or (c) something else entirely.
//
// Drop a real reproducer file into ui/cypress/fixtures/repro.pptx and the
// last test in this spec will exercise it directly.

interface ApiResult {
  ok: boolean;
  result?: {
    classification: { format: string; detectionTier: string; category: string };
    dedup: { isDuplicate: boolean };
  };
  error?: unknown;
}

function postFile(opts: {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  extension?: string;
}): Cypress.Chainable<ApiResult> {
  const bytesBase64 = bytesToBase64(opts.bytes);
  return cy
    .task<{ status: number; body: ApiResult }>("classifyMultipart", {
      baseUrl: Cypress.config("baseUrl"),
      bytesBase64,
      fileName: opts.fileName,
      contentType: opts.contentType,
      workspaceId: "wks-ui-001",
      extension: opts.extension ?? null,
    })
    .then((res) => res.body);
}

// Synthesize a minimal valid OOXML PPTX shell. We won't get a real
// detection (the inner [Content_Types].xml etc. aren't valid), but the
// outer ZIP signature is correct so the upload path is exercised end-to-end.
function minimalOoxmlPptx(): Uint8Array {
  // Local file header for "[Content_Types].xml"
  const sig = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
  const padding = new Array(2048 - sig.length).fill(0x00);
  return new Uint8Array([...sig, ...padding]);
}

function randomBlob(sizeBytes: number, prefixBytes: number[] = []): Uint8Array {
  const buf = new Uint8Array(sizeBytes);
  buf.set(prefixBytes, 0);
  // Fill with deterministic pseudo-random data to avoid Math.random churn.
  for (let i = prefixBytes.length; i < sizeBytes; i++) {
    buf[i] = (i * 2654435761) & 0xff;
  }
  return buf;
}

describe("Failure reproducer — s3:unknown on uploads", () => {
  it("Synthetic minimal PPTX shell (2 KB) classifies without s3:unknown", () => {
    postFile({
      bytes: minimalOoxmlPptx(),
      fileName: "minimal.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extension: "pptx",
    }).then((r) => {
      expect(r.ok, JSON.stringify(r)).to.be.true;
    });
  });

  it("ZIP-signature + 500 KB body classifies without s3:unknown", () => {
    const sig = [0x50, 0x4b, 0x03, 0x04];
    postFile({
      bytes: randomBlob(500 * 1024, sig),
      fileName: "midsize.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extension: "pptx",
    }).then((r) => {
      // The synthetic content won't classify as a real PPTX (it has the ZIP
      // signature but no valid OOXML inner structure). The point is the
      // S3 read must not fail — assert we got a 422 from classification
      // logic, NOT an s3:unknown.
      if (!r.ok) {
        const err = r.error as { kind?: string; reason?: string };
        expect(err.kind, JSON.stringify(r)).not.to.eq("s3");
      }
    });
  });

  it("Same shape at 5 MB classifies without s3:unknown", () => {
    const sig = [0x50, 0x4b, 0x03, 0x04];
    postFile({
      bytes: randomBlob(5 * 1024 * 1024, sig),
      fileName: "large.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extension: "pptx",
    }).then((r) => {
      if (!r.ok) {
        const err = r.error as { kind?: string; reason?: string };
        expect(err.kind, JSON.stringify(r)).not.to.eq("s3");
      }
    });
  });

  it("Real reproducer file at ui/cypress/fixtures/repro.pptx (if present)", () => {
    // Skip if the fixture file isn't there yet.
    cy.task("readFileIfExists", "repro.pptx", { failOnStatusCode: false }).then((result) => {
      const contents = result as string | null;
      if (!contents) {
        cy.log("ui/cypress/fixtures/repro.pptx not present — skipping reproducer step.");
        return;
      }
      cy.fixture("repro.pptx", "base64").then((b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        postFile({
          bytes,
          fileName: "repro.pptx",
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          extension: "pptx",
        }).then((r) => {
          // Print the response so we can see what came back even on success.
          cy.log(JSON.stringify(r));
          if (!r.ok) {
            const err = r.error as { kind?: string; reason?: string };
            expect(err.kind, JSON.stringify(r)).not.to.eq("s3");
          }
        });
      });
    });
  });
});
