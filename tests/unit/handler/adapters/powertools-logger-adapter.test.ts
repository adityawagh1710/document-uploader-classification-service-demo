import { describe, it, expect } from "vitest";
import { createPowertoolsLogger } from "../../../../src/adapters/powertools/index.js";

describe("PowertoolsLoggerAdapter", () => {
  it("exposes the Logger port methods", () => {
    const logger = createPowertoolsLogger("test-service", "documentId");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("does not throw on basic log calls — exercises both context-present and context-absent branches across all 4 levels", () => {
    const logger = createPowertoolsLogger("test-service", "documentId");
    // info — both branches
    expect(() => logger.info("hello")).not.toThrow();
    expect(() => logger.info("hello", { workspaceId: "ws-1" })).not.toThrow();
    // warn — both branches
    expect(() => logger.warn("warn-no-ctx")).not.toThrow();
    expect(() => logger.warn("warn-with-ctx", { workspaceId: "ws-2" })).not.toThrow();
    // error — both branches (with + without errorCode)
    expect(() => logger.error("err-no-ctx")).not.toThrow();
    expect(() => logger.error("oops", { errorCode: "X" })).not.toThrow();
    // debug — both branches
    expect(() => logger.debug("debug-no-ctx")).not.toThrow();
    expect(() => logger.debug("debug-with-ctx", { workspaceId: "ws-3" })).not.toThrow();
  });

  it("returns a frozen object", () => {
    const logger = createPowertoolsLogger("test-service", "documentId");
    expect(Object.isFrozen(logger)).toBe(true);
  });
});
