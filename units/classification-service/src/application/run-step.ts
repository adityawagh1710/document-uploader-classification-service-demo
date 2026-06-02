// `performance.now()` is the elapsed-time instrumentation boundary by design
// in this module — the application-layer purity rules (NFR-5) deliberately
// allow it here because run-step *is* the timing helper. Disabling the rule
// at the file level keeps the rest of src/application/** clean.
/* eslint-disable no-restricted-globals */
import type { Logger } from "../ports/Logger.js";

export interface RunStepDeps {
  readonly logger: Logger;
  readonly workspaceId: string;
}

// Pattern P-3-4: single source of truth for per-step instrumentation.
// Note: integration with Powertools Tracer + Metrics is performed by the
// concrete logger/metric implementations at the handler-entry layer; this
// helper handles the structural log + timing emission that's stable across
// dev/test/prod.
export async function runStep<T>(
  deps: RunStepDeps,
  stepName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = performance.now();
  deps.logger.debug(`${stepName}.start`, { workspaceId: deps.workspaceId });

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startTime);
    deps.logger.debug(`${stepName}.ok`, {
      workspaceId: deps.workspaceId,
      durationMs,
    });
    return result;
  } catch (e) {
    const durationMs = Math.round(performance.now() - startTime);
    deps.logger.error(`${stepName}.error`, {
      workspaceId: deps.workspaceId,
      durationMs,
      errorMessage: (e as Error)?.message,
    });
    throw e;
  }
}
