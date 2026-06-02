/// <reference types="cypress" />

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function classify(uniqueTag: string): Cypress.Chainable<unknown> {
  // Unique bytes per call so dedup never short-circuits — each upload becomes
  // a distinct row in the recent table.
  const bytes = new TextEncoder().encode(`%PDF-1.7\n${uniqueTag}\n`);
  return cy.task("classifyMultipart", {
    baseUrl: Cypress.config("baseUrl"),
    bytesBase64: bytesToBase64(bytes),
    fileName: `page-${uniqueTag}.pdf`,
    contentType: "application/pdf",
    workspaceId: "wks-ui-001",
    extension: "pdf",
  });
}

describe("Recent classifications — pagination", () => {
  it("hides controls when there are ≤ pageSize results, shows them above", () => {
    cy.visit("/");
    // Seed 11 fresh classifications so we cross the default 10-rows page.
    const nonce = Date.now();
    cy.wrap(Array.from({ length: 11 }, (_, i) => i)).each((i) => {
      classify(`pg-${nonce}-${i}`);
    });
    cy.reload();

    cy.get('[data-testid="pagination"]').should("exist");
    cy.get('[data-testid="page-indicator"]').should("contain.text", "Page 1 of");

    // Page 1 shows exactly 10 rows.
    cy.get('[data-testid="recent-table"] tbody tr').should("have.length", 10);

    // Advance to page 2 → at least one row, page indicator updates.
    cy.get('[data-testid="page-next"]').click();
    cy.get('[data-testid="page-indicator"]').should("contain.text", "Page 2 of");
    cy.get('[data-testid="recent-table"] tbody tr').should("have.length.at.least", 1);

    // Prev returns to page 1.
    cy.get('[data-testid="page-prev"]').click();
    cy.get('[data-testid="page-indicator"]').should("contain.text", "Page 1 of");

    // Changing page size to 25 collapses to a single page → controls hide.
    cy.get('[data-testid="page-size"]').select("25");
    cy.get('[data-testid="pagination"]').should("not.exist");
  });
});
