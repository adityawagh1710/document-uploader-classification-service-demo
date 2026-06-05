import { describe, it, expect } from "vitest";
import { mapS3Error } from "../../../../src/adapters/s3/index.js";

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

describe("mapS3Error", () => {
  it.each([
    ["NoSuchKey", "object-not-found"],
    ["NotFound", "object-not-found"],
    ["AccessDenied", "access-denied"],
    ["Forbidden", "access-denied"],
    ["TimeoutError", "transient"],
    ["AbortError", "transient"],
    ["InternalError", "transient"],
    ["ServiceUnavailable", "transient"],
    ["SlowDown", "throttled"],
    ["ThrottlingException", "throttled"],
  ] as const)("maps %s -> %s", (sdkName, expected) => {
    expect(mapS3Error(namedError(sdkName))).toBe(expected);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH"] as const)(
    "maps network error %s -> 'transient'",
    (code) => expect(mapS3Error(networkError(code))).toBe("transient"),
  );

  it("maps unknown SDK error names -> 'unknown'", () => {
    expect(mapS3Error(namedError("SomeNewException"))).toBe("unknown");
  });

  it("maps non-Error values -> 'unknown'", () => {
    expect(mapS3Error("a string")).toBe("unknown");
    expect(mapS3Error(null)).toBe("unknown");
  });
});
