import { describe, it, expect } from "vitest";
import { parseConvertClaim } from "../src/message.js";

const VALID = {
  pipelineExecutionId: "doc-abc",
  tenantId: "wks-001",
  documentId: "doc-abc",
  runId: "2026-05-28T12:00:00.000Z#doc-abc",
  sourceBucket: "classification-ui-dev05",
  sourceKey: "ui/doc-abc/invoice.docx",
  filename: "invoice.docx",
  subCategory: "office",
  correlationId: "corr-xyz",
};

describe("parseConvertClaim", () => {
  it("accepts a complete valid body", () => {
    const r = parseConvertClaim(JSON.stringify(VALID));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claim.documentId).toBe("doc-abc");
  });

  it("accepts subCategory: null", () => {
    const r = parseConvertClaim(JSON.stringify({ ...VALID, subCategory: null }));
    expect(r.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const r = parseConvertClaim("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid_json/);
  });

  it("rejects missing required fields with a structured message", () => {
    const { documentId, ...rest } = VALID;
    void documentId;
    const r = parseConvertClaim(JSON.stringify(rest));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema_mismatch.*documentId/);
  });

  it("rejects empty-string runId (degenerate)", () => {
    const r = parseConvertClaim(JSON.stringify({ ...VALID, runId: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/runId/);
  });
});
