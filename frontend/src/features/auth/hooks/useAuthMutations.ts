import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as authApi from '../api/authApi'

export function useSignup() {
  return useMutation({ mutationFn: authApi.signupRequest })
}

export function useLogin() {
  return useMutation({ mutationFn: authApi.loginRequest })
}

export function useSelectOrg() {
  return useMutation({
    mutationFn: ({ orgId, pendingToken }: { orgId: string; pendingToken: string }) =>
      authApi.selectOrgRequest(orgId, pendingToken)
  })
}

export function useForgotPassword() {
  return useMutation({ mutationFn: authApi.forgotPasswordRequest })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPasswordRequest(token, password)
  })
}

export function useVerifyEmail() {
  return useMutation({ mutationFn: authApi.verifyEmailRequest })
}

export function useResendVerification() {
  return useMutation({ mutationFn: authApi.resendVerificationRequest })
}

export function usePreviewInvitation() {
  return useMutation({ mutationFn: authApi.previewInvitationRequest })
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ token, password, name }: { token: string; password: string; name?: string }) =>
      authApi.acceptInvitationRequest(token, password, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] })
  })
}

export function useCreateInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.createInvitationRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] })
  })
}

export function useSwitchOrg() {
  return useMutation({ mutationFn: (orgId: string) => authApi.switchOrgRequest(orgId) })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => authApi.createOrganizationRequest(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] })
  })
}
