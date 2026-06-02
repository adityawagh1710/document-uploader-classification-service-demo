import { describe, it, expect } from "vitest";
import { loadEnvConfig } from "./load.js";

describe("loadEnvConfig", () => {
  it("loads dev config", () => {
    const config = loadEnvConfig("dev");
    expect(config.envName).toBe("dev");
  });

  it("loads staging config", () => {
    const config = loadEnvConfig("staging");
    expect(config.envName).toBe("staging");
  });

  it("loads prod config", () => {
    const config = loadEnvConfig("prod");
    expect(config.envName).toBe("prod");
  });

  it("throws on unknown env (Pattern P-4-3 — fail-closed)", () => {
    expect(() => loadEnvConfig("invalid")).toThrow(/Unknown environment "invalid"/);
    expect(() => loadEnvConfig("")).toThrow(/Unknown environment ""/);
    expect(() => loadEnvConfig("PROD")).toThrow();   // case-sensitive
  });

  it("prod has reservedConcurrentExecutions set", () => {
    expect(loadEnvConfig("prod").reservedConcurrentExecutions).toBe(100);
  });

  it("dev has reservedConcurrentExecutions undefined", () => {
    expect(loadEnvConfig("dev").reservedConcurrentExecutions).toBeUndefined();
  });

  it("prod has PITR + deletion protection enabled", () => {
    const config = loadEnvConfig("prod");
    expect(config.pitrEnabledContentHashes).toBe(true);
    expect(config.deletionProtectionEnabled).toBe(true);
  });

  it("dev has PITR + deletion protection disabled", () => {
    const config = loadEnvConfig("dev");
    expect(config.pitrEnabledContentHashes).toBe(false);
    expect(config.deletionProtectionEnabled).toBe(false);
  });
});
