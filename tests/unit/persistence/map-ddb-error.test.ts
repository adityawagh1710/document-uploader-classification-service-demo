import { describe, it, expect } from "vitest";
import { mapDDBError } from "../../../src/adapters/shared/map-ddb-error.js";

function namedError(name: string): Error {
  const e = new Error(`${name}: mocked`);
  e.name = name;
  return e;
}

function networkError(code: string): Error {
  const e = new Error(`net: ${code}`);
  (e as Error & { code?: string }).code = code;
  return e;
}

describe("mapDDBError", () => {
  it.each([
    ["ConditionalCheckFailedException", "conditional-check-failed"],
    ["ProvisionedThroughputExceededException", "throttled"],
    ["ThrottlingException", "throttled"],
    ["RequestLimitExceeded", "throttled"],
    ["ResourceNotFoundException", "unknown"],
    ["InternalServerError", "transient"],
    ["ServiceUnavailable", "transient"],
    ["TimeoutError", "transient"],
    ["AbortError", "transient"],
  ] as const)("maps %s -> %s", (sdkName, expected) => {
    expect(mapDDBError(namedError(sdkName))).toBe(expected);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND"] as const)(
    "maps network error code %s -> 'transient'",
    (code) => {
      expect(mapDDBError(networkError(code))).toBe("transient");
    },
  );

  it("maps unknown SDK error names -> 'unknown'", () => {
    expect(mapDDBError(namedError("SomeNewException"))).toBe("unknown");
  });

  it("maps non-Error values -> 'unknown'", () => {
    expect(mapDDBError("a string")).toBe("unknown");
    expect(mapDDBError(null)).toBe("unknown");
    expect(mapDDBError(undefined)).toBe("unknown");
    expect(mapDDBError({ name: "Something" })).toBe("unknown");
  });
});
