import type { AppUserRole, ManagedUser } from '@/services/customerOnboardingService'
import type { Customer } from '@/services/supabase'

export const ROLE_LABEL: Record<AppUserRole, string> = {
  cleaner: 'Cleaner',
  manager: 'Client',
  ops_manager: 'Ops Manager',
  admin: 'Admin',
}

export const ALL_ROLES: AppUserRole[] = ['cleaner', 'manager', 'ops_manager', 'admin']

/** Order the users list groups people in — most privileged first. */
export const ROLE_ORDER: AppUserRole[] = ['admin', 'ops_manager', 'manager', 'cleaner']

export const AVATAR_BG: Record<AppUserRole, string> = {
  admin: 'bg-[#00339B] text-white',
  ops_manager: 'bg-amber-100 text-amber-700',
  manager: 'bg-emerald-100 text-emerald-700',
  cleaner: 'bg-blue-100 text-blue-700',
}

export const fullName = (user: ManagedUser) =>
  `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || 'Unnamed'

export const initials = (user: ManagedUser) => {
  const first = (user.first_name ?? '').trim().charAt(0)
  const last = (user.last_name ?? '').trim().charAt(0)
  return (first + last).toUpperCase() || '?'
}

export const customerLabel = (customer: Customer) =>
  customer.display_name?.trim() || customer.name?.trim() || 'Unnamed client'

/** Admins are unscoped — they already see every site — so they have no links. */
export const isSiteScopedRole = (role: AppUserRole) => role !== 'admin'

export const formatJoinedDate = (value: string | null | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
