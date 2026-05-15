import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Trash2, Layers, ChevronLeft, Save, ChevronDown, X } from 'lucide-react'
import { getStoredCleanerName } from '@/lib/identity'
import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
  describeError,
  type AreaPreset,
} from '@/services/customerOnboardingService'
import type { AreaType } from '@/services/qrService'

const DEFAULT_AREA_TYPE: AreaType = 'GENERAL_AREAS'

type DraftItem = { name: string; type: AreaType; tasks: string[] }

type DraftPreset = {
  id?: string
  name: string
  items: DraftItem[]
}

const emptyDraft = (): DraftPreset => ({ name: '', items: [] })

const hydrateItem = (raw: { name: string; type: AreaType; tasks?: string[] }): DraftItem => ({
  name: raw.name,
  type: raw.type ?? DEFAULT_AREA_TYPE,
  tasks: Array.isArray(raw.tasks) ? [...raw.tasks] : [],
})

export default function PresetsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userName, setUserName] = useState('')
  const [presets, setPresets] = useState<AreaPreset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [draft, setDraft] = useState<DraftPreset | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [newRowName, setNewRowName] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [taskDrafts, setTaskDrafts] = useState<Record<number, string>>({})

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
      setPresets(await listPresets())
    } catch (err) {
      toast({ title: 'Could not load presets', description: describeError(err), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (userType === 'admin') refresh()
  }, [userType])

  const openNew = () => {
    setExpanded(null)
    setTaskDrafts({})
    setDraft(emptyDraft())
  }
  const openEdit = (p: AreaPreset) => {
    setExpanded(null)
    setTaskDrafts({})
    setDraft({ id: p.id, name: p.name, items: p.items.map(hydrateItem) })
  }
  const cancel = () => {
    setExpanded(null)
    setTaskDrafts({})
    setDraft(null)
  }

  const addRow = () => {
    if (!newRowName.trim() || !draft) return
    const newItem: DraftItem = {
      name: newRowName.trim(),
      type: DEFAULT_AREA_TYPE,
      tasks: [],
    }
    setDraft({ ...draft, items: [...draft.items, newItem] })
    setExpanded(draft.items.length) // auto-open the newly-added row
    setNewRowName('')
  }
  const removeRow = (idx: number) => {
    if (!draft) return
    setDraft({ ...draft, items: draft.items.filter((_, i) => i !== idx) })
    setExpanded((cur) => (cur === idx ? null : cur !== null && cur > idx ? cur - 1 : cur))
  }

  const addTaskToItem = (idx: number) => {
    if (!draft) return
    const val = (taskDrafts[idx] ?? '').trim()
    if (!val) return
    setDraft({
      ...draft,
      items: draft.items.map((it, i) =>
        i === idx ? { ...it, tasks: [...it.tasks, val] } : it,
      ),
    })
    setTaskDrafts((prev) => ({ ...prev, [idx]: '' }))
  }
  const removeTaskFromItem = (itemIdx: number, taskIdx: number) => {
    if (!draft) return
    setDraft({
      ...draft,
      items: draft.items.map((it, i) =>
        i === itemIdx ? { ...it, tasks: it.tasks.filter((_, ti) => ti !== taskIdx) } : it,
      ),
    })
  }

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    try {
      if (draft.id) {
        await updatePreset(draft.id, draft.name.trim(), draft.items)
      } else {
        await createPreset(draft.name.trim(), draft.items)
      }
      toast({ title: 'Preset saved' })
      setDraft(null)
      await refresh()
    } catch (err) {
      toast({ title: 'Could not save preset', description: describeError(err), variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (p: AreaPreset) => {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    try {
      await deletePreset(p.id)
      toast({ title: 'Preset deleted' })
      await refresh()
    } catch (err) {
      toast({ title: 'Could not delete', description: describeError(err), variant: 'destructive' })
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
      <div className="mx-auto w-full max-w-4xl py-4 sm:py-8">
        {!draft ? (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">Area presets</h1>
                <p className="mt-2 text-gray-500">Reusable area lists for new customer onboarding.</p>
              </div>
              <Button onClick={openNew} className="rounded-full bg-[#00339B] px-6 py-5 text-white hover:bg-[#002d7a]">
                <Plus className="mr-2 h-4 w-4" />
                New preset
              </Button>
            </div>

            {isLoading ? (
              <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
            ) : presets.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-20 text-center">
                <Layers className="mx-auto mb-3 h-8 w-8 text-gray-300" />
                <p className="text-gray-500">No presets yet. Create one to speed up new customer setup.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openEdit(p)}
                    className="group rounded-2xl border border-gray-200 bg-white p-6 text-left transition hover:border-[#00339B]"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
                      <span className="text-xs text-gray-400">{p.items.length} area{p.items.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="space-y-1">
                      {p.items.slice(0, 5).map((it, i) => (
                        <div key={i} className="text-sm text-gray-500 truncate">
                          {it.name}
                          {it.tasks && it.tasks.length > 0 && (
                            <>
                              {' '}<span className="text-gray-300">·</span>{' '}
                              {it.tasks.length} task{it.tasks.length === 1 ? '' : 's'}
                            </>
                          )}
                        </div>
                      ))}
                      {p.items.length > 5 && (
                        <div className="text-xs text-gray-400">+ {p.items.length - 5} more</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-3xl bg-white p-8 shadow-sm sm:p-10">
            <div className="mb-6 flex items-center justify-between">
              <Button variant="ghost" onClick={cancel} className="rounded-full text-gray-500">
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              {draft.id && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const found = presets.find((p) => p.id === draft.id)
                    if (found) remove(found)
                  }}
                  className="rounded-full text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>

            <div className="mb-6 space-y-2">
              <Label className="text-sm font-medium text-gray-700">Preset name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Office building"
                autoFocus
                className="h-14 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-lg"
              />
            </div>

            <div className="mb-6 space-y-2">
              {draft.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
                  No areas yet.
                </div>
              ) : (
                draft.items.map((it, idx) => {
                  const isOpen = expanded === idx
                  return (
                    <div key={idx} className="overflow-hidden rounded-xl bg-gray-50">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : idx)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-medium text-gray-900">{it.name}</div>
                            <div className="text-xs text-gray-500">
                              {it.tasks.length} task{it.tasks.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeRow(idx)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              removeRow(idx)
                            }
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-white hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="border-t border-gray-200 bg-white p-4 space-y-4">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                              Tasks
                            </Label>
                            <div className="space-y-1.5">
                              {it.tasks.length === 0 ? (
                                <div className="rounded-lg bg-gray-50 py-4 text-center text-xs text-gray-400">
                                  No tasks yet.
                                </div>
                              ) : (
                                it.tasks.map((task, ti) => (
                                  <div
                                    key={ti}
                                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800"
                                  >
                                    <span className="min-w-0 flex-1 truncate">{task}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeTaskFromItem(idx, ti)}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-red-600"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="flex gap-2 pt-1">
                              <Input
                                value={taskDrafts[idx] ?? ''}
                                onChange={(e) =>
                                  setTaskDrafts((prev) => ({ ...prev, [idx]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    addTaskToItem(idx)
                                  }
                                }}
                                placeholder="Add a task"
                                className="h-10 flex-1 rounded-xl border-gray-200 bg-gray-50/70 px-3 text-sm"
                              />
                              <Button
                                onClick={() => addTaskToItem(idx)}
                                disabled={!(taskDrafts[idx] ?? '').trim()}
                                className="h-10 rounded-xl bg-[#00339B] px-4 text-sm text-white hover:bg-[#002d7a] disabled:bg-gray-200 disabled:text-gray-400"
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
              <Input
                value={newRowName}
                onChange={(e) => setNewRowName(e.target.value)}
                placeholder="Area name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addRow()
                  }
                }}
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
              <Button onClick={addRow} disabled={!newRowName.trim()} className="w-full rounded-full bg-[#00339B] py-5 text-white hover:bg-[#002d7a] disabled:bg-gray-200 disabled:text-gray-400">
                <Plus className="mr-2 h-4 w-4" />
                Add area
              </Button>
            </div>

            <div className="mt-8 flex justify-end">
              <Button onClick={save} disabled={isSaving} className="rounded-full bg-[#00339B] px-7 py-5 text-white hover:bg-[#002d7a]">
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Saving…' : 'Save preset'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sidebar07Layout>
  )
}
