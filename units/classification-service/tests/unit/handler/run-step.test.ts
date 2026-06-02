import { describe, it, expect, vi } from "vitest";
import { runStep } from "../../../src/application/index.js";
import { silentLogger } from "../../../src/ports/Logger.js";

describe("runStep", () => {
  it("returns the value on success", async () => {
    const result = await runStep(
      { logger: silentLogger, workspaceId: "ws-1" },
      "test.step",
      async () => 42,
    );
    expect(result).toBe(42);
  });

  it("emits debug.start and debug.ok on success", async () => {
    const debug = vi.fn();
    const logger = { ...silentLogger, debug };
    await runStep({ logger, workspaceId: "ws-1" }, "test.step", async () => "ok");

    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug.mock.calls[0]?.[0]).toBe("test.step.start");
    expect(debug.mock.calls[1]?.[0]).toBe("test.step.ok");
  });

  it("emits error log and rethrows on failure", async () => {
    const error = vi.fn();
    const logger = { ...silentLogger, error };
    await expect(
      runStep({ logger, workspaceId: "ws-1" }, "test.step", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toBe("test.step.error");
  });
});
