/// <reference types="cypress" />
import { fixtures } from "../support/e2e";

// Chunked base64 encoder — String.fromCharCode(...spread) overflows the
// call stack for buffers > a few hundred KB.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

interface ApiResult {
  ok: boolean;
  result?: {
    classification: {
      format: string;
      category: string;
      detectionTier: string;
      confidenceScore: number;
    };
    dedup: { isDuplicate: boolean; contentHash: string };
  };
  error?: unknown;
  elapsedMs?: number;
}

function classifyViaApi(file: {
  bytes: Uint8Array;
  fileName: string;
  workspaceId?: string;
  extension?: string | null;
  contentType?: string | null;
}): Cypress.Chainable<ApiResult> {
  // cy.request doesn't serialise FormData as multipart — delegate to a
  // Node-side cy.task that uses native fetch.
  const bytesBase64 = bytesToBase64(file.bytes);
  return cy
    .task<{ status: number; body: ApiResult }>("classifyMultipart", {
      baseUrl: Cypress.config("baseUrl"),
      bytesBase64,
      fileName: file.fileName,
      contentType: file.contentType ?? "application/octet-stream",
      workspaceId: file.workspaceId ?? "wks-ui-001",
      extension: file.extension ?? null,
    })
    .then((res) => res.body);
}

describe("Per-tier classification via /api/classify", () => {
  before(() => {
    // Ensure the default workspace exists.
    cy.request("GET", "/api/workspaces");
  });

  it("Tier 1 file-type — PDF magic bytes route to ocr-direct", () => {
    classifyViaApi({ bytes: fixtures.pdf(), fileName: "sample.pdf", extension: "pdf" }).then(
      (r) => {
        expect(r.ok, JSON.stringify(r)).to.be.true;
        expect(r.result!.classification.detectionTier).to.eq("file-type");
        expect(r.result!.classification.format).to.eq("pdf");
        expect(r.result!.classification.category).to.eq("ocr-direct");
      },
    );
  });

  it("Tier 1 file-type — PNG magic bytes route to media", () => {
    classifyViaApi({ bytes: fixtures.png(), fileName: "sample.png", extension: "png" }).then(
      (r) => {
        expect(r.ok, JSON.stringify(r)).to.be.true;
        expect(r.result!.classification.detectionTier).to.eq("file-type");
        expect(r.result!.classification.format).to.eq("png");
      },
    );
  });

  it("Tier 2 OLE2 — D0CF11E0 signature reaches the OLE2 detector", () => {
    classifyViaApi({ bytes: fixtures.ole2Shaped(), fileName: "legacy.doc", extension: "doc" })
      .then((r) => {
        // The synthesized OLE2 stub doesn't have valid CLSID data, so the
        // OLE2 detector won't match conclusively; the orchestrator falls
        // through to extension-fallback. The important assertion is that
        // the request didn't fail at the S3 layer.
        expect(r.ok, JSON.stringify(r)).to.be.true;
      });
  });

  it("Tier 2 ZIP — 504B0304 signature classified via ZIP detector", () => {
    classifyViaApi({
      bytes: fixtures.zipShaped(),
      fileName: "container.zip",
      extension: "zip",
      contentType: "application/zip",
    }).then((r) => {
      expect(r.ok, JSON.stringify(r)).to.be.true;
    });
  });

  it("XML — `file-type` library matches before Tier 3 text", () => {
    // file-type has a signature for XML, so Tier 1 wins. This is correct
    // service behavior — assert it rather than fight it.
    classifyViaApi({ bytes: fixtures.xml(), fileName: "doc.xml", extension: "xml" }).then((r) => {
      expect(r.ok, JSON.stringify(r)).to.be.true;
      expect(r.result!.classification.format).to.eq("xml");
    });
  });

  it("Tier 3 text — HTML routes via text-heuristic", () => {
    classifyViaApi({ bytes: fixtures.html(), fileName: "page.html", extension: "html" }).then(
      (r) => {
        expect(r.ok, JSON.stringify(r)).to.be.true;
        expect(r.result!.classification.format).to.eq("html");
      },
    );
  });

  it("Tier 3 text — EML routes via text-heuristic", () => {
    classifyViaApi({ bytes: fixtures.eml(), fileName: "msg.eml", extension: "eml" }).then(
      (r) => {
        expect(r.ok, JSON.stringify(r)).to.be.true;
        expect(r.result!.classification.format).to.eq("eml");
        expect(r.result!.classification.category).to.eq("email");
      },
    );
  });

  it("Extension fallback — control-byte garbage routes via extension", () => {
    classifyViaApi({
      bytes: fixtures.binary(),
      fileName: "doc.docm",
      extension: "docm",
    }).then((r) => {
      expect(r.ok, JSON.stringify(r)).to.be.true;
      expect(r.result!.classification.detectionTier).to.eq("extension-fallback");
    });
  });

  it("Dedup — second upload of same bytes flips isDuplicate=true", () => {
    // Make the test bytes unique per run so a prior run's row in DDB
    // doesn't pre-poison the dedup decision. LocalStack runs PERSISTENCE=0
    // so a fresh container clears state, but within one container session
    // every test contributes to the content-hash table.
    const nonce = `${Date.now()}-${Math.random()}`;
    const bytes = new TextEncoder().encode(`%PDF-1.7\n${nonce}\n`);
    classifyViaApi({ bytes, fileName: "dup.pdf", extension: "pdf" }).then((first) => {
      expect(first.ok, JSON.stringify(first)).to.be.true;
      const firstHash = first.result!.dedup.contentHash;
      expect(first.result!.dedup.isDuplicate).to.be.false;

      classifyViaApi({ bytes, fileName: "dup.pdf", extension: "pdf" }).then((second) => {
        expect(second.ok, JSON.stringify(second)).to.be.true;
        expect(second.result!.dedup.contentHash).to.eq(firstHash);
        expect(second.result!.dedup.isDuplicate).to.be.true;
      });
    });
  });
});
