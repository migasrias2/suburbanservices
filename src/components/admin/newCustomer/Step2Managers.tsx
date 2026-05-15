import React, { useEffect, useMemo, useState } from 'react'
import { WizardShell } from './WizardShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Check, Copy, Plus, Search, UserPlus, X } from 'lucide-react'
import {
  assignManagerToCustomer,
  createManagerAccount,
  describeError,
  listManagers,
  type ManagerSummary,
} from '@/services/customerOnboardingService'
import type { WizardState } from './types'

interface Step2Props {
  state: WizardState
  totalSteps: number
  onUpdate: (patch: Partial<WizardState>) => void
  onBack: () => void
  onNext: () => void
}

type Role = 'manager' | 'ops_manager'

export const Step2Managers: React.FC<Step2Props> = ({ state, totalSteps, onUpdate, onBack, onNext }) => {
  const { toast } = useToast()
  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>(state.selectedManagerIds ?? [])
  const [isLoading, setIsLoading] = useState(true)
  const [isWorking, setIsWorking] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newRole, setNewRole] = useState<Role>('manager')
  const [newUsername, setNewUsername] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const refresh = async () => {
    try {
      setIsLoading(true)
      const data = await listManagers()
      setManagers(data)
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not load managers', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return managers
    return managers.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.mobile_number ?? ''} ${m.username ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [managers, search])

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleCreate = async () => {
    if (!newFirst.trim() || !newLast.trim()) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    if (newRole === 'manager' && !newPhone.trim()) {
      toast({ title: 'Phone required for manager', variant: 'destructive' })
      return
    }
    if (newRole === 'ops_manager' && !newUsername.trim()) {
      toast({ title: 'Username required for ops manager', variant: 'destructive' })
      return
    }
    setIsCreating(true)
    try {
      const created = await createManagerAccount({
        firstName: newFirst.trim(),
        lastName: newLast.trim(),
        phone: newPhone.trim() || undefined,
        username: newUsername.trim() || undefined,
        role: newRole,
      })
      onUpdate({ createdManagers: [...state.createdManagers, created] })
      setSelected((prev) => [...prev, created.managerId])
      setShowAddForm(false)
      setNewFirst('')
      setNewLast('')
      setNewPhone('')
      setNewUsername('')
      setNewRole('manager')
      await refresh()
      toast({ title: 'Manager created' })
    } catch (err) {
      console.error(err)
      toast({
        title: 'Could not create manager',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsCreating(false)
    }
  }

  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password)
      toast({ title: 'Password copied' })
    } catch {
      // noop
    }
  }

  const handleContinue = async () => {
    if (!state.customerId) {
      toast({ title: 'Missing client', variant: 'destructive' })
      return
    }
    setIsWorking(true)
    try {
      for (const managerId of selected) {
        await assignManagerToCustomer(managerId, state.customerId)
      }
      onUpdate({ selectedManagerIds: selected })
      onNext()
    } catch (err) {
      console.error(err)
      toast({
        title: 'Could not assign managers',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <WizardShell
      step={2}
      totalSteps={totalSteps}
      title="Who's managing this?"
      subtitle={`Assign managers to ${state.customerName ?? 'this client'}. You can add new managers too.`}
      onBack={onBack}
      onNext={handleContinue}
      isWorking={isWorking}
      nextLabel={selected.length === 0 ? 'Skip for now' : 'Continue'}
    >
      <div className="space-y-6">
        {state.createdManagers.length > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="mb-3 text-sm font-medium text-emerald-900">
              New manager credentials — copy these now, they won't be shown again.
            </p>
            <div className="space-y-2">
              {state.createdManagers.map((m) => (
                <div
                  key={m.managerId}
                  className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {m.firstName} {m.lastName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {m.role === 'ops_manager' ? 'Username' : 'Phone'}: {m.identifier} · Password: <span className="font-mono">{m.password}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyPassword(m.password)}
                    className="rounded-full text-gray-600 hover:bg-gray-100"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search managers"
            className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 pl-11 text-base text-gray-900 placeholder:text-gray-400"
          />
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto rounded-2xl border border-gray-100 p-2">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">No managers found</div>
          ) : (
            filtered.map((m) => {
              const isSelected = selected.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition ${
                    isSelected ? 'bg-[#00339B] text-white' : 'hover:bg-blue-50/40 text-gray-900'
                  }`}
                >
                  <div>
                    <div className="text-base font-medium">
                      {m.first_name} {m.last_name}
                    </div>
                    <div className={`text-xs ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                      {m.role === 'ops_manager' ? `Ops Manager · ${m.username ?? '—'}` : `Manager · ${m.mobile_number ?? '—'}`}
                    </div>
                  </div>
                  {isSelected && <Check className="h-5 w-5" />}
                </button>
              )
            })
          )}
        </div>

        {!showAddForm ? (
          <Button
            variant="outline"
            onClick={() => setShowAddForm(true)}
            className="w-full rounded-2xl border-dashed border-gray-300 bg-white py-6 text-gray-700 hover:bg-gray-50"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add new manager
          </Button>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">New manager</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddForm(false)}
                className="h-8 w-8 rounded-full p-0 text-gray-500"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-2">
              {(['manager', 'ops_manager'] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNewRole(r)}
                  className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
                    newRole === r ? 'bg-[#00339B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r === 'manager' ? 'Manager' : 'Ops Manager'}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={newFirst}
                onChange={(e) => setNewFirst(e.target.value)}
                placeholder="First name"
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
              <Input
                value={newLast}
                onChange={(e) => setNewLast(e.target.value)}
                placeholder="Last name"
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
            </div>

            {newRole === 'manager' ? (
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone number (e.g. 07123 456789)"
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
            ) : (
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username (e.g. j.smith)"
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
            )}

            <Button
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full rounded-full bg-[#00339B] py-5 text-white hover:bg-[#002d7a]"
            >
              <Plus className="mr-2 h-4 w-4" />
              {isCreating ? 'Creating…' : 'Create manager'}
            </Button>
            <p className="text-center text-xs text-gray-400">
              We'll auto-generate a password and show it once.
            </p>
          </div>
        )}
      </div>
    </WizardShell>
  )
}
