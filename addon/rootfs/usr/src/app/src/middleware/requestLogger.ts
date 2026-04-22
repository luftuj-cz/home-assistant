import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";

export function createRequestLogger(logger: Logger) {
  return function requestLogger(request: Request, response: Response, next: NextFunction) {
    const requestStart = Date.now();
    response.on("finish", () => {
      const durationMs = Date.now() - requestStart;
      logger.info(
        {
          method: request.method,
          url: request.originalUrl,
          status: response.statusCode,
          durationMs,
          contentLength: request.headers["content-length"],
        },
        "HTTP request completed",
      );
    });
    next();
  };
}
