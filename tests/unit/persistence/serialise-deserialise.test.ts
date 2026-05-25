import { describe, it, expect } from "vitest";
import {
  serialiseRecord,
  deserialiseRecord,
  buildContentHashRecord,
} from "../../../src/adapters/dynamo-content-hashes/index.js";

const init = {
  workspaceId: "ws-1",
  contentHash: "abc",
  format: "docx",
  policyVersion: "v1",
  firstDocumentId: "doc-1",
  now: "2026-05-22T10:00:00.000Z",
};

describe("serialiseRecord / deserialiseRecord", () => {
  it("round-trips a record without TTL", () => {
    const original = buildContentHashRecord({ ...init, hashTtlDays: null });
    const restored = deserialiseRecord(serialiseRecord(original));
    expect(restored).toEqual(original);
  });

  it("round-trips a record with TTL (expiresAt present)", () => {
    const original = buildContentHashRecord({ ...init, hashTtlDays: 30 });
    const restored = deserialiseRecord(serialiseRecord(original));
    expect(restored).toEqual(original);
  });

  it("does not include expiresAt key when original lacks it", () => {
    const original = buildContentHashRecord({ ...init, hashTtlDays: null });
    const item = serialiseRecord(original);
    expect("expiresAt" in item).toBe(false);
  });

  it("returns null on malformed input (missing required field)", () => {
    expect(deserialiseRecord({ workspaceId: "ws-1" })).toBeNull();
  });

  it("returns null on wrong-typed field", () => {
    const original = buildContentHashRecord({ ...init, hashTtlDays: null });
    const malformed = { ...serialiseRecord(original), hitCount: "not-a-number" };
    expect(deserialiseRecord(malformed)).toBeNull();
  });
});
