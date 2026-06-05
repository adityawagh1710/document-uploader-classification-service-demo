// Shrunk-failure capture per Pattern #8 of nfr-design-patterns.md
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p: string) => resolve(fileURLToPath(import.meta.url), "..", p);
const REGRESSION_PATH = here("../regression/pbt-failures.json");

interface RegressionEntry {
  property: string;
  seed: number;
  input: unknown;
  capturedAt: string;
}

export function captureShrunkFailure(propertyName: string, seed: number, shrunkInput: unknown): void {
  let existing: RegressionEntry[] = [];
  if (existsSync(REGRESSION_PATH)) {
    try {
      existing = JSON.parse(readFileSync(REGRESSION_PATH, "utf8"));
    } catch {
      existing = [];
    }
  }

  const duplicate = existing.some(
    (r) => r.property === propertyName && JSON.stringify(r.input) === JSON.stringify(shrunkInput),
  );
  if (duplicate) return;

  existing.push({
    property: propertyName,
    seed,
    input: shrunkInput,
    capturedAt: new Date().toISOString(),
  });

  writeFileSync(REGRESSION_PATH, JSON.stringify(existing, null, 2) + "\n");
}

// Ensure the regression file exists at startup so first-time runs don't ENOENT.
if (!existsSync(REGRESSION_PATH)) {
  appendFileSync(REGRESSION_PATH, "[]\n");
}
