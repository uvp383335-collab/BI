import { Response } from 'express'

/**
 * Standard success response envelope used across all API endpoints.
 */
export function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data })
}
