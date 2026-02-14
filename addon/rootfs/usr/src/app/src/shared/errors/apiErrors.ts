import type { Logger } from "pino";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  public log(logger: Logger): void {
    if (this.statusCode >= 500) {
      logger.error({ error: this, code: this.code }, this.message);
    } else {
      logger.warn({ error: this, code: this.code }, this.message);
    }
  }
}

export class ApiSuccess {
  constructor(
    public readonly message: string,
    public readonly data?: unknown,
  ) {}

  public log(logger: Logger): void {
    logger.info({ data: this.data }, this.message);
  }
}

export class HruNotConfiguredError extends ApiError {
  constructor(message = "HRU unit not configured") {
    super(400, message, "HRU_NOT_CONFIGURED");
  }
}

export class HruConnectionError extends ApiError {
  constructor(message = "Failed to connect to HRU", originalError?: unknown) {
    super(502, message, "HRU_CONNECTION_ERROR");
    if (originalError) {
      this.cause = originalError;
    }
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, code?: string) {
    super(400, message, code);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, code?: string) {
    super(404, message, code);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, code?: string) {
    super(409, message, code);
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message: string, code?: string) {
    super(503, message, code);
  }
}
