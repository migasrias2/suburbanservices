import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Search, Plus, X, Building2, Check } from 'lucide-react'
import { getStoredCleanerName } from '@/lib/identity'
import { fetchCustomers } from '@/services/customersService'
import {
  listManagers,
  listAssignedManagers,
  assignManagerToCustomer,
  unassignManagerFromCustomer,
  describeError,
  type ManagerSummary,
} from '@/services/customerOnboardingService'
import type { Customer } from '@/services/supabase'

const ROLE_LABEL: Record<string, string> = {
  manager: 'Client',
  ops_manager: 'Ops Manager',
}

const customerLabel = (c: Customer) => c.display_name?.trim() || c.name?.trim() || 'Unnamed client'

const managerLabel = (m: ManagerSummary) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'Unnamed'

const managerIdentifier = (m: ManagerSummary) => m.username?.trim() || m.mobile_number?.trim() || ''

export default function DashboardAccessPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userName, setUserName] = useState('')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<ManagerSummary[]>([])
  const [isLoadingAssigned, setIsLoadingAssigned] = useState(false)

  const [clientSearch, setClientSearch] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  // Manager ids with an assign/unassign call in flight, so each row can show
  // its own spinner instead of locking the whole panel.
  const [pending, setPending] = useState<string[]>([])

  useEffect(() => {
    const storedType = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = getStoredCleanerName()
    if (storedType !== 'admin' || !storedId || !storedName) {
      navigate('/login')
      return
    }
    setUserType('admin')
    setUserName(storedName)
  }, [navigate])

  useEffect(() => {
    if (userType !== 'admin') return
    ;(async () => {
      try {
        setIsLoading(true)
        const [customerRows, managerRows] = await Promise.all([fetchCustomers(), listManagers()])
        setCustomers(customerRows.filter((c) => c.is_active !== false))
        setManagers(managerRows)
      } catch (err) {
        toast({ title: 'Could not load clients', description: describeError(err), variant: 'destructive' })
      } finally {
        setIsLoading(false)
      }
    })()
  }, [userType, toast])

  const loadAssigned = async (customerId: string) => {
    try {
      setIsLoadingAssigned(true)
      setAssigned(await listAssignedManagers(customerId))
    } catch (err) {
      toast({ title: 'Could not load access list', description: describeError(err), variant: 'destructive' })
      setAssigned([])
    } finally {
      setIsLoadingAssigned(false)
    }
  }

  const selectCustomer = (customerId: string) => {
    setSelectedId(customerId)
    setStaffSearch('')
    loadAssigned(customerId)
  }

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId],
  )

  const filteredCustomers = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c) => customerLabel(c).toLowerCase().includes(q))
  }, [customers, clientSearch])

  const assignedIds = useMemo(() => new Set(assigned.map((m) => m.id)), [assigned])

  // admin_list_customer_managers omits `username`, so an assigned ops manager
  // would render with no identifier. The full roster already has it — prefer
  // that record for display and fall back to the assignment row.
  const managersById = useMemo(() => new Map(managers.map((m) => [m.id, m])), [managers])
  const forDisplay = (m: ManagerSummary) => managersById.get(m.id) ?? m

  const available = useMemo(() => {
    const q = staffSearch.trim().toLowerCase()
    return managers
      .filter((m) => !assignedIds.has(m.id))
      .filter((m) => !q || `${managerLabel(m)} ${managerIdentifier(m)}`.toLowerCase().includes(q))
  }, [managers, assignedIds, staffSearch])

  const runAssignment = async (
    manager: ManagerSummary,
    action: 'assign' | 'remove',
  ) => {
    if (!selectedId || !selectedCustomer) return
    setPending((prev) => [...prev, manager.id])
    try {
      if (action === 'assign') {
        await assignManagerToCustomer(manager.id, selectedId)
      } else {
        await unassignManagerFromCustomer(manager.id, selectedId)
      }
      await loadAssigned(selectedId)
      toast({
        title: action === 'assign' ? 'Access granted' : 'Access removed',
        description: `${managerLabel(manager)} — ${customerLabel(selectedCustomer)}`,
      })
    } catch (err) {
      toast({
        title: action === 'assign' ? 'Could not grant access' : 'Could not remove access',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setPending((prev) => prev.filter((id) => id !== manager.id))
    }
  }

  if (!userType || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="mx-auto w-full max-w-6xl py-1 sm:py-8">
        <PageHeader
          title="Dashboard Access"
          description="Choose a client, then decide which accounts can see its dashboard."
        />
        <div className="mb-6 sm:mb-8">
          {/* Scope resolution fails open: buildCustomerScopeMatcher() matches
              everything when an account has no assignments at all. Removing an
              account's last assignment therefore widens its view rather than
              narrowing it, which is the opposite of what "Remove" implies. */}
          <p className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
            An account with no assignments at all currently sees every client. Removing
            someone&rsquo;s last assignment widens their view instead of narrowing it.
          </p>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Clients */}
            <section className="lg:col-span-2">
              <div className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Clients
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search clients"
                  className="h-12 rounded-2xl border-border bg-card pl-11"
                />
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-16 text-center text-sm text-muted-foreground">
                  No clients match.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredCustomers.map((c) => {
                    const active = c.id === selectedId
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c.id)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
                          active
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-card hover:bg-muted'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Building2 className="h-4 w-4" />
                        </div>
                        <span
                          className={`truncate text-sm ${
                            active ? 'font-semibold text-primary' : 'text-foreground'
                          }`}
                        >
                          {customerLabel(c)}
                        </span>
                        {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Access for the selected client */}
            <section className="lg:col-span-3">
              {!selectedCustomer ? (
                <div className="flex h-full min-h-[280px] items-center justify-center rounded-3xl border border-dashed border-border bg-card/60 px-6 text-center text-sm text-muted-foreground">
                  Select a client to manage who can see its dashboard.
                </div>
              ) : (
                <div className="rounded-3xl border border-border bg-card p-5 sm:p-6">
                  <div className="mb-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Dashboard access
                    </div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {customerLabel(selectedCustomer)}
                    </div>
                  </div>

                  {isLoadingAssigned ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
                  ) : (
                    <>
                      {assigned.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                          No accounts are assigned to this client.
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {assigned.map((row) => {
                            const m = forDisplay(row)
                            const busy = pending.includes(m.id)
                            return (
                              <li
                                key={m.id}
                                className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {managerLabel(m)}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {ROLE_LABEL[m.role ?? 'manager'] ?? m.role}
                                    {managerIdentifier(m) && ` · ${managerIdentifier(m)}`}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => runAssignment(m, 'remove')}
                                  aria-label={`Remove ${managerLabel(m)}`}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                                >
                                  {busy ? (
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-transparent" />
                                  ) : (
                                    <X className="h-4 w-4" />
                                  )}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      <div className="mt-7 border-t border-border pt-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Add access
                        </div>
                        <div className="relative mb-3">
                          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={staffSearch}
                            onChange={(e) => setStaffSearch(e.target.value)}
                            placeholder="Search accounts"
                            className="h-12 rounded-2xl border-border bg-card pl-11"
                          />
                        </div>

                        {available.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                            {staffSearch.trim()
                              ? 'No accounts match.'
                              : 'Every account already has access.'}
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {available.map((m) => {
                              const busy = pending.includes(m.id)
                              return (
                                <li
                                  key={m.id}
                                  className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-foreground">
                                      {managerLabel(m)}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {ROLE_LABEL[m.role ?? 'manager'] ?? m.role}
                                      {managerIdentifier(m) && ` · ${managerIdentifier(m)}`}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => runAssignment(m, 'assign')}
                                    aria-label={`Grant access to ${managerLabel(m)}`}
                                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
                                  >
                                    {busy ? (
                                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/50 border-t-transparent" />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" />
                                    )}
                                    Add
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </Sidebar07Layout>
  )
}
