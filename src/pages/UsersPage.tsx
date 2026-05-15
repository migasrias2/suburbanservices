import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Search, Trash2, Pencil, X, Save, Plus, Copy, Check } from 'lucide-react'
import { getStoredCleanerName } from '@/lib/identity'
import {
  listAllUsers,
  renameUser,
  deactivateUser,
  createUserAccount,
  describeError,
  type ManagedUser,
  type AppUserRole,
  type CreatedUser,
} from '@/services/customerOnboardingService'

const ROLE_LABEL: Record<AppUserRole, string> = {
  cleaner: 'Cleaner',
  manager: 'Manager',
  ops_manager: 'Ops Manager',
  admin: 'Admin',
}

const ALL_ROLES: AppUserRole[] = ['cleaner', 'manager', 'ops_manager', 'admin']

export default function UsersPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userName, setUserName] = useState('')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<AppUserRole | 'all'>('all')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [addRole, setAddRole] = useState<AppUserRole>('cleaner')
  const [addFirst, setAddFirst] = useState('')
  const [addLast, setAddLast] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const [copied, setCopied] = useState(false)

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

  const refresh = async () => {
    try {
      setIsLoading(true)
      setUsers(await listAllUsers())
    } catch (err) {
      toast({ title: 'Could not load users', description: describeError(err), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (userType === 'admin') refresh()
  }, [userType])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (!showInactive && !u.is_active) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return `${u.first_name} ${u.last_name} ${u.identifier ?? ''}`.toLowerCase().includes(q)
    })
  }, [users, search, roleFilter, showInactive])

  const ROLE_ORDER: AppUserRole[] = ['admin', 'ops_manager', 'manager', 'cleaner']

  const grouped = useMemo(() => {
    const map: Record<AppUserRole, ManagedUser[]> = {
      admin: [], ops_manager: [], manager: [], cleaner: [],
    }
    for (const u of filtered) {
      map[u.role].push(u)
    }
    for (const r of ROLE_ORDER) {
      map[r].sort((a, b) =>
        `${a.first_name} ${a.last_name}`.toLowerCase().localeCompare(`${b.first_name} ${b.last_name}`.toLowerCase()),
      )
    }
    return map
  }, [filtered])

  const initials = (u: ManagedUser) => {
    const f = (u.first_name ?? '').trim().charAt(0)
    const l = (u.last_name ?? '').trim().charAt(0)
    return (f + l).toUpperCase() || '?'
  }

  const AVATAR_BG: Record<AppUserRole, string> = {
    admin: 'bg-[#00339B] text-white',
    ops_manager: 'bg-amber-100 text-amber-700',
    manager: 'bg-emerald-100 text-emerald-700',
    cleaner: 'bg-blue-100 text-blue-700',
  }

  const openEdit = (u: ManagedUser) => {
    setEditing(u)
    setEditFirst(u.first_name ?? '')
    setEditLast(u.last_name ?? '')
  }

  const saveEdit = async () => {
    if (!editing) return
    if (!editFirst.trim()) {
      toast({ title: 'First name required', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    try {
      await renameUser(editing.role, editing.user_id, editFirst.trim(), editLast.trim())
      toast({ title: 'User renamed' })
      setEditing(null)
      await refresh()
    } catch (err) {
      toast({ title: 'Could not save', description: describeError(err), variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const openAdd = () => {
    setAddRole('cleaner')
    setAddFirst('')
    setAddLast('')
    setAddPhone('')
    setAddUsername('')
    setAddEmail('')
    setCreated(null)
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
      toast({ title: 'Could not create user', description: describeError(err), variant: 'destructive' })
    } finally {
      setIsCreating(false)
    }
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

  const remove = async (u: ManagedUser) => {
    if (!confirm(`Deactivate ${u.first_name} ${u.last_name}?\n\nThey won't be able to log in. Manager assignments will be removed.`)) return
    try {
      await deactivateUser(u.role, u.user_id)
      toast({ title: 'User deactivated' })
      await refresh()
    } catch (err) {
      toast({ title: 'Could not deactivate', description: describeError(err), variant: 'destructive' })
    }
  }

  if (!userType || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="mx-auto w-full max-w-5xl py-4 sm:py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">Users</h1>
            <p className="mt-2 text-gray-500">Manage cleaners, managers, and admins.</p>
          </div>
          <Button
            onClick={openAdd}
            className="rounded-full bg-[#00339B] px-5 text-white hover:bg-[#002d7a]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add user
          </Button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or identifier"
              className="h-12 rounded-2xl border-gray-200 bg-white pl-11"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setRoleFilter('all')}
              className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                roleFilter === 'all' ? 'bg-[#00339B] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              All
            </button>
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                  roleFilter === r ? 'bg-[#00339B] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition ${
              showInactive ? 'bg-[#00339B] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-20 text-center text-gray-400">
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
                    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                      {ROLE_LABEL[role]}{role === 'admin' || role === 'ops_manager' ? 's' : 's'}
                    </h2>
                    <span className="text-xs font-medium text-gray-400">
                      {rows.length}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
                    {rows.map((u, idx) => (
                      <div
                        key={`${u.role}-${u.user_id}`}
                        className={`flex items-center justify-between gap-4 px-5 py-4 ${
                          idx > 0 ? 'border-t border-gray-50' : ''
                        } ${!u.is_active ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${AVATAR_BG[u.role]}`}>
                            {initials(u)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-medium text-gray-900">
                              {u.first_name} {u.last_name}
                              {!u.is_active && <span className="ml-2 text-xs text-gray-400">· inactive</span>}
                            </div>
                            <div className="truncate text-xs text-gray-500">{u.identifier ?? '—'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(u)}
                            className="h-9 w-9 rounded-full p-0 text-gray-500 hover:bg-gray-100"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {u.is_active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(u)}
                              className="h-9 w-9 rounded-full p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {editing && createPortal(
          <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-white/30 p-4 backdrop-blur-sm">
            <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-black/5">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Rename user</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                  className="h-8 w-8 rounded-full p-0 text-gray-500"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">First name</Label>
                  <Input
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                    className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">Last name</Label>
                  <Input
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                    className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                  />
                </div>
              </div>
              <div className="mt-8 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setEditing(null)}
                  className="rounded-full text-gray-600"
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveEdit}
                  disabled={isSaving}
                  className="rounded-full bg-[#00339B] px-6 text-white hover:bg-[#002d7a]"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {isAdding && createPortal(
          <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-white/30 p-4 backdrop-blur-sm">
            <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-black/5">
              {created ? (
                <>
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-gray-900">User created</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setIsAdding(false); setCreated(null) }}
                      className="h-8 w-8 rounded-full p-0 text-gray-500"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mb-4 text-sm text-gray-500">
                    Save this password now — it won't be shown again.
                  </p>
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wider text-gray-400">Name</div>
                      <div className="mt-1 text-base font-medium text-gray-900">
                        {created.firstName} {created.lastName}
                      </div>
                      <div className="mt-3 text-xs uppercase tracking-wider text-gray-400">
                        {ROLE_LABEL[created.role]} · {created.role === 'cleaner' || created.role === 'manager' ? 'Phone' : 'Username'}
                      </div>
                      <div className="mt-1 text-sm text-gray-700">{created.identifier}</div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Password</Label>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 select-all rounded-2xl bg-gray-50 px-4 py-3 font-mono text-base text-gray-900">
                          {created.password}
                        </code>
                        <Button
                          onClick={copyPassword}
                          className="rounded-full bg-[#00339B] px-4 text-white hover:bg-[#002d7a]"
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-8 flex justify-end">
                    <Button
                      onClick={() => { setIsAdding(false); setCreated(null) }}
                      className="rounded-full bg-[#00339B] px-6 text-white hover:bg-[#002d7a]"
                    >
                      Done
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-gray-900">Add user</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAdding(false)}
                      className="h-8 w-8 rounded-full p-0 text-gray-500"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">Role</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setAddRole(r)}
                            className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                              addRole === r ? 'bg-[#00339B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {ROLE_LABEL[r]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">First name</Label>
                        <Input
                          value={addFirst}
                          onChange={(e) => setAddFirst(e.target.value)}
                          className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Last name</Label>
                        <Input
                          value={addLast}
                          onChange={(e) => setAddLast(e.target.value)}
                          className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                        />
                      </div>
                    </div>
                    {(addRole === 'cleaner' || addRole === 'manager') && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Mobile number</Label>
                        <Input
                          value={addPhone}
                          onChange={(e) => setAddPhone(e.target.value)}
                          placeholder="+44…"
                          className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                        />
                      </div>
                    )}
                    {(addRole === 'ops_manager' || addRole === 'admin') && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Username</Label>
                        <Input
                          value={addUsername}
                          onChange={(e) => setAddUsername(e.target.value)}
                          className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                        />
                      </div>
                    )}
                    {addRole === 'admin' && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Email</Label>
                        <Input
                          type="email"
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                          className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                        />
                      </div>
                    )}
                  </div>
                  <div className="mt-8 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setIsAdding(false)}
                      className="rounded-full text-gray-600"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={submitAdd}
                      disabled={isCreating}
                      className="rounded-full bg-[#00339B] px-6 text-white hover:bg-[#002d7a]"
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
