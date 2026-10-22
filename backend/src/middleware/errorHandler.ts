import { Request, Response, NextFunction } from 'express'
import { AppError } from '../shared/utils/AppError'

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { message: err.message, code: err.code, details: err.details }
    })
  }
  const status = err?.status || 500
  const message = err?.message || 'Internal Server Error'
  res.status(status).json({
    success: false,
    error: {
      message,
      code: err?.code || 'INTERNAL_ERROR'
    }
  })
}
