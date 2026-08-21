import { Request, Response, NextFunction } from 'express'
import { ZodType } from 'zod'
import { AppError } from '../shared/utils/AppError'

/**
 * Validates req.body against a zod schema, replacing it with the parsed
 * (and type-coerced) result. Throws a 400 AppError with field-level details on failure.
 */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      throw AppError.badRequest('Validation failed', 'VALIDATION_ERROR', result.error.flatten())
    }
    req.body = result.data
    next()
  }
}

/**
 * Same as validateBody, but for req.query — used by GET endpoints with
 * optional filters. Express 5 exposes `req.query` as a getter-only accessor
 * on the prototype, so a plain `req.query = ...` assignment throws at
 * runtime ("Cannot set property query... which has only a getter") —
 * redefining the property on the instance is the reliable way around that.
 */
export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      throw AppError.badRequest('Validation failed', 'VALIDATION_ERROR', result.error.flatten())
    }
    Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true })
    next()
  }
}
