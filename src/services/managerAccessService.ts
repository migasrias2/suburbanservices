import { hydrateManagerScopes, resolveManagerCustomerScope } from '../lib/managerScope'
import { fetchManagerCleanerIds } from './managerService'

export type ManagerAccessRole = 'manager' | 'ops_manager' | 'admin'

export type UnlinkedReason = 'no_customers' | 'no_cleaners' | 'lookup_failed'

/**
 * What a manager-facing screen may show.
 *
 *   global   -- admin and ops_manager: every client, as before.
 *   scoped   -- a client login linked to at least one client and one cleaner.
 *   unlinked -- a client login we cannot fence in. Show nothing.
 *
 * THIS IS A UX BOUNDARY, NOT A SECURITY BOUNDARY. It stops the app from
 * fetching and rendering other clients' data, but the browser can still query
 * any table its grants and RLS allow. The database policies are the real fence.
 */
export type ManagerAccess =
  | { status: 'global' }
  | { status: 'scoped'; cleanerIds: string[]; customerTokens: string[] }
  | { status: 'unlinked'; reason: UnlinkedReason }

export type GrantedManagerAccess = Exclude<ManagerAccess, { status: 'unlinked' }>

export const isGlobalManagerRole = (role: ManagerAccessRole): boolean =>
  role === 'admin' || role === 'ops_manager'

type ResolveManagerAccessParams = {
  role: ManagerAccessRole
  managerId: string | null | undefined
  managerName?: string | null
}

const unlinked = (reason: UnlinkedReason): ManagerAccess => ({ status: 'unlinked', reason })

/**
 * Decides what a manager-facing screen may load. Never throws: any doubt about
 * a client login's links resolves to `unlinked`, never to the full data set.
 */
export async function resolveManagerAccess({
  role,
  managerId,
  managerName,
}: ResolveManagerAccessParams): Promise<ManagerAccess> {
  if (isGlobalManagerRole(role)) {
    return { status: 'global' }
  }

  const id = managerId?.trim() ?? ''
  if (!id) {
    return unlinked('lookup_failed')
  }

  const scopesLoaded = await hydrateManagerScopes()
  if (!scopesLoaded) {
    return unlinked('lookup_failed')
  }

  const customerTokens = resolveManagerCustomerScope(id, managerName ?? null)
  if (!customerTokens.length) {
    return unlinked('no_customers')
  }

  let cleanerIds: string[]
  try {
    cleanerIds = await fetchManagerCleanerIds(id)
  } catch (error) {
    console.error('Could not load the cleaners linked to this login', error)
    return unlinked('lookup_failed')
  }

  if (!cleanerIds.length) {
    return unlinked('no_cleaners')
  }

  return { status: 'scoped', cleanerIds, customerTokens }
}
