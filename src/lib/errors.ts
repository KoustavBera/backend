export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ACCOUNT_LOCKED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "INTERNAL_SERVER_ERROR";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = "INTERNAL_SERVER_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(message, 400, "BAD_REQUEST", details);
  }

  static validation(message: string, details?: unknown) {
    return new AppError(message, 400, "VALIDATION_ERROR", details);
  }

  static unauthorized(message = "Unauthorized") {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message = "Forbidden") {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static notFound(message = "Resource not found") {
    return new AppError(message, 404, "NOT_FOUND");
  }

  static conflict(message: string) {
    return new AppError(message, 409, "CONFLICT");
  }

  static locked(message = "Account temporarily locked due to multiple failed attempts") {
    return new AppError(message, 423, "ACCOUNT_LOCKED");
  }

  static rateLimited(message = "Too many requests. Please try again later.") {
    return new AppError(message, 429, "RATE_LIMITED");
  }

  static internal(message = "An unexpected server error occurred") {
    return new AppError(message, 500, "INTERNAL_SERVER_ERROR");
  }
}

