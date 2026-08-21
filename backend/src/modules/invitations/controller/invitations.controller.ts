import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import * as invitationsService from '../service/invitations.service'
import { AppError } from '../../../shared/utils/AppError'

export const createInvitation = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const invitedBy = req.auth!.userId
  const { email, role } = req.body
  const result = await invitationsService.createInvitation(orgId, invitedBy, email, role)
  return sendSuccess(res, result, 201)
})

export const listInvitations = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const page = parseInt((req.query.page as string) ?? '1', 10)
  const pageSize = parseInt((req.query.pageSize as string) ?? '20', 10)
  const status = (req.query.status as string) ?? undefined
  const role = (req.query.role as string) ?? undefined
  const sort = (req.query.sort as string) ?? undefined
  const result = await invitationsService.listInvitations(orgId, { page, pageSize, status, role, sort })
  return sendSuccess(res, result)
})

export const previewInvitation = asyncHandler(async (req: Request, res: Response) => {
  const token = req.params.token as string
  const result = await invitationsService.previewInvitation(token)
  return sendSuccess(res, result)
})

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  const token = req.params.token as string
  const { password, name } = req.body
  if (!password) {
    throw AppError.badRequest('Password is required', 'VALIDATION_ERROR')
  }
  const result = await invitationsService.acceptInvitation(token, password, name)
  return sendSuccess(res, result)
})
