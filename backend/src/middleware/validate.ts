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
