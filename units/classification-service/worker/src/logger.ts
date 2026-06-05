/**
 * Tiny structured JSON-lines logger. Keeps deps minimal — Powertools is
 * Lambda-specific and overkill for a long-lived worker process. The shape
 * matches the rest of the project's logging conventions (event + fields).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
  /** Returns a derived logger whose every line has these fields merged in. */
  with: (extra: Record<string, unknown>) => Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly base?: Record<string, unknown>;
  /** Sink override — defaults to stdout. Used in tests to capture output. */
  readonly sink?: (line: string) => void;
}

export function createLogger(opts: LoggerOptions): Logger {
  const threshold = LEVEL_RANK[opts.level];
  const base = opts.base ?? {};
  const sink =
    opts.sink ??
    ((line: string) => {
      // Single write call → atomic line on POSIX (size-bounded, well under
      // PIPE_BUF). Avoids the interleaved-output trap of console.log + bg work.
      process.stdout.write(`${line}\n`);
    });

  const emit = (level: LogLevel) =>
    (event: string, fields: Record<string, unknown> = {}): void => {
      if (LEVEL_RANK[level] < threshold) return;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        ...base,
        ...fields,
      });
      sink(line);
    };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    with(extra) {
      return createLogger({
        level: opts.level,
        base: { ...base, ...extra },
        ...(opts.sink ? { sink: opts.sink } : {}),
      });
    },
  };
}
