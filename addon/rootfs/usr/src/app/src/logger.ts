import pino from "pino";
import type { Logger } from "pino";

export type ServerLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  line: string;
};

const MAX_BUFFERED_SERVER_LOGS = 1_000;
const bufferedServerLogs: ServerLogEntry[] = [];

function resolveLevelLabel(level: number | string): string {
  if (typeof level === "string") {
    return level;
  }

  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function bufferServerLog(level: number | string, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const levelLabel = resolveLevelLabel(level);

  let message = "";
  const contextParts: string[] = [];

  for (const arg of args) {
    if (typeof arg === "string") {
      if (!message) {
        message = arg;
      } else {
        contextParts.push(arg);
      }
      continue;
    }

    contextParts.push(stringifyLogValue(arg));
  }

  if (!message) {
    message = "(no message)";
  }

  const context = contextParts.join(" ");
  const line = `[${timestamp}] ${levelLabel.toUpperCase()} ${message}${context ? ` ${context}` : ""}`;
  bufferedServerLogs.push({
    timestamp,
    level: levelLabel,
    message,
    context: context || undefined,
    line,
  });

  if (bufferedServerLogs.length > MAX_BUFFERED_SERVER_LOGS) {
    bufferedServerLogs.splice(0, bufferedServerLogs.length - MAX_BUFFERED_SERVER_LOGS);
  }
}

export function getRecentServerLogs(limit = 300): ServerLogEntry[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), MAX_BUFFERED_SERVER_LOGS))
    : 300;
  return bufferedServerLogs.slice(-safeLimit);
}

export function getServerLogBufferSize(): number {
  return bufferedServerLogs.length;
}

export function createLogger(level: string): Logger {
  const isDebug = level === "debug" || level === "trace";

  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    hooks: {
      logMethod(args, method, levelValue) {
        bufferServerLog(levelValue, args);
        method.apply(this, args);
      },
    },
    transport: isDebug
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  });
}
