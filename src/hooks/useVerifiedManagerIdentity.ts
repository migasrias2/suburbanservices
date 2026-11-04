import { useAuth } from '@/contexts/AuthContext'
import type { ManagerAccessRole } from '@/services/managerAccessService'

export type VerifiedManagerIdentity = {
  managerId: string
  managerName: string
  role: ManagerAccessRole
}

const MANAGER_ROLES: readonly ManagerAccessRole[] = ['manager', 'ops_manager', 'admin']

/**
 * Who is looking at a manager-facing screen, from the session and the
 * has_app_role check -- never from localStorage. `userType` and `userId` in
 * localStorage are editable in devtools, so reading them let a client login
 * claim 'admin' (the global view) or another client's id.
 *
 * Null until the session and role are confirmed, or when the verified role is
 * not a manager role. RequireAuth has already gated the route by then.
 */
export function useVerifiedManagerIdentity(): VerifiedManagerIdentity | null {
  const { appUser, verifiedRole } = useAuth()

  if (!appUser?.id || !verifiedRole) return null
  const role = MANAGER_ROLES.find((candidate) => candidate === verifiedRole)
  if (!role) return null

  return { managerId: appUser.id, managerName: appUser.name, role }
}
