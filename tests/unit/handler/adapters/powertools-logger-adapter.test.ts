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

  it("does not throw on basic log calls", () => {
    const logger = createPowertoolsLogger("test-service", "documentId");
    expect(() => logger.info("hello")).not.toThrow();
    expect(() => logger.info("hello", { workspaceId: "ws-1" })).not.toThrow();
    expect(() => logger.error("oops", { errorCode: "X" })).not.toThrow();
  });

  it("returns a frozen object", () => {
    const logger = createPowertoolsLogger("test-service", "documentId");
    expect(Object.isFrozen(logger)).toBe(true);
  });
});
