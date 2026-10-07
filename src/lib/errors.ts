/**
 * Typed application errors. Every failure that should reach the client as a
 * meaningful response is an `AppError`; anything else is a genuine bug and
 * surfaces as a 500.
 */
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCodeValue, number> = {
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INVALID_TRANSITION]: 422,
  [ErrorCode.INTERNAL]: 500,
};

export type ErrorDetail = { readonly path: string; readonly message: string };

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details: readonly ErrorDetail[];

  constructor(code: ErrorCodeValue, message: string, details: readonly ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toJSON(): { error: { code: string; message: string; details: readonly ErrorDetail[] } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const validationError = (message: string, details: readonly ErrorDetail[] = []): AppError =>
  new AppError(ErrorCode.VALIDATION, message, details);

export const notFound = (what: string): AppError =>
  new AppError(ErrorCode.NOT_FOUND, `${what} not found`);

export const forbidden = (message: string): AppError => new AppError(ErrorCode.FORBIDDEN, message);

export const unauthenticated = (message = 'Authentication required'): AppError =>
  new AppError(ErrorCode.UNAUTHENTICATED, message);

export const conflict = (message: string): AppError => new AppError(ErrorCode.CONFLICT, message);

export const invalidTransition = (message: string): AppError =>
  new AppError(ErrorCode.INVALID_TRANSITION, message);
