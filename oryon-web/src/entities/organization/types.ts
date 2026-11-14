import { MembershipRole } from '../user/types'

export interface Organization {
  id: string
  name: string
  slug: string
  role: MembershipRole
}
