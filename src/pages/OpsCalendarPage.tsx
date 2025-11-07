import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'

import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { FullScreenCalendar, type CalendarData, type CalendarEvent } from '@/components/ui/fullscreen-calendar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { fetchActiveSites } from '@/services/sitesService'
import {
  deleteOpsVisit,
  fetchOpsVisits,
  logOpsVisit,
  scheduleOpsVisit,
  type OpsSiteVisit,
} from '@/services/opsVisitsService'
import { cn } from '@/lib/utils'

interface CalendarVisitEvent extends CalendarEvent {
  metadata?: {
    visit: OpsSiteVisit
  }
}

const getInitialRange = () => {
  const today = new Date()
  const start = startOfMonth(today)
  const end = endOfMonth(today)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

const OpsCalendarPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [opsManagerId, setOpsManagerId] = useState<string>('')
  const [opsManagerName, setOpsManagerName] = useState<string>('')
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date }>(() => getInitialRange())
  const [visits, setVisits] = useState<OpsSiteVisit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedDay, setSelectedDay] = useState<Date>(new Date())
  const [sites, setSites] = useState<Array<{ id?: string; customerName: string; address: string | null }>>([])
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({ customerValue: '', date: format(new Date(), 'yyyy-MM-dd'), notes: '' })
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false)
  const [isUpdatingVisit, setIsUpdatingVisit] = useState<string | null>(null)

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

  const loadSites = useCallback(async () => {
    try {
    const data = await fetchActiveSites()
    setSites(
      data.map((site) => ({
        id: site.id,
        customerName: site.customerName,
        address: site.address,
      })),
    )
    } catch (error) {
      console.error('Failed to load sites for ops calendar', error)
      toast({
        variant: 'destructive',
        title: 'Unable to load sites',
        description: 'Please refresh the page or try again later.',
      })
    }
  }, [toast])

  useEffect(() => {
    loadSites()
  }, [loadSites])

  const refreshVisits = useCallback(async () => {
    if (!opsManagerId) return
    setIsLoading(true)
    try {
      const data = await fetchOpsVisits(opsManagerId, calendarRange)
      setVisits(data)
    } catch (error) {
      console.error('Failed to load ops visits', error)
      toast({
        variant: 'destructive',
        title: 'Unable to load visits',
        description: 'Please refresh the page.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [calendarRange, opsManagerId, toast])

  useEffect(() => {
    refreshVisits()
  }, [refreshVisits])

  const customerOptions = useMemo(() => {
    const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const map = new Map<string, { value: string; customerName: string; siteId: string | undefined; address: string | null }>()
    const isLikelyCustomer = (name: string) => !!name

    sites.forEach((site) => {
      const customer = site.customerName?.trim()
      if (!customer || !isLikelyCustomer(customer)) {
        return
      }
      if (!map.has(customer)) {
        const value = site.id ? `db::${site.id}` : `virtual::${slugify(customer)}`
        map.set(customer, {
          value,
          customerName: customer,
          siteId: site.id,
          address: site.address ?? null,
        })
      }
    })

    return Array.from(map.entries())
      .map(([customer, option]) => ({
        label: customer,
        value: option.value,
        siteId: option.siteId,
        customerName: option.customerName,
        address: option.address,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [sites])

  const customerOptionsMap = useMemo(() => {
    const map = new Map<string, { siteId: string | undefined; customerName: string; address: string | null }>()
    customerOptions.forEach((option) => {
      map.set(option.value, {
        siteId: option.siteId,
        customerName: option.customerName,
        address: option.address,
      })
    })
    return map
  }, [customerOptions])

  const groupedVisits = useMemo(() => {
    const map = new Map<string, OpsSiteVisit[]>()
    visits.forEach((visit) => {
      const key = format(parseISO(visit.scheduledFor), 'yyyy-MM-dd')
      const existing = map.get(key) ?? []
      existing.push(visit)
      map.set(key, existing)
    })
    return map
  }, [visits])

  const calendarData: CalendarData[] = useMemo(() => {
    const entries: CalendarData[] = []
    groupedVisits.forEach((dayVisits, key) => {
      const date = parseISO(`${key}T00:00:00`)
      const events: CalendarEvent[] = dayVisits.map((visit) => {
        const visitedLabel = visit.visitedAt
          ? `Visited at ${format(new Date(visit.visitedAt), 'p')}`
          : 'Scheduled visit'
        return {
          id: visit.id,
          name: visit.customerName ?? 'Client visit',
          time: visitedLabel,
          datetime: `${key}T00:00:00`,
          metadata: { visit },
        } as CalendarVisitEvent
      })

      entries.push({ day: date, events })
    })
    return entries
  }, [groupedVisits])

  const handleMonthChange = useCallback((range: { start: Date; end: Date }) => {
    setCalendarRange((previous) => {
      const sameStart = previous.start.getTime() === range.start.getTime()
      const sameEnd = previous.end.getTime() === range.end.getTime()
      if (sameStart && sameEnd) {
        return previous
      }

      const nextStart = new Date(range.start)
      const nextEnd = new Date(range.end)
      nextStart.setHours(0, 0, 0, 0)
      nextEnd.setHours(23, 59, 59, 999)
      return { start: nextStart, end: nextEnd }
    })
  }, [])

  const handleDaySelect = useCallback((day: Date) => {
    setSelectedDay(day)
    setScheduleForm((prev) => ({ ...prev, date: format(day, 'yyyy-MM-dd') }))
  }, [])

  const scheduleVisit = async () => {
    if (!scheduleForm.customerValue || !scheduleForm.date || !opsManagerId) return

    const selectedCustomer = customerOptionsMap.get(scheduleForm.customerValue)
    if (!selectedCustomer) {
      toast({
        variant: 'destructive',
        title: 'Select a client',
        description: 'Choose which client you plan to visit.',
      })
      return
    }

    setIsSubmittingSchedule(true)
    try {
      const scheduledFor = parseISO(`${scheduleForm.date}T00:00:00`)
      await scheduleOpsVisit(opsManagerId, {
        siteId: selectedCustomer.siteId ?? null,
        siteName: selectedCustomer.customerName,
        customerName: selectedCustomer.customerName,
        scheduledFor,
        notes: scheduleForm.notes,
      })
      toast({
        title: 'Visit scheduled',
        description: 'The visit has been added to your calendar.',
      })
      setIsScheduleDialogOpen(false)
      setScheduleForm((prev) => ({ ...prev, customerValue: '', notes: '' }))
      refreshVisits()
    } catch (error) {
      console.error('Failed to schedule visit', error)
      toast({
        variant: 'destructive',
        title: 'Could not schedule visit',
        description: 'Please try again later.',
      })
    } finally {
      setIsSubmittingSchedule(false)
    }
  }

  const handleLogVisit = async (visitId: string) => {
    setIsUpdatingVisit(visitId)
    try {
      await logOpsVisit(visitId)
      toast({ title: 'Visit logged', description: 'Marked as visited.' })
      setVisits((prev) =>
        prev.map((visit) => (visit.id === visitId ? { ...visit, visitedAt: new Date().toISOString() } : visit)),
      )
    } catch (error) {
      console.error('Failed to log visit', error)
      toast({
        variant: 'destructive',
        title: 'Unable to log visit',
        description: 'Please try again later.',
      })
    } finally {
      setIsUpdatingVisit(null)
    }
  }

  const handleDeleteVisit = async (visitId: string) => {
    setIsUpdatingVisit(visitId)
    try {
      await deleteOpsVisit(visitId)
      toast({ title: 'Visit removed' })
      setVisits((prev) => prev.filter((visit) => visit.id !== visitId))
    } catch (error) {
      console.error('Failed to delete visit', error)
      toast({
        variant: 'destructive',
        title: 'Unable to remove visit',
        description: 'Please try again later.',
      })
    } finally {
      setIsUpdatingVisit(null)
    }
  }

  const renderDetails = useCallback(
    (day: Date, data: CalendarData | null) => {
      const dayVisits = data?.events ?? []
      const displayVisits = dayVisits as CalendarVisitEvent[]
      const hasVisits = displayVisits.length > 0

      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#00339B]">{format(day, 'PPP')}</h3>
              <p className="text-xs font-medium uppercase tracking-wide text-[#00339B]/60">
                {hasVisits ? 'Scheduled client visits' : 'No visits scheduled'}
              </p>
            </div>
            <Button onClick={() => setIsScheduleDialogOpen(true)} className="rounded-full bg-[#00339B] px-5 py-2 text-white shadow" size="sm">
              Schedule visit
            </Button>
          </div>

          {hasVisits ? (
            <div className="grid gap-3">
              {displayVisits.map((event) => {
                const visit = event.metadata?.visit as OpsSiteVisit
                const isVisited = Boolean(visit?.visitedAt)
                const customerLabel = visit?.customerName ?? 'Client'
                return (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm shadow-blue-100/50 transition hover:border-blue-200"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00339B]/60">{customerLabel}</p>
                        <p className="text-xs text-[#00339B]/70">
                          {isVisited
                            ? `Visited at ${visit?.visitedAt ? format(new Date(visit.visitedAt), 'p') : '--'}`
                            : 'Visit pending'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={cn('rounded-full text-xs', isVisited ? 'bg-emerald-500 text-white' : 'bg-yellow-500 text-white')}>
                          {isVisited ? 'Visited' : 'Scheduled'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteVisit(visit.id)}
                          disabled={isUpdatingVisit === visit.id}
                          className="rounded-full border border-red-200 text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </Button>
                        {!isVisited ? (
                          <Button
                            size="sm"
                            onClick={() => handleLogVisit(visit.id)}
                            disabled={isUpdatingVisit === visit.id}
                            className="rounded-full bg-[#00339B] text-white shadow"
                          >
                            {isUpdatingVisit === visit.id ? 'Saving…' : 'Mark visited'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {visit?.notes ? (
                      <p className="mt-2 text-xs text-[#00339B]/70">Notes: {visit.notes}</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-6 text-center text-sm font-medium text-[#00339B]/70">
              {format(day, 'PPP')} has no scheduled client visits.
            </div>
          )}
        </div>
      )
    },
    [handleDeleteVisit, handleLogVisit, isUpdatingVisit],
  )

  if (!opsManagerId || !opsManagerName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="ops_manager" userName={opsManagerName}>
      <FullScreenCalendar
        data={calendarData}
        isLoading={isLoading}
        onMonthChange={handleMonthChange}
        headerActionSlot={
          <Button onClick={() => setIsScheduleDialogOpen(true)} className="rounded-full bg-[#00339B] px-5 py-2 text-white shadow" size="sm">
            Schedule visit
          </Button>
        }
        onDaySelect={handleDaySelect}
        renderDetails={renderDetails}
        emptyState="No visits for this day."
      />

      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Schedule client visit</DialogTitle>
            <DialogDescription>Select the client and date you plan to inspect.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Select
                value={scheduleForm.customerValue}
                onValueChange={(value) => setScheduleForm((prev) => ({ ...prev, customerValue: value }))}
              >
                <SelectTrigger id="client" className="rounded-xl border-blue-200">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent className="max-h-80 rounded-2xl border-blue-100 bg-white shadow-lg">
                  {customerOptions.length ? (
                    customerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="rounded-xl">
                        <div className="flex flex-col text-left">
                          <span className="font-semibold text-[#00339B]">{option.label}</span>
                          {option.address ? (
                            <span className="text-xs text-[#00339B]/70">{option.address}</span>
                          ) : null}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-3 text-sm text-[#00339B]/70">No active clients available</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={scheduleForm.date}
                min={format(addDays(new Date(), -60), 'yyyy-MM-dd')}
                max={format(addDays(new Date(), 365), 'yyyy-MM-dd')}
                onChange={(event) => setScheduleForm((prev) => ({ ...prev, date: event.target.value }))}
                className="rounded-xl border-blue-200"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={scheduleForm.notes}
                onChange={(event) => setScheduleForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Add reminder or context for this visit"
                className="min-h-[96px] rounded-2xl border-blue-200"
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              className="rounded-full border-blue-200 text-[#00339B] hover:bg-blue-50"
              onClick={() => setIsScheduleDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={scheduleVisit}
              disabled={isSubmittingSchedule || !scheduleForm.customerValue}
              className="rounded-full bg-[#00339B] px-6 text-white shadow"
            >
              {isSubmittingSchedule ? 'Scheduling…' : 'Save visit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar07Layout>
  )
}

export default OpsCalendarPage


