import React, { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Building2, Check, Plus, Search, X } from 'lucide-react'
import {
  assignUserToCustomer,
  describeError,
  unassignUserFromCustomer,
  type AppUserRole,
  type ManagedUser,
  type UserCustomerLink,
} from '@/services/customerOnboardingService'
import type { Customer } from '@/services/supabase'
import { customerLabel, fullName } from './userDisplay'

interface UserSitesSectionProps {
  user: ManagedUser
  /** Active clients, used to populate the "connect a site" picker. */
  customers: Customer[]
  /** This user's current links. Labels come from here so an archived client still renders. */
  links: UserCustomerLink[]
  onChanged: () => Promise<void> | void
}

export const UserSitesSection: React.FC<UserSitesSectionProps> = ({
  user,
  customers,
  links,
  onChanged,
}) => {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  // Customer ids with a call in flight, so each row spins on its own instead of
  // locking the whole panel.
  const [pending, setPending] = useState<string[]>([])

  const assignedIds = useMemo(() => new Set(links.map((link) => link.customerId)), [links])

  const assigned = useMemo(
    () =>
      [...links].sort((a, b) =>
        a.customerLabel.toLowerCase().localeCompare(b.customerLabel.toLowerCase()),
      ),
    [links],
  )

  const available = useMemo(() => {
    const query = search.trim().toLowerCase()
    return customers
      .filter((customer) => !assignedIds.has(customer.id))
      .filter((customer) => !query || customerLabel(customer).toLowerCase().includes(query))
  }, [customers, assignedIds, search])

  const runChange = async (
    customerId: string,
    label: string,
    action: 'connect' | 'disconnect',
    // Disconnects pass the role carried on the link row itself rather than
    // defaulting to the open user's, so an X always deletes from the table the
    // link actually came from. Connects have no such row yet, so the default
    // is the only source there.
    role: AppUserRole = user.role,
  ) => {
    setPending((prev) => [...prev, customerId])
    try {
      if (action === 'connect') {
        await assignUserToCustomer(role, user.user_id, customerId)
      } else {
        await unassignUserFromCustomer(role, user.user_id, customerId)
      }
      await onChanged()
      toast({
        title: action === 'connect' ? 'Site connected' : 'Site disconnected',
        description: `${fullName(user)} — ${label}`,
      })
    } catch (err) {
      toast({
        title: action === 'connect' ? 'Could not connect site' : 'Could not disconnect site',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setPending((prev) => prev.filter((id) => id !== customerId))
    }
  }

  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Sites</h3>

      {assigned.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
          Not linked to any site yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100">
          {assigned.map((link, idx) => (
            <div
              key={link.customerId}
              className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-gray-50' : ''}`}
            >
              <Building2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {link.customerLabel}
              </span>
              <button
                type="button"
                aria-label={`Disconnect ${link.customerLabel}`}
                disabled={pending.includes(link.customerId)}
                onClick={() =>
                  runChange(link.customerId, link.customerLabel, 'disconnect', link.role)
                }
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <div className="relative mb-2">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Connect a site"
            className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 pl-11"
          />
        </div>

        {available.length === 0 ? (
          <p className="px-1 py-2 text-xs text-gray-400">
            {search.trim() ? 'No sites match.' : 'Linked to every site.'}
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-2xl border border-gray-100">
            {available.map((customer, idx) => {
              const label = customerLabel(customer)
              const isPending = pending.includes(customer.id)
              return (
                <button
                  key={customer.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => runChange(customer.id, label, 'connect')}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 disabled:opacity-40 ${
                    idx > 0 ? 'border-t border-gray-50' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{label}</span>
                  {isPending ? (
                    <Check className="h-4 w-4 shrink-0 text-gray-300" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-gray-400" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
