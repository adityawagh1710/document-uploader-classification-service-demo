import { describe, it, expect } from "vitest";
import { computeExpiresAt } from "../../../src/adapters/dynamo-content-hashes/index.js";

describe("computeExpiresAt", () => {
  it("returns firstSeenAt + ttlDays * 86400 (1 day)", () => {
    const now = "2026-05-22T10:00:00.000Z";
    const expected = Math.floor(Date.parse(now) / 1000) + 1 * 86_400;
    expect(computeExpiresAt(now, 1)).toBe(expected);
  });

  it("returns firstSeenAt + ttlDays * 86400 (365 days)", () => {
    const now = "2026-05-22T10:00:00.000Z";
    const expected = Math.floor(Date.parse(now) / 1000) + 365 * 86_400;
    expect(computeExpiresAt(now, 365)).toBe(expected);
  });

  it("handles fractional ISO milliseconds correctly via floor", () => {
    const now = "2026-05-22T10:00:00.999Z";
    const expected = Math.floor(Date.parse(now) / 1000) + 7 * 86_400;
    expect(computeExpiresAt(now, 7)).toBe(expected);
  });

  it("throws RangeError on invalid ISO timestamp", () => {
    expect(() => computeExpiresAt("not-a-date", 7)).toThrow(RangeError);
  });
});
