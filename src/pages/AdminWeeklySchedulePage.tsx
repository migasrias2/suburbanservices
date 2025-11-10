import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endOfMonth, format, startOfMonth } from 'date-fns'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { FullScreenCalendar, type CalendarData, type CalendarEvent } from '@/components/ui/fullscreen-calendar'
import { Badge } from '@/components/ui/badge'
import { getStoredCleanerName } from '@/lib/identity'
import { fetchOpsManagerShiftsInRange, type OpsManagerShift } from '@/services/calendarService'

const getInitialRange = () => {
  const today = new Date()
  const start = startOfMonth(today)
  const end = endOfMonth(today)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

type OpsManagerCalendarEventMetadata = {
  opsManagerName: string
  siteName: string
  customerName?: string | null
  clockIn: string
  clockOut: string | null
}

const AdminWeeklySchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const [userName, setUserName] = useState<string>('')
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date }>(() => getInitialRange())
  const [calendarData, setCalendarData] = useState<CalendarData[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    const storedRole = localStorage.getItem('userType')
    const storedName = getStoredCleanerName()

    if (storedRole !== 'admin' || !storedName) {
      navigate('/login')
      return
    }

    setUserName(storedName)
  }, [navigate])

  const buildCalendarData = useCallback((shifts: OpsManagerShift[]): CalendarData[] => {
    const map = new Map<string, CalendarData>()

    const ensureEntry = (date: Date) => {
      const normalized = new Date(date)
      normalized.setHours(0, 0, 0, 0)
      const key = format(normalized, 'yyyy-MM-dd')
      const existing = map.get(key)
      if (existing) {
        return existing
      }
      const entry: CalendarData = { day: normalized, events: [], logs: [] }
      map.set(key, entry)
      return entry
    }

    shifts.forEach((shift) => {
      const clockInDate = new Date(shift.clockIn)
      if (Number.isNaN(clockInDate.getTime())) {
        return
      }

      const entry = ensureEntry(clockInDate)
      const clockOutDate = shift.clockOut ? new Date(shift.clockOut) : null
      const timeLabel = `${format(clockInDate, 'p')}${clockOutDate ? ` – ${format(clockOutDate, 'p')}` : ' (Active)'}`
      const labelParts = [shift.opsManagerName, shift.siteName].filter((part) => part && part.trim().length > 0)
      const nameLabel = labelParts.length ? labelParts.join(' • ') : shift.opsManagerName

      entry.events.push({
        id: shift.id,
        name: nameLabel,
        time: timeLabel,
        datetime: shift.clockIn,
        metadata: {
          opsManagerName: shift.opsManagerName,
          siteName: shift.siteName,
          customerName: shift.customerName ?? null,
          clockIn: shift.clockIn,
          clockOut: shift.clockOut,
        } satisfies OpsManagerCalendarEventMetadata,
      })
    })

    return Array.from(map.values()).sort((a, b) => a.day.getTime() - b.day.getTime())
  }, [])

  useEffect(() => {
    if (!userName) {
      return
    }

    let isSubscribed = true

    const loadCalendar = async () => {
      setIsLoading(true)
      try {
        const shifts = await fetchOpsManagerShiftsInRange(calendarRange.start, calendarRange.end)

        if (isSubscribed) {
          setCalendarData(buildCalendarData(shifts))
        }
      } catch (error) {
        if (isSubscribed) {
          console.error('Failed to load ops manager calendar data', error)
        }
      } finally {
        if (isSubscribed) {
          setIsLoading(false)
        }
      }
    }

    loadCalendar()

    return () => {
      isSubscribed = false
    }
  }, [buildCalendarData, calendarRange, userName])

  const handleMonthChange = useCallback((range: { start: Date; end: Date }) => {
    setCalendarRange((previous) => {
      const nextStart = new Date(range.start.getTime())
      const nextEnd = new Date(range.end.getTime())

      if (previous.start.getTime() === nextStart.getTime() && previous.end.getTime() === nextEnd.getTime()) {
        return previous
      }

      return { start: nextStart, end: nextEnd }
    })
  }, [])

  const renderDayDetails = useCallback(
    (day: Date, data: CalendarData | null) => {
      const events = (data?.events ?? []) as Array<CalendarEvent & { metadata?: OpsManagerCalendarEventMetadata }>
      const sortedEvents = [...events].sort((a, b) => {
        const aTime = new Date(a.datetime ?? '').getTime()
        const bTime = new Date(b.datetime ?? '').getTime()
        if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0
        if (!Number.isFinite(aTime)) return 1
        if (!Number.isFinite(bTime)) return -1
        return aTime - bTime
      })
      const hasEvents = sortedEvents.length > 0

      return (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#00339B]">{format(day, 'PPP')}</h3>
            <p className="text-xs font-medium uppercase tracking-wide text-[#00339B]/60">
              {hasEvents ? 'Ops manager attendance and visits' : 'No ops manager attendance'}
            </p>
          </div>

          {hasEvents ? (
            <div className="grid gap-3">
              {sortedEvents.map((event) => {
                const metadata = (event.metadata ?? null) as OpsManagerCalendarEventMetadata | null
                const managerName = metadata?.opsManagerName ?? event.name
                const siteName = metadata?.siteName ?? ''
                const customerName = metadata?.customerName ?? null
                const clockInTimestamp = metadata?.clockIn ?? event.datetime
                const clockOutTimestamp = metadata?.clockOut ?? null
                const clockInLabel = clockInTimestamp ? format(new Date(clockInTimestamp), 'p') : '—'
                const clockOutLabel = clockOutTimestamp ? format(new Date(clockOutTimestamp), 'p') : null
                const statusIsComplete = Boolean(clockOutTimestamp)
                const statusLabel = statusIsComplete ? 'Clocked out' : 'In progress'
                const badgeClass = statusIsComplete ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'

                return (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm shadow-blue-100/50 transition"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#00339B]">{managerName}</p>
                        {siteName ? <p className="text-xs text-[#00339B]/70">{siteName}</p> : null}
                        {customerName && customerName !== siteName ? (
                          <p className="text-xs text-[#00339B]/60">{customerName}</p>
                        ) : null}
                        {event.time ? (
                          <p className="text-[11px] font-medium uppercase tracking-wide text-[#00339B]/50">
                            {event.time}
                          </p>
                        ) : null}
                      </div>
                      <Badge className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>{statusLabel}</Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-[#00339B]/70">
                      <span>{clockInLabel}</span>
                      <span>–</span>
                      <span>{clockOutLabel ?? 'Active'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-6 text-center text-sm font-medium text-[#00339B]/70">
              {format(day, 'PPP')} has no recorded ops manager attendance.
            </div>
          )}
        </div>
      )
    },
    [],
  )

  const emptyStateMessage = useMemo(() => 'No ops manager attendance recorded for this day.', [])

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="admin" userName={userName}>
      <FullScreenCalendar
        data={calendarData}
        isLoading={isLoading}
        onMonthChange={handleMonthChange}
        emptyState={emptyStateMessage}
        renderDetails={renderDayDetails}
      />
    </Sidebar07Layout>
  )
}

export default AdminWeeklySchedulePage






