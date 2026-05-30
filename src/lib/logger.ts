/**
 * Minimal structured logger.
 *
 * Emits one JSON line per event, so logs are grep-able in local dev and ship
 * cleanly to a log drain (Vercel log drains, Logtail, Datadog) in production
 * without further parsing. To forward errors to Sentry (or any sink) in prod,
 * call `setLogSink(...)` once at app startup — call sites don't change.
 *
 * Logging must never throw or take down a request, so the sink is wrapped in
 * its own try/catch.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

type Sink = (level: LogLevel, payload: Record<string, unknown>) => void;

let sink: Sink | null = null;

/** Register an external sink (e.g. Sentry). Intended to be called once. */
export function setLogSink(fn: Sink | null): void {
  sink = fn;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const payload: Record<string, unknown> = { level, message, time: new Date().toISOString(), ...context };

  if (sink) {
    try {
      sink(level, payload);
    } catch {
      // Never let a logging sink break the caller.
    }
  }

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
