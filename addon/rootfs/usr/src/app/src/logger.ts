import pino from "pino";
import type { Logger } from "pino";

export function createLogger(level: string): Logger {
  const isDebug = level === "debug" || level === "trace";

  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
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
