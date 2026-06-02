import { describe, it, expect } from "vitest";
import { buildContentHashRecord } from "../../../src/adapters/dynamo-content-hashes/index.js";

const baseInit = {
  workspaceId: "ws-1",
  contentHash: "abc123",
  format: "docx",
  policyVersion: "v1",
  firstDocumentId: "doc-1",
  now: "2026-05-22T10:00:00.000Z",
};

describe("buildContentHashRecord", () => {
  it("produces a fresh record with firstSeenAt === lastSeenAt === now and hitCount === 0", () => {
    const r = buildContentHashRecord({ ...baseInit, hashTtlDays: null });
    expect(r.firstSeenAt).toBe(baseInit.now);
    expect(r.lastSeenAt).toBe(baseInit.now);
    expect(r.hitCount).toBe(0);
    expect(r.workspaceId).toBe(baseInit.workspaceId);
    expect(r.contentHash).toBe(baseInit.contentHash);
    expect(r.format).toBe(baseInit.format);
    expect(r.policyVersion).toBe(baseInit.policyVersion);
    expect(r.firstDocumentId).toBe(baseInit.firstDocumentId);
  });

  it("does not include expiresAt when hashTtlDays is null", () => {
    const r = buildContentHashRecord({ ...baseInit, hashTtlDays: null });
    expect(r.expiresAt).toBeUndefined();
  });

  it("includes expiresAt when hashTtlDays is a positive integer", () => {
    const r = buildContentHashRecord({ ...baseInit, hashTtlDays: 30 });
    expect(r.expiresAt).toBeDefined();
    expect(typeof r.expiresAt).toBe("number");
  });

  it("computes expiresAt as firstSeenAt + 30 days for hashTtlDays=30", () => {
    const r = buildContentHashRecord({ ...baseInit, hashTtlDays: 30 });
    const expected = Math.floor(Date.parse(baseInit.now) / 1000) + 30 * 86_400;
    expect(r.expiresAt).toBe(expected);
  });
});
