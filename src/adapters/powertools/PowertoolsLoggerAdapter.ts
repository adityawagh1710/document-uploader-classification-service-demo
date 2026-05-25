import { Logger as PTLogger } from "@aws-lambda-powertools/logger";
import type { Logger, LogContext } from "../../ports/Logger.js";

export function createPowertoolsLogger(serviceName: string, _correlationKey: string): Logger {
  // Powertools v2 dropped `correlationIdPath` from the constructor. Correlation
  // IDs are now set per-invocation via `setCorrelationIdFromPayload` or
  // `appendKeys` — the Lambda handler is responsible for that. `correlationKey`
  // is retained in the factory signature for API stability but unused here.
  const ptLogger = new PTLogger({ serviceName });

  return Object.freeze({
    info(message: string, context?: LogContext): void {
      if (context !== undefined) ptLogger.info(message, context);
      else ptLogger.info(message);
    },
    warn(message: string, context?: LogContext): void {
      if (context !== undefined) ptLogger.warn(message, context);
      else ptLogger.warn(message);
    },
    error(message: string, context?: LogContext & { errorCode?: string }): void {
      if (context !== undefined) ptLogger.error(message, context);
      else ptLogger.error(message);
    },
    debug(message: string, context?: LogContext): void {
      if (context !== undefined) ptLogger.debug(message, context);
      else ptLogger.debug(message);
    },
  });
}

// Helper to append keys (e.g., correlation IDs) to all subsequent log entries.
// Mutates the underlying Powertools logger; the port itself is unaware.
export function appendLoggerKeys(_logger: Logger, _keys: LogContext): void {
  // The Powertools logger appendKeys method is on the concrete class.
  // Tests inject silentLogger and don't need this; production uses the concrete impl.
  // This helper is a placeholder for cases where we need to thread correlation IDs.
}
