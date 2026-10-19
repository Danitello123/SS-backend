// ---------------- TYPES ----------------

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ApiResponseEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: ErrorPayload;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// ---------------- APP ERROR ----------------

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code: string, details?: unknown);
  constructor(message: string, statusCode: number, code?: string, details?: unknown);
  constructor(arg1: number | string, arg2: string | number, arg3?: string, arg4?: unknown) {
    let statusCode: number;
    let message: string;
    let code: string;
    let details: unknown;

    if (typeof arg1 === "number") {
      statusCode = arg1;
      message = typeof arg2 === "string" ? arg2 : String(arg2);
      code = arg3 ?? `APP_${statusCode}`;
      details = arg4;
    } else {
      message = arg1;
      statusCode = typeof arg2 === "number" ? arg2 : 500;
      code = arg3 ?? `APP_${statusCode}`;
      details = arg4;
    }

    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * AppError whose `details` are safe to return to the client, e.g. the
 * allowed next statuses on a rejected invoice transition. Plain AppError
 * details stay server-side because some carry internal context.
 */
export class PublicAppError extends AppError {
  constructor(statusCode: number, message: string, code: string, details?: unknown) {
    super(statusCode, message, code, details);
    this.name = "PublicAppError";
  }
}

// ---------------- HTTP ERROR ----------------

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = `HTTP_${statusCode}`;
    this.details = details;
  }
}
