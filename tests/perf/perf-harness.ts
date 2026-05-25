import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p: string) => resolve(fileURLToPath(import.meta.url), "..", p);
const BASELINE_PATH = here("./perf-baselines.json");

export interface PerfRecord {
  readonly p50_ms: number;
  readonly p99_ms: number;
}

export type PerfBaseline = Readonly<Record<string, Readonly<Record<string, PerfRecord>>>>;

export function readBaseline(): PerfBaseline {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PerfBaseline;
  } catch {
    return {};
  }
}

export interface ToleranceArgs {
  readonly unit: string;
  readonly name: string;
  readonly p99Budget: number; // ms
  readonly observedP99Ms: number;
  readonly regressionTolerance: number; // e.g. 0.10
  readonly baseline: PerfBaseline;
}

export function isWithinTolerance(args: ToleranceArgs): { ok: boolean; reason?: string } {
  if (args.observedP99Ms > args.p99Budget) {
    return { ok: false, reason: `p99 ${args.observedP99Ms}ms > budget ${args.p99Budget}ms` };
  }
  const baselineP99 = args.baseline[args.unit]?.[args.name]?.p99_ms;
  if (baselineP99 !== undefined && args.observedP99Ms > baselineP99 * (1 + args.regressionTolerance)) {
    return { ok: false, reason: `p99 ${args.observedP99Ms}ms > baseline ${baselineP99}ms * (1 + ${args.regressionTolerance})` };
  }
  return { ok: true };
}
