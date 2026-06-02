import { describe, it, expect } from "vitest";
import { mapDispatchError } from "../../../../src/adapters/sqs-archive-dispatcher/index.js";

function namedError(name: string): Error {
  const e = new Error(`${name}: mocked`);
  e.name = name;
  return e;
}

describe("mapDispatchError", () => {
  it.each([
    ["QueueDoesNotExist", "queue-not-found"],
    ["AWS.SimpleQueueService.NonExistentQueue", "queue-not-found"],
    ["TimeoutError", "transient"],
    ["AbortError", "transient"],
  ] as const)("maps %s -> %s", (sdkName, expected) => {
    expect(mapDispatchError(namedError(sdkName))).toBe(expected);
  });

  it("maps unknown error -> 'unknown'", () => {
    expect(mapDispatchError(namedError("SomeUnknownError"))).toBe("unknown");
  });

  it("maps non-Error -> 'unknown'", () => {
    expect(mapDispatchError("a string")).toBe("unknown");
  });

  it.each([
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
  ] as const)("maps network error code %s -> 'transient'", (code) => {
    const e = new Error("net");
    (e as Error & { code?: string }).code = code;
    expect(mapDispatchError(e)).toBe("transient");
  });
});
