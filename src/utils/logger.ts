// ---------------------------------------------------------------------------
// Unified frontend logger — mirrors the backend Pino logger conventions.
//
// Usage:
//   import { createLogger } from "../utils/logger";
//   const log = createLogger("ValvesPage");
//   log.info("Snapshot loaded", { count: 5 });
//
// A pre-made singleton is available for quick/shared use:
//   import { logger } from "../utils/logger";
//   logger.warn("Something happened");
// ---------------------------------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogMeta = Record<string, unknown> | undefined;

// ---------------------------------------------------------------------------
// Level priority & resolution (matches backend's pino level semantics)
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LEVEL_CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
};

const LEVEL_BADGE_STYLE: Record<LogLevel, { bg: string; fg: string }> = {
  trace: { bg: "#6c757d", fg: "#fff" },
  debug: { bg: "#0dcaf0", fg: "#000" },
  info: { bg: "#0d6efd", fg: "#fff" },
  warn: { bg: "#ffc107", fg: "#000" },
  error: { bg: "#dc3545", fg: "#fff" },
  fatal: { bg: "#7b2d8e", fg: "#fff" },
};

const envLevel = (import.meta.env.VITE_LOG_LEVEL as string | undefined)
  ?.trim()
  .toLowerCase() as LogLevel | undefined;
const defaultLevel: LogLevel = import.meta.env.DEV ? "debug" : "info";
let activeLevel: LogLevel =
  envLevel && envLevel in LEVEL_PRIORITY ? envLevel : defaultLevel;

export function getLogLevel(): LogLevel {
  return activeLevel;
}

export function setLogLevel(level: LogLevel): void {
  if (!(level in LEVEL_PRIORITY)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LEVEL_PRIORITY).join(", ")}`);
  }
  const previous = activeLevel;
  activeLevel = level;
  // Log the change using the new level - this will only show if the new level permits it
  emit("info", "Logger", `Log level changed from "${previous}" to "${level}"`);
}

export const VALID_LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[activeLevel];
}

// ---------------------------------------------------------------------------
// Error serialisation — extracts useful fields from Error instances in meta
// ---------------------------------------------------------------------------

function serialiseMeta(meta: LogMeta): LogMeta {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      out[key] = { message: value.message, name: value.name, stack: value.stack };
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core emit — styled console output with timestamp + module badge
// ---------------------------------------------------------------------------

function emit(
  level: LogLevel,
  module: string,
  message: string,
  meta?: LogMeta,
): void {
  if (!shouldLog(level)) return;

  const methodName = LEVEL_CONSOLE_METHOD[level];
  const method = (console[methodName] as (...args: unknown[]) => void).bind(console);

  const ts = new Date().toISOString();
  const badge = LEVEL_BADGE_STYLE[level];
  const tag = level.toUpperCase().padEnd(5);

  const prefix =
    `%c ${tag} %c ${module} %c`;
  const styles = [
    `background:${badge.bg};color:${badge.fg};font-weight:bold;border-radius:3px;padding:1px 4px`,
    "background:#343a40;color:#f8f9fa;font-weight:bold;border-radius:3px;padding:1px 4px",
    "color:inherit;font-weight:normal",
  ];

  const serialised = serialiseMeta(meta);
  const hasPayload = serialised && Object.keys(serialised).length > 0;

  try {
    if (hasPayload) {
      method(`${prefix} ${ts}  ${message}`, ...styles, serialised);
    } else {
      method(`${prefix} ${ts}  ${message}`, ...styles);
    }
  } catch {
    // Last-resort fallback — plain text, no styles
    console.error(`[Luftator] [${tag}] [${module}] ${ts}  ${message}`, meta);
  }
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

function now(): number {
  return performance.now();
}

function fmtMs(start: number): number {
  return Math.round((now() - start) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Logger interface returned by createLogger
// ---------------------------------------------------------------------------

export interface Logger {
  readonly module: string;
  readonly level: LogLevel;
  trace(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  fatal(message: string, meta?: LogMeta): void;
  time<T>(label: string, fn: () => T, meta?: LogMeta): T;
  timeAsync<T>(label: string, fn: () => Promise<T>, meta?: LogMeta): Promise<T>;
  child(subModule: string): Logger;
}

// ---------------------------------------------------------------------------
// Factory — the main public API
// ---------------------------------------------------------------------------

export function createLogger(module: string): Logger {
  function log(level: LogLevel, message: string, meta?: LogMeta): void {
    emit(level, module, message, meta);
  }

  return {
    module,
    level: activeLevel,

    trace: (msg, meta?) => log("trace", msg, meta),
    debug: (msg, meta?) => log("debug", msg, meta),
    info:  (msg, meta?) => log("info", msg, meta),
    warn:  (msg, meta?) => log("warn", msg, meta),
    error: (msg, meta?) => log("error", msg, meta),
    fatal: (msg, meta?) => log("fatal", msg, meta),

    time<T>(label: string, fn: () => T, meta?: LogMeta): T {
      const start = now();
      try {
        const result = fn();
        log("debug", `${label} completed`, { ...meta, durationMs: fmtMs(start) });
        return result;
      } catch (error) {
        log("error", `${label} failed`, { ...meta, durationMs: fmtMs(start), error });
        throw error;
      }
    },

    async timeAsync<T>(label: string, fn: () => Promise<T>, meta?: LogMeta): Promise<T> {
      const start = now();
      try {
        const result = await fn();
        log("debug", `${label} completed`, { ...meta, durationMs: fmtMs(start) });
        return result;
      } catch (error) {
        log("error", `${label} failed`, { ...meta, durationMs: fmtMs(start), error });
        throw error;
      }
    },

    child(subModule: string): Logger {
      return createLogger(`${module}:${subModule}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Default singleton — backward compatible, use for shared / one-off logging
// ---------------------------------------------------------------------------

export const logger: Logger = createLogger("App");
