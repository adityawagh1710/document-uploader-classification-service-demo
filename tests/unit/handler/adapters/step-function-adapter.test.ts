import { describe, it, expect } from "vitest";
import { mapSignalError } from "../../../../src/adapters/step-functions/index.js";

function namedError(name: string): Error {
  const e = new Error(`${name}: mocked`);
  e.name = name;
  return e;
}

describe("mapSignalError", () => {
  it.each([
    ["TaskDoesNotExist", "task-not-found"],
    ["TaskTimedOut", "task-not-found"],
    ["TimeoutError", "transient"],
    ["AbortError", "transient"],
  ] as const)("maps %s -> %s", (sdkName, expected) => {
    expect(mapSignalError(namedError(sdkName))).toBe(expected);
  });

  it("maps unknown error -> 'unknown'", () => {
    expect(mapSignalError(namedError("SomeUnknownError"))).toBe("unknown");
  });

  it("maps non-Error -> 'unknown'", () => {
    expect(mapSignalError("a string")).toBe("unknown");
  });

  it("maps network error codes -> 'transient'", () => {
    const e = new Error("net");
    (e as Error & { code?: string }).code = "ECONNRESET";
    expect(mapSignalError(e)).toBe("transient");
  });
});
