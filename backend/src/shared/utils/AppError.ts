/**
 * Standard application error carrying an HTTP status and a machine-readable code.
 * Thrown from services/controllers and handled by the centralized errorHandler middleware.
 */
export class AppError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details?: unknown

  constructor(message: string, status = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    Error.captureStackTrace?.(this, AppError)
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(message, 400, code, details)
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code)
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(message, 403, code)
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(message, 404, code)
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(message, 409, code)
  }
}
