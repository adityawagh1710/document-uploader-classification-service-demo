/// <reference types="cypress" />

describe("Smoke", () => {
  it("dashboard renders + LocalStack is reachable + default workspace auto-seeded", () => {
    cy.visit("/");
    cy.contains("Classification Service · Test UI");

    // Health KPI should flip to OK within the 4s poll cadence.
    cy.contains(".kpi-tile .label", /service/i)
      .parent()
      .find(".value")
      .should("contain", "OK");

    // LocalStack tile shows ms latency. .should("match", regex) operates on
    // the element selector, not its text — use invoke("text") instead.
    cy.contains(".kpi-tile .label", /localstack/i)
      .parent()
      .find(".value")
      .invoke("text")
      .should("match", /\d+ ms/);

    // Auto-seed should have created wks-ui-001.
    cy.request("GET", "/api/workspaces").then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.workspaces).to.have.length.at.least(1);
      const ids = res.body.workspaces.map((w: { workspaceId: string }) => w.workspaceId);
      expect(ids).to.include("wks-ui-001");
    });

    // Classify form is mounted.
    cy.contains("button", /classify/i).should("be.disabled"); // disabled until file picked
    cy.contains("button", /seed workspace/i).should("be.enabled");
  });
});
