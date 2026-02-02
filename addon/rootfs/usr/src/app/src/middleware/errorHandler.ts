import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { ApiError } from "../shared/errors/apiErrors";

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
      response.status(error.statusCode).json({ detail: error.message });
      return;
    }

    logger.error({ error }, "Unhandled error");
    response.status(500).json({ detail: "Internal server error" });
  };
}
