export type MembershipRole = 'owner' | 'admin' | 'member'

export interface User {
  id: string
  name: string
  email: string
}
