import { describe, it, expect } from "vitest";
import { isConditionalCheckFailed } from "../../../src/adapters/shared/is-conditional-check-failed.js";

function namedError(name: string): Error {
  const e = new Error(`${name}`);
  e.name = name;
  return e;
}

describe("isConditionalCheckFailed", () => {
  it("returns true for ConditionalCheckFailedException", () => {
    expect(isConditionalCheckFailed(namedError("ConditionalCheckFailedException"))).toBe(true);
  });

  it("returns false for other SDK errors", () => {
    expect(isConditionalCheckFailed(namedError("ThrottlingException"))).toBe(false);
    expect(isConditionalCheckFailed(namedError("ResourceNotFoundException"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isConditionalCheckFailed("string")).toBe(false);
    expect(isConditionalCheckFailed(null)).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
  });
});
