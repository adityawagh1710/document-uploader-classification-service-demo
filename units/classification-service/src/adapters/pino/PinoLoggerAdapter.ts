import pino from "pino";
import type { Logger, LogContext } from "../../ports/Logger.js";

// pino is the platform-mandated TS structured logger (tech-environment.md).
// This adapter implements the same `Logger` port the rest of the service depends
// on, so swapping logging backends is a one-file change. Tests still inject
// `silentLogger`, so they're unaffected.
export function createPinoLogger(serviceName: string, _correlationKey: string): Logger {
  const pinoLogger = pino({
    level: (process.env.LOG_LEVEL ?? "info").toLowerCase(),
    // Structured JSON with the spec's required fields. `service` is always
    // present; correlation fields (document_id, trace_id, span_id, …) ride in
    // the per-call context object. `correlationKey` is retained for API
    // stability (the Powertools adapter took it too) but is set per-call.
    base: { service: serviceName },
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // Emit level names ("info") rather than numbers (30).
      level: (label) => ({ level: label }),
    },
  });

  // pino takes the merge-object FIRST, then the message — the inverse of the
  // port's (message, context) order, so we flip the args here.
  return Object.freeze({
    info(message: string, context?: LogContext): void {
      if (context !== undefined) pinoLogger.info(context, message);
      else pinoLogger.info(message);
    },
    warn(message: string, context?: LogContext): void {
      if (context !== undefined) pinoLogger.warn(context, message);
      else pinoLogger.warn(message);
    },
    error(message: string, context?: LogContext & { errorCode?: string }): void {
      if (context !== undefined) pinoLogger.error(context, message);
      else pinoLogger.error(message);
    },
    debug(message: string, context?: LogContext): void {
      if (context !== undefined) pinoLogger.debug(context, message);
      else pinoLogger.debug(message);
    },
  });
}
