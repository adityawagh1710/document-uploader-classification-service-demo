/// <reference types="cypress" />

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

describe("Result panel + LocalStack target info", () => {
  it("LocalStack target info block renders with backend identity", () => {
    cy.visit("/");
    cy.get('[data-testid="target-info"]').should("exist");
    cy.get('[data-testid="target-info"]').should("contain.text", "endpoint");
    cy.get('[data-testid="target-info"]').should("contain.text", "source bucket");
    cy.get('[data-testid="target-info"]').should("contain.text", "content-hash table");
  });

  it("Clicking a row in the recent table opens the Result panel with DDB lookup", () => {
    // Seed a fresh classification so we know the row exists.
    const nonce = `${Date.now()}-${Math.random()}`;
    const bytes = new TextEncoder().encode(`%PDF-1.7\n${nonce}\n`);
    cy.task<{ status: number; body: { ok: boolean; documentId: string } }>("classifyMultipart", {
      baseUrl: Cypress.config("baseUrl"),
      bytesBase64: bytesToBase64(bytes),
      fileName: `result-panel-${nonce}.pdf`,
      contentType: "application/pdf",
      workspaceId: "wks-ui-001",
      extension: "pdf",
    }).then((res) => {
      expect(res.body.ok).to.be.true;
      const documentId = res.body.documentId;

      cy.visit("/");
      // Wait for the just-uploaded row to appear via the 4s poll.
      cy.contains("tr", `result-panel-${nonce}.pdf`, { timeout: 8_000 }).should("exist").click();

      cy.get('[data-testid="result-panel"]').should("exist");
      cy.get('[data-testid="result-panel"]').should("contain.text", documentId);
      cy.get('[data-testid="result-panel"]').should("contain.text", "content hash");
      cy.get('[data-testid="result-panel"]').should("contain.text", "is duplicate");

      // DDB lookup should populate within the panel's effect.
      cy.get('[data-testid="ddb-row"]', { timeout: 8_000 }).should("exist");
      cy.get('[data-testid="ddb-row"]').should("contain.text", "wks-ui-001");
    });
  });

  it("Recent table now has a Status + Failure reason column", () => {
    cy.visit("/");
    cy.get('[data-testid="recent-table"] thead').should("contain.text", "Status");
    cy.get('[data-testid="recent-table"] thead').should("contain.text", "Failure reason");
  });
});
