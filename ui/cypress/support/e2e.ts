/// <reference types="cypress" />

// Shared fixture-byte generators. The integration tests synthesize bytes
// directly rather than checking binary files into the repo; we mirror that.

export const fixtures = {
  // Tier 1: PDF magic bytes — `file-type` matches as 'pdf'.
  pdf(): Uint8Array {
    const head = new TextEncoder().encode("%PDF-1.7\n%hello cypress\n");
    return head;
  },
  // Tier 1: PNG magic bytes + a minimal IHDR chunk (file-type wants more
  // than just the 8-byte signature to confirm a PNG).
  png(): Uint8Array {
    return new Uint8Array([
      // PNG signature
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      // IHDR chunk: length=13, type="IHDR"
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      // 1x1, 8-bit RGBA, no interlace
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00,
      // CRC placeholder
      0x1f, 0x15, 0xc4, 0x89,
    ]);
  },
  // Tier 2 ZIP: minimal ZIP local file header so the ZIP signature triggers
  // tier 2; ZIP marker detection will look for OOXML/ODF content.
  zipShaped(): Uint8Array {
    // 50 4B 03 04 = local file header signature
    return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, ...new Array(120).fill(0x00)]);
  },
  // Tier 2 OLE2: Compound File Binary signature (D0 CF 11 E0 …).
  ole2Shaped(): Uint8Array {
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return new Uint8Array([...sig, ...new Array(120).fill(0x00)]);
  },
  // Tier 3 text: valid XML triggers the xml branch.
  xml(): Uint8Array {
    return new TextEncoder().encode(`<?xml version="1.0"?><root><a/></root>`);
  },
  // Tier 3 text: HTML.
  html(): Uint8Array {
    return new TextEncoder().encode(`<!doctype html><html><head></head><body>hi</body></html>`);
  },
  // Tier 3 text: minimal EML with ≥2 RFC-5322 headers.
  eml(): Uint8Array {
    return new TextEncoder().encode(
      `From: a@example.com\r\nTo: b@example.com\r\nSubject: hi\r\n\r\nbody`,
    );
  },
  // Extension-fallback: bytes that defeat all 3 tiers — control-range bytes
  // trip `hasBinaryBytes` (BR-T-1) so tier 3 short-circuits; no Tier 1/2
  // signature; rely on the extension hint passed to the form.
  binary(): Uint8Array {
    return new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
  },
};

// Helper: drive the dashboard's classify form end-to-end.
Cypress.Commands.add(
  "classify",
  (opts: {
    bytes: Uint8Array;
    fileName: string;
    workspaceId?: string;
    extension?: string;
    contentType?: string;
  }) => {
    if (opts.workspaceId) {
      cy.get('input[type="text"]').first().clear().type(opts.workspaceId);
    }
    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from(opts.bytes),
        fileName: opts.fileName,
        mimeType: opts.contentType ?? "application/octet-stream",
      },
      { force: true },
    );
    if (opts.extension !== undefined) {
      cy.contains("Extension hint")
        .parent()
        .find("input")
        .clear()
        .then(($el) => {
          if (opts.extension) cy.wrap($el).type(opts.extension);
        });
    }
    cy.contains("button", /classify/i).click();
  },
);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      classify(opts: {
        bytes: Uint8Array;
        fileName: string;
        workspaceId?: string;
        extension?: string;
        contentType?: string;
      }): Chainable<void>;
    }
  }
}

export {};
