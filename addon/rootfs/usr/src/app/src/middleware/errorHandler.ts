import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { ApiError } from "../shared/errors/apiErrors.js";

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    error: Error,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ): void {
    if (response.headersSent) {
      return _next(error);
    }

    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        logger.error({ error }, error.message);
      } else {
        logger.warn({ error }, error.message);
      }
      // `detail` is translated client-side off `code`, so the underlying cause
      // has to travel in its own field or it never reaches the user - e.g. the
      // Modbus register and value behind a generic HRU_CONNECTION_ERROR.
      const cause = error.cause instanceof Error ? error.cause.message : undefined;
      response
        .status(error.statusCode)
        .json({ detail: error.message, code: error.code, ...(cause ? { cause } : {}) });
      return;
    }

    logger.error({ error }, "Unhandled error");
    response.status(500).json({ detail: "Internal server error" });
  };
}
