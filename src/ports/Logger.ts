export type LogContext = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext & { errorCode?: string }): void;
  debug(message: string, context?: LogContext): void;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
