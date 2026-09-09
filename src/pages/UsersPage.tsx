import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { PageHeader, FilterStrip } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, Search, X, Plus, Copy, Check, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { UserDetailPanel } from '@/components/admin/users/UserDetailPanel'
import {
  ALL_ROLES,
  AVATAR_BG,
  ROLE_LABEL,
  ROLE_ORDER,
  initials,
  isSiteScopedRole,
} from '@/components/admin/users/userDisplay'
import { fetchCustomers } from '@/services/customersService'
import {
  listAllUsers,
  listUserCustomerLinks,
  createUserAccount,
  describeError,
  DuplicateIdentityError,
  type ManagedUser,
  type AppUserRole,
  type CollidingUser,
  type CreatedUser,
  type UserCustomerLink,
} from '@/services/customerOnboardingService'
import type { Customer } from '@/services/supabase'

type UserRef = { role: AppUserRole; userId: string }

export default function UsersPage() {
  const { toast } = useToast()
  // Identity comes from the auth context, not localStorage. RequireAuth has
  // already established that this is a verified admin with a live session; a
  // mount-only localStorage read could not react when that stopped being true.
  const { appUser } = useAuth()
  const userName = appUser?.name ?? ''
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [links, setLinks] = useState<UserCustomerLink[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<AppUserRole | 'all'>('all')
  const [showInactive, setShowInactive] = useState(false)
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [detail, setDetail] = useState<UserRef | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [addRole, setAddRole] = useState<AppUserRole>('cleaner')
  const [addFirst, setAddFirst] = useState('')
  const [addLast, setAddLast] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const [collision, setCollision] = useState<CollidingUser | null>(null)
  // An identity held by a login with nobody behind it. Kept in the dialog rather
  // than a toast: there is no profile to open, so this message IS the whole
  // answer, and a message that disappears in seconds is the dead end again.
  const [orphanNotice, setOrphanNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)


  // Connecting two sites in quick succession fires two refreshes; without this
  // the slower one lands last and paints stale links over the newer answer.
  const refreshSeq = useRef(0)

  const refresh = async () => {
    const seq = refreshSeq.current + 1
    refreshSeq.current = seq
    try {
      setIsLoading(true)
      const [userRows, linkRows, customerRows] = await Promise.all([
        listAllUsers(),
        listUserCustomerLinks(),
        fetchCustomers(),
      ])
      if (seq !== refreshSeq.current) return
      setUsers(userRows)
      setLinks(linkRows)
      setCustomers(customerRows.filter((c) => c.is_active !== false))
    } catch (err) {
      if (seq !== refreshSeq.current) return
      toast({
        title: 'Could not load users',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      if (seq === refreshSeq.current) setIsLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Keyed by user id alone. Cleaners and managers are both keyed by their auth
  // UUID, so the id is already unique across the two tables — and listAllUsers
  // and listUserCustomerLinks derive `role` in separate RPCs, so folding role
  // into the key would silently drop every link for anyone they disagree about.
  const linksByUser = useMemo(() => {
    const map = new Map<string, UserCustomerLink[]>()
    for (const link of links) {
      map.set(link.userId, [...(map.get(link.userId) ?? []), link])
    }
    return map
  }, [links])

  const linksFor = (user: ManagedUser) => linksByUser.get(user.user_id) ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (!showInactive && !u.is_active) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (unlinkedOnly) {
        if (!isSiteScopedRole(u.role)) return false
        if ((linksByUser.get(u.user_id) ?? []).length > 0) return false
      }
      if (!q) return true
      return `${u.first_name} ${u.last_name} ${u.identifier ?? ''}`.toLowerCase().includes(q)
    })
  }, [users, search, roleFilter, showInactive, unlinkedOnly, linksByUser])

  const grouped = useMemo(() => {
    const map: Record<AppUserRole, ManagedUser[]> = {
      admin: [],
      ops_manager: [],
      manager: [],
      cleaner: [],
    }
    for (const u of filtered) {
      map[u.role].push(u)
    }
    for (const r of ROLE_ORDER) {
      map[r].sort((a, b) =>
        `${a.first_name} ${a.last_name}`
          .toLowerCase()
          .localeCompare(`${b.first_name} ${b.last_name}`.toLowerCase()),
      )
    }
    return map
  }, [filtered])

  // Resolved from the live list rather than held as a snapshot, so a rename or a
  // site change inside the panel is reflected there immediately after a refresh.
  const detailUser = useMemo(
    () =>
      detail
        ? (users.find((u) => u.role === detail.role && u.user_id === detail.userId) ?? null)
        : null,
    [detail, users],
  )

  const openAdd = () => {
    setAddRole('cleaner')
    setAddFirst('')
    setAddLast('')
    setAddPhone('')
    setAddUsername('')
    setAddEmail('')
    setCreated(null)
    setCollision(null)
    setOrphanNotice(null)
    setCopied(false)
    setIsAdding(true)
  }

  const submitAdd = async () => {
    if (!addFirst.trim() || !addLast.trim()) {
      toast({ title: 'First and last name required', variant: 'destructive' })
      return
    }
    if ((addRole === 'cleaner' || addRole === 'manager') && !addPhone.trim()) {
      toast({ title: 'Phone number required', variant: 'destructive' })
      return
    }
    if ((addRole === 'ops_manager' || addRole === 'admin') && !addUsername.trim()) {
      toast({ title: 'Username required', variant: 'destructive' })
      return
    }
    if (addRole === 'admin' && !addEmail.trim()) {
      toast({ title: 'Email required for admin', variant: 'destructive' })
      return
    }
    setIsCreating(true)
    setCollision(null)
    setOrphanNotice(null)
    try {
      const result = await createUserAccount({
        role: addRole,
        firstName: addFirst,
        lastName: addLast,
        phone: addPhone || undefined,
        username: addUsername || undefined,
        email: addEmail || undefined,
      })
      setCreated(result)
      await refresh()
    } catch (err) {
      // A taken identity is not a failure the admin can retry their way out of,
      // and the toast is gone in seconds. When the function names the holder,
      // keep it in the dialog with a way to reach them instead.
      if (err instanceof DuplicateIdentityError && err.existing) {
        setCollision(err.existing)
        return
      }
      // No holder to open, but the function established there IS one holding the
      // identity. Keep the explanation on screen; a toast would be the dead end.
      if (err instanceof DuplicateIdentityError && err.orphanedLogin) {
        setOrphanNotice(err.message)
        return
      }
      toast({
        title: 'Could not create user',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsCreating(false)
    }
  }

  // The holder is very often deactivated -- that is exactly why the admin
  // could not find them and tried to create a second account -- so reveal the
  // hidden rows before opening the panel, or they close it onto a list that
  // still does not contain the person they were just shown.
  const openCollidingUser = () => {
    if (!collision) return
    if (!collision.isActive) setShowInactive(true)
    setIsAdding(false)
    setCollision(null)
    setDetail({ role: collision.role, userId: collision.userId })
  }

  const copyPassword = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="admin" userName={userName}>
      <div className="mx-auto w-full max-w-5xl py-1 sm:py-8">
        <PageHeader
          title="Users"
          description="Manage cleaners, managers, and admins — and the sites they're linked to."
          actions={
            <Button
              onClick={openAdd}
              className="h-11 rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add user
            </Button>
          }
        />

        <div className="relative mb-3">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or identifier"
            className="h-12 rounded-2xl border-border bg-card pl-11"
          />
        </div>

        <FilterStrip>
          <FilterPill active={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>
            All
          </FilterPill>
          {ALL_ROLES.map((r) => (
            <FilterPill key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>
              {ROLE_LABEL[r]}
            </FilterPill>
          ))}
          <FilterPill
            active={unlinkedOnly}
            activeClass="bg-warning text-warning-foreground"
            onClick={() => setUnlinkedOnly((v) => !v)}
          >
            No site
          </FilterPill>
          <FilterPill active={showInactive} onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </FilterPill>
        </FilterStrip>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 py-20 text-center text-muted-foreground">
            No users match.
          </div>
        ) : (
          <div className="space-y-10">
            {ROLE_ORDER.map((role) => {
              const rows = grouped[role]
              if (!rows.length) return null
              return (
                <section key={role}>
                  <div className="mb-3 flex items-baseline justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {ROLE_LABEL[role]}s
                    </h2>
                    <span className="text-xs font-medium text-muted-foreground">{rows.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-3xl border border-border bg-card">
                    {rows.map((u, idx) => (
                      <button
                        key={`${u.role}-${u.user_id}`}
                        type="button"
                        onClick={() => setDetail({ role: u.role, userId: u.user_id })}
                        className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted ${
                          idx > 0 ? 'border-t border-border' : ''
                        } ${!u.is_active ? 'opacity-50' : ''}`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${AVATAR_BG[u.role]}`}
                          >
                            {initials(u)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-medium text-foreground">
                              {u.first_name} {u.last_name}
                              {!u.is_active && (
                                <span className="ml-2 text-xs text-muted-foreground">· inactive</span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs">
                              <span className="truncate text-muted-foreground">{u.identifier ?? '—'}</span>
                              <SiteBadge user={u} links={linksFor(u)} />
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        <UserDetailPanel
          user={detailUser}
          customers={customers}
          links={detailUser ? linksFor(detailUser) : []}
          onClose={() => setDetail(null)}
          onChanged={refresh}
        />

        {isAdding &&
          createPortal(
            // Bottom sheet on phones, centred card from sm up. max-h + scroll
            // matters most with the keyboard open, where the admin/email variant
            // of this form is taller than the visible viewport.
            <div className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-center bg-card/30 backdrop-blur-sm sm:items-center sm:p-4">
              <div className="pointer-events-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-border sm:rounded-3xl sm:p-8 sm:pb-8">
                {created ? (
                  <>
                    <div className="mb-6 flex items-center justify-between">
                      <h2 className="text-xl font-semibold text-foreground">User created</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsAdding(false)
                          setCreated(null)
                        }}
                        className="h-8 w-8 rounded-full p-0 text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mb-4 text-sm text-muted-foreground">
                      {created.recorded
                        ? "Share this with them. You can see it again any time on their profile."
                        : 'Save this password now — it could not be stored, so this profile will not show it.'}
                    </p>
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-muted p-4">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Name</div>
                        <div className="mt-1 text-base font-medium text-foreground">
                          {created.firstName} {created.lastName}
                        </div>
                        <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
                          {ROLE_LABEL[created.role]} ·{' '}
                          {created.role === 'cleaner' || created.role === 'manager'
                            ? 'Phone'
                            : 'Username'}
                        </div>
                        <div className="mt-1 text-sm text-foreground">{created.identifier}</div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-foreground">Password</Label>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="flex-1 select-all rounded-2xl bg-muted px-4 py-3 font-mono text-base text-foreground">
                            {created.password}
                          </code>
                          <Button
                            onClick={copyPassword}
                            className="rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                          >
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-8 flex justify-end">
                      <Button
                        onClick={() => {
                          setIsAdding(false)
                          setCreated(null)
                        }}
                        className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"
                      >
                        Done
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-6 flex items-center justify-between">
                      <h2 className="text-xl font-semibold text-foreground">Add user</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAdding(false)}
                        className="h-8 w-8 rounded-full p-0 text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {orphanNotice && (
                      <div className="mb-6 flex gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-warning">{orphanNotice}</p>
                          <p className="mt-1 text-xs text-warning">
                            There is no profile to open — the login exists without a staff record
                            behind it, so it will not appear in this list.
                          </p>
                        </div>
                      </div>
                    )}
                    {collision && (
                      <div className="mb-6 flex gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-warning">
                            {describeCollision(collision)}
                          </p>
                          <p className="mt-1 text-xs text-warning">
                            {collision.isActive
                              ? 'Open their profile instead of adding a second account.'
                              : 'Deactivated people are hidden from this list until you switch the Show inactive filter on.'}
                          </p>
                          {(collision.matchCount ?? 1) > 1 && (
                            // Saying "a record exists" when several do would send the
                            // admin to fix one of them and hit the same refusal again.
                            <p className="mt-1 text-xs font-medium text-warning">
                              {collision.matchCount} records share this number. Opening one will not
                              clear the conflict on its own.
                            </p>
                          )}
                          <Button
                            variant="ghost"
                            onClick={openCollidingUser}
                            className="mt-2 h-8 rounded-full px-3 text-xs font-medium text-warning hover:bg-warning/10"
                          >
                            View profile
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Role</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_ROLES.map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setAddRole(r)}
                              className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                                addRole === r
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {ROLE_LABEL[r]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">First name</Label>
                          <Input
                            value={addFirst}
                            onChange={(e) => setAddFirst(e.target.value)}
                            className="h-12 rounded-2xl border-border bg-muted/70 px-4"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">Last name</Label>
                          <Input
                            value={addLast}
                            onChange={(e) => setAddLast(e.target.value)}
                            className="h-12 rounded-2xl border-border bg-muted/70 px-4"
                          />
                        </div>
                      </div>
                      {(addRole === 'cleaner' || addRole === 'manager') && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">Mobile number</Label>
                          <Input
                            value={addPhone}
                            onChange={(e) => setAddPhone(e.target.value)}
                            placeholder="+44…"
                            className="h-12 rounded-2xl border-border bg-muted/70 px-4"
                          />
                        </div>
                      )}
                      {(addRole === 'ops_manager' || addRole === 'admin') && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">Username</Label>
                          <Input
                            value={addUsername}
                            onChange={(e) => setAddUsername(e.target.value)}
                            className="h-12 rounded-2xl border-border bg-muted/70 px-4"
                          />
                        </div>
                      )}
                      {addRole === 'admin' && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">Email</Label>
                          <Input
                            type="email"
                            value={addEmail}
                            onChange={(e) => setAddEmail(e.target.value)}
                            className="h-12 rounded-2xl border-border bg-muted/70 px-4"
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-8 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setIsAdding(false)}
                        className="rounded-full text-muted-foreground"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={submitAdd}
                        disabled={isCreating}
                        className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"
                      >
                        {isCreating ? 'Creating…' : 'Create user'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </Sidebar07Layout>
  )
}

/**
 * What the admin is told when the identity they typed already belongs to
 * someone. Names the person, because the whole failure is that they could not
 * see them -- and says outright when the account is deactivated, which is the
 * usual reason it looked absent.
 */
const describeCollision = (existing: CollidingUser): string => {
  const who = existing.name || `Another ${ROLE_LABEL[existing.role].toLowerCase()}`
  return existing.isActive
    ? `${who} already has an account.`
    : `${who} already has an account (deactivated).`
}

const FilterPill: React.FC<{
  active: boolean
  onClick: () => void
  children: React.ReactNode
  activeClass?: string
}> = ({ active, onClick, children, activeClass = 'bg-primary text-primary-foreground' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-xs font-medium transition ${
      active ? activeClass : 'bg-card text-muted-foreground hover:bg-muted'
    }`}
  >
    {children}
  </button>
)

const SiteBadge: React.FC<{ user: ManagedUser; links: UserCustomerLink[] }> = ({ user, links }) => {
  if (!isSiteScopedRole(user.role)) return null

  if (links.length === 0) {
    return (
      <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">
        No site
      </span>
    )
  }

  return (
    <span className="max-w-[12rem] truncate rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
      {links.length === 1 ? links[0].customerLabel : `${links.length} sites`}
    </span>
  )
}
