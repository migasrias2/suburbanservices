import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, addWeeks, endOfWeek, format, isSameDay, parseISO, startOfWeek } from 'date-fns'

import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChevronLeft, ChevronRight, Plus, Check, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { supabase } from '@/services/supabase'
import { fetchActiveSites } from '@/services/sitesService'
import {
  WeeklyScheduleGrid,
  type WeeklyScheduleBlock,
} from '@/components/schedule/WeeklyScheduleGrid'
import {
  deleteOpsVisit,
  fetchOpsVisits,
  logOpsVisit,
  scheduleOpsVisit,
  type OpsSiteVisit,
} from '@/services/opsVisitsService'
import { fetchShiftsInRange, type CleanerShift } from '@/services/shiftsService'

const getWeekRange = (anchor: Date) => {
  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  start.setHours(0, 0, 0, 0)
  const end = endOfWeek(anchor, { weekStartsOn: 1 })
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

const fieldClass =
  'h-11 rounded-xl border-0 bg-gray-100/80 px-3.5 text-[14px] text-gray-900 placeholder:text-gray-400 shadow-none focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#007AFF]/30'

const OpsCalendarPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [opsManagerId, setOpsManagerId] = useState<string>('')
  const [opsManagerName, setOpsManagerName] = useState<string>('')
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date())
  const [scopedCustomerIds, setScopedCustomerIds] = useState<string[] | null>(null)
  const [visits, setVisits] = useState<OpsSiteVisit[]>([])
  const [shifts, setShifts] = useState<CleanerShift[]>([])
  const [sites, setSites] = useState<Array<{ id?: string; customerName: string; address: string | null }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isVisitDialogOpen, setIsVisitDialogOpen] = useState(false)
  const [isSubmittingVisit, setIsSubmittingVisit] = useState(false)
  const [isUpdatingVisit, setIsUpdatingVisit] = useState<string | null>(null)
  const [visitForm, setVisitForm] = useState({
    customerValue: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  })

  useEffect(() => {
    const storedType = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = localStorage.getItem('userName')
    if (storedType !== 'ops_manager' || !storedId || !storedName) {
      navigate('/login')
      return
    }
    setOpsManagerId(storedId)
    setOpsManagerName(storedName)
  }, [navigate])

  useEffect(() => {
    if (!opsManagerId) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('manager_customers')
        .select('customer_id')
        .eq('manager_id', opsManagerId)
      if (cancelled) return
      if (error) {
        console.warn('Failed to load manager_customers scope', error)
        setScopedCustomerIds([])
        return
      }
      setScopedCustomerIds((data ?? []).map((r: any) => r.customer_id).filter(Boolean))
    })()
    return () => {
      cancelled = true
    }
  }, [opsManagerId])

  useEffect(() => {
    let cancelled = false
    fetchActiveSites()
      .then((data) => {
        if (!cancelled) setSites(data.map((s) => ({ id: s.id, customerName: s.customerName, address: s.address })))
      })
      .catch((err) => console.warn('Failed to load sites', err))
    return () => {
      cancelled = true
    }
  }, [])

  const { start: weekStart, end: weekEnd } = useMemo(() => getWeekRange(weekAnchor), [weekAnchor])

  const loadData = useCallback(async () => {
    if (!opsManagerId || scopedCustomerIds === null) return
    setIsLoading(true)
    try {
      const [visitRows, shiftRows] = await Promise.all([
        fetchOpsVisits(opsManagerId, { start: weekStart, end: addDays(weekEnd, 1) }),
        scopedCustomerIds.length > 0
          ? fetchShiftsInRange(weekStart, addDays(weekEnd, 1), { customerIds: scopedCustomerIds })
          : Promise.resolve([] as CleanerShift[]),
      ])
      setVisits(visitRows)
      setShifts(shiftRows)
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not load calendar', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [opsManagerId, scopedCustomerIds, weekStart, weekEnd, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const blocks = useMemo<WeeklyScheduleBlock[]>(
    () =>
      shifts.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        endAt: s.endAt,
        title: s.cleanerName ?? 'Cleaner',
        subtitle: s.siteName ?? s.customerName ?? null,
        tone: 'primary',
      })),
    [shifts],
  )

  const visitsByDay = useMemo(() => {
    const map = new Map<string, OpsSiteVisit[]>()
    visits.forEach((v) => {
      const key = format(parseISO(v.scheduledFor), 'yyyy-MM-dd')
      const list = map.get(key) ?? []
      list.push(v)
      map.set(key, list)
    })
    return map
  }, [visits])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const openCreateVisit = (day?: Date) => {
    setVisitForm({
      customerValue: '',
      date: format(day ?? new Date(), 'yyyy-MM-dd'),
      notes: '',
    })
    setIsVisitDialogOpen(true)
  }

  const handleSubmitVisit = async () => {
    if (!visitForm.customerValue) {
      toast({ title: 'Pick a site', variant: 'destructive' })
      return
    }
    setIsSubmittingVisit(true)
    try {
      const site = sites.find((s) => (s.id ?? s.customerName) === visitForm.customerValue)
      await scheduleOpsVisit(opsManagerId, {
        siteId: site?.id,
        siteName: site?.customerName ?? visitForm.customerValue,
        customerName: site?.customerName ?? null,
        scheduledFor: parseISO(visitForm.date),
        notes: visitForm.notes.trim() || undefined,
      })
      toast({ title: 'Visit scheduled' })
      setIsVisitDialogOpen(false)
      await loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not schedule visit', variant: 'destructive' })
    } finally {
      setIsSubmittingVisit(false)
    }
  }

  const handleMarkVisited = async (visit: OpsSiteVisit) => {
    setIsUpdatingVisit(visit.id)
    try {
      await logOpsVisit(visit.id)
      toast({ title: 'Marked as visited' })
      await loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not update visit', variant: 'destructive' })
    } finally {
      setIsUpdatingVisit(null)
    }
  }

  const handleDeleteVisit = async (visit: OpsSiteVisit) => {
    if (!window.confirm('Delete this visit?')) return
    setIsUpdatingVisit(visit.id)
    try {
      await deleteOpsVisit(visit.id)
      toast({ title: 'Visit deleted' })
      await loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not delete visit', variant: 'destructive' })
    } finally {
      setIsUpdatingVisit(null)
    }
  }

  if (!opsManagerName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-[#007AFF]" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="ops_manager" userName={opsManagerName}>
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">Calendar</p>
              <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">
                {format(weekStart, 'MMMM yyyy')}
              </h1>
              <p className="mt-0.5 text-[13px] text-gray-500">
                {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-white p-1 ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setWeekAnchor((prev) => addWeeks(prev, -1))}
                  aria-label="Previous week"
                  className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setWeekAnchor(new Date())}
                  className="h-8 rounded-full px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-100"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setWeekAnchor((prev) => addWeeks(prev, 1))}
                  aria-label="Next week"
                  className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                onClick={() => openCreateVisit()}
                className="h-10 rounded-full bg-[#007AFF] px-4 text-[13px] font-semibold text-white shadow-none hover:bg-[#0064D2]"
              >
                <Plus className="mr-1 h-4 w-4" />
                New visit
              </Button>
            </div>
          </div>

          <section className="rounded-3xl bg-white p-5 ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.08)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  Site visits
                </p>
                <h2 className="text-[16px] font-semibold tracking-tight text-gray-900">
                  This week
                </h2>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                {visits.length}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {weekDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const dayVisits = visitsByDay.get(key) ?? []
                const isToday = isSameDay(day, new Date())
                return (
                  <div
                    key={key}
                    className={cn(
                      'group relative flex min-h-[110px] flex-col gap-1.5 rounded-2xl p-2.5 transition-colors',
                      isToday ? 'bg-[#F5F9FF]' : 'bg-gray-50/60 hover:bg-gray-100/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openCreateVisit(day)}
                      className="flex items-center justify-between text-left"
                    >
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                          {format(day, 'EEE')}
                        </div>
                        <div
                          className={cn(
                            'text-[18px] font-semibold tracking-tight',
                            isToday ? 'text-[#007AFF]' : 'text-gray-900',
                          )}
                        >
                          {format(day, 'd')}
                        </div>
                      </div>
                      <Plus className="h-3.5 w-3.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>

                    <div className="flex flex-col gap-1">
                      {dayVisits.map((visit) => {
                        const visited = Boolean(visit.visitedAt)
                        return (
                          <div
                            key={visit.id}
                            className={cn(
                              'flex items-center justify-between gap-1 rounded-xl px-2 py-1.5 text-[11px] ring-1 ring-inset',
                              visited
                                ? 'bg-[#E6F7EE] text-[#0F5132] ring-[#CDEAD9]'
                                : 'bg-[#FFF5E0] text-[#7A4A00] ring-[#FFE4A8]',
                            )}
                          >
                            <span className="truncate font-medium">{visit.siteName}</span>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {!visited ? (
                                <button
                                  type="button"
                                  onClick={() => handleMarkVisited(visit)}
                                  disabled={isUpdatingVisit === visit.id}
                                  aria-label="Mark visited"
                                  className="rounded-full p-0.5 hover:bg-white/60"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleDeleteVisit(visit)}
                                disabled={isUpdatingVisit === visit.id}
                                aria-label="Delete visit"
                                className="rounded-full p-0.5 hover:bg-white/60"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  Cleaner shifts
                </p>
                <h2 className="text-[16px] font-semibold tracking-tight text-gray-900">
                  In your scope
                </h2>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                {shifts.length}
              </span>
            </div>

            {scopedCustomerIds && scopedCustomerIds.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center text-[13px] text-gray-400 ring-1 ring-black/[0.04]">
                No customers assigned to your scope yet.
              </div>
            ) : (
              <WeeklyScheduleGrid
                weekStart={weekStart}
                blocks={blocks}
                isLoading={isLoading}
              />
            )}
          </section>
        </div>
      </div>

      <Dialog open={isVisitDialogOpen} onOpenChange={setIsVisitDialogOpen}>
        <DialogContent className="max-w-[440px] rounded-3xl border-0 bg-white p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.25)]">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-[22px] font-semibold tracking-tight text-gray-900">
              New site visit
            </DialogTitle>
            <DialogDescription className="text-[13px] text-gray-500">
              Schedule a visit to a customer site.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
                Site
              </Label>
              <Select
                value={visitForm.customerValue}
                onValueChange={(v) => setVisitForm((p) => ({ ...p, customerValue: v }))}
              >
                <SelectTrigger className={fieldClass}>
                  <SelectValue placeholder="Pick a site" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-gray-100 bg-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                  {sites.map((s) => (
                    <SelectItem key={s.id ?? s.customerName} value={s.id ?? s.customerName}>
                      {s.customerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
                Date
              </Label>
              <Input
                type="date"
                value={visitForm.date}
                onChange={(e) => setVisitForm((p) => ({ ...p, date: e.target.value }))}
                className={fieldClass}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
                Notes
              </Label>
              <Textarea
                value={visitForm.notes}
                onChange={(e) => setVisitForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional"
                rows={3}
                className="resize-none rounded-xl border-0 bg-gray-100/80 px-3.5 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 shadow-none focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#007AFF]/30"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsVisitDialogOpen(false)}
              disabled={isSubmittingVisit}
              className="h-10 rounded-full px-4 text-[13px] font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmitVisit}
              disabled={isSubmittingVisit}
              className="h-10 rounded-full bg-[#007AFF] px-5 text-[13px] font-semibold text-white shadow-none hover:bg-[#0064D2]"
            >
              Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Sidebar07Layout>
  )
}

export default OpsCalendarPage
