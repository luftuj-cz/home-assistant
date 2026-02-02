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
