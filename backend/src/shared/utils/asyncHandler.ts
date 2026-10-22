import { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Wraps an async Express handler so rejected promises are forwarded to next(),
 * avoiding repetitive try/catch blocks in controllers.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
