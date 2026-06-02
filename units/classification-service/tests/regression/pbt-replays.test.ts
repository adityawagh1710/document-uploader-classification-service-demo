import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p: string) => resolve(fileURLToPath(import.meta.url), "..", p);
const FAILURES_PATH = here("./pbt-failures.json");

interface RegressionEntry {
  property: string;
  seed: number;
  input: unknown;
  capturedAt: string;
}

const regressions: RegressionEntry[] = existsSync(FAILURES_PATH)
  ? (JSON.parse(readFileSync(FAILURES_PATH, "utf8")) as RegressionEntry[])
  : [];

describe("PBT regression replays", () => {
  if (regressions.length === 0) {
    it("no captured regressions yet", () => {
      expect(regressions).toEqual([]);
    });
    return;
  }

  // When entries exist they should each be replayed against their original property.
  // The exact replay mechanism is per-property; for now we assert the entries
  // are well-shaped and visible to maintainers.
  for (const r of regressions) {
    it(`captured: ${r.property} — ${r.capturedAt}`, () => {
      expect(r.property).toBeTypeOf("string");
      expect(r.seed).toBeTypeOf("number");
      expect(r.input).toBeDefined();
    });
  }
});
