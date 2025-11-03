import React, { useEffect, useMemo, useState } from 'react'
import { addDays, differenceInCalendarDays, differenceInMinutes, format, startOfDay } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { WeeklyVisit } from '@/services/scheduleService'

const HOUR_HEIGHT = 64
const MIN_EVENT_HEIGHT = 72
const MINUTES_PER_STEP = 15
const PIXELS_PER_MINUTE = HOUR_HEIGHT / 60
const DEFAULT_DAY_START_HOUR = 6
const DEFAULT_DAY_END_HOUR = 22
const DAY_COUNT = 7

const COLOR_PALETTE = ['#8B5CF6', '#0F60FF', '#6366F1', '#2563EB', '#EA580C', '#F97316', '#10B981', '#0EA5E9', '#14B8A6']
const cleanerColorCache = new Map<string, string>()

const getColorForCleaner = (cleanerName: string) => {
  const key = cleanerName.toLowerCase().trim() || 'unknown'
  if (cleanerColorCache.has(key)) {
    return cleanerColorCache.get(key) as string
  }

  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }

  const index = Math.abs(hash) % COLOR_PALETTE.length
  const color = COLOR_PALETTE[index]
  cleanerColorCache.set(key, color)
  return color
}

type WeeklyCalendarProps = {
  visits: WeeklyVisit[]
  weekStart: Date
  headerAction?: React.ReactNode
  isLoading?: boolean
}

type CalendarCellVisit = WeeklyVisit & {
  start: Date
  end: Date
  durationMinutes: number
  isCompleted: boolean
  dayIndex: number
  color: string
}

const isValidDate = (value: Date) => !Number.isNaN(value.getTime())

const enhanceVisits = (visits: WeeklyVisit[], weekStart: Date, now: Date): CalendarCellVisit[] => {
  return visits
    .map((visit) => {
      const start = new Date(visit.clockIn)
      if (!isValidDate(start)) {
        return null
      }

      const rawEnd = visit.clockOut ? new Date(visit.clockOut) : now
      const end = !isValidDate(rawEnd) || rawEnd < start ? start : rawEnd

      const durationMinutes = Math.max(MINUTES_PER_STEP, differenceInMinutes(end, start) || MINUTES_PER_STEP)
      const dayIndex = differenceInCalendarDays(startOfDay(start), weekStart)

      if (dayIndex < 0 || dayIndex >= DAY_COUNT) {
        return null
      }

      return {
        ...visit,
        start,
        end,
        durationMinutes,
        isCompleted: Boolean(visit.clockOut),
        dayIndex,
        color: getColorForCleaner(visit.cleanerName),
      }
    })
    .filter((value): value is CalendarCellVisit => Boolean(value))
}

const formatDuration = (minutes: number) => {
  const rounded = Math.max(MINUTES_PER_STEP, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const remaining = rounded % 60

  if (hours <= 0) {
    return `${rounded} min`
  }

  if (remaining === 0) {
    return `${hours} hr${hours > 1 ? 's' : ''}`
  }

  return `${hours} hr${hours > 1 ? 's' : ''} ${remaining} min`
}

export const WeeklyCalendarView: React.FC<WeeklyCalendarProps> = ({ visits, weekStart, headerAction, isLoading }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())

  const isLoadingData = Boolean(isLoading)

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const normalizedWeekStart = useMemo(() => {
    const copy = new Date(weekStart)
    copy.setHours(0, 0, 0, 0)
    return copy
  }, [weekStart])

  const events = useMemo(() => enhanceVisits(visits, normalizedWeekStart, now), [visits, normalizedWeekStart, now])

  const selectedVisit = useMemo(
    () => (selectedId ? events.find((event) => event.id === selectedId) ?? null : null),
    [events, selectedId],
  )

  useEffect(() => {
    if (!selectedVisit && selectedId) {
      const stillExists = events.some((event) => event.id === selectedId)
      if (!stillExists) {
        setSelectedId(null)
      }
    }
  }, [events, selectedId, selectedVisit])

  const dayDates = useMemo(
    () => Array.from({ length: DAY_COUNT }, (_, index) => addDays(normalizedWeekStart, index)),
    [normalizedWeekStart],
  )

  const weekRangeLabel = useMemo(() => {
    if (!dayDates.length) {
      return ''
    }
    const startLabel = format(dayDates[0], 'MMM d')
    const endLabel = format(dayDates[DAY_COUNT - 1], 'MMM d, yyyy')
    return `${startLabel} – ${endLabel}`
  }, [dayDates])

  const { dayStartHour, dayEndHour } = useMemo(() => {
    if (!events.length) {
      return { dayStartHour: DEFAULT_DAY_START_HOUR, dayEndHour: DEFAULT_DAY_END_HOUR }
    }

    let minHour = DEFAULT_DAY_START_HOUR
    let maxHour = DEFAULT_DAY_END_HOUR

    events.forEach((event) => {
      const startHourValue = event.start.getHours() + event.start.getMinutes() / 60
      const endHourValue = event.end.getHours() + event.end.getMinutes() / 60
      minHour = Math.min(minHour, Math.floor(startHourValue))
      maxHour = Math.max(maxHour, Math.ceil(endHourValue))
    })

    minHour = Math.max(0, minHour)
    maxHour = Math.min(24, Math.max(minHour + 1, maxHour))

    return { dayStartHour: minHour, dayEndHour: maxHour }
  }, [events])

  const hours = useMemo(
    () => Array.from({ length: dayEndHour - dayStartHour + 1 }, (_, index) => dayStartHour + index),
    [dayEndHour, dayStartHour],
  )

  const calendarStartMinutes = dayStartHour * 60
  const calendarEndMinutes = dayEndHour * 60

  const visitsByDay = useMemo(() => {
    const buckets: Record<number, CalendarCellVisit[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    events.forEach((event) => {
      if (event.dayIndex >= 0 && event.dayIndex < DAY_COUNT) {
        buckets[event.dayIndex].push(event)
      }
    })

    Object.values(buckets).forEach((bucket) => {
      bucket.sort((a, b) => a.start.getTime() - b.start.getTime())
    })

    return buckets
  }, [events])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-[#00339B]">Weekly Schedule</h2>
          <p className="text-sm text-gray-500">Cleaner attendance for {weekRangeLabel}</p>
        </div>
        {headerAction ? <div className="flex items-center gap-3">{headerAction}</div> : null}
      </div>

      <Card className="relative overflow-hidden rounded-3xl border-blue-100 bg-white shadow-lg shadow-blue-100/60">
        <div className="grid grid-cols-8 border-b border-blue-50 text-sm font-medium text-[#00339B]">
          <div className="border-r border-blue-50 px-4 py-3">Time</div>
          {dayDates.map((date) => (
            <div key={date.toISOString()} className="border-r border-blue-50 px-4 py-3 text-center">
              <div className="text-sm font-semibold">{format(date, 'EEEE')}</div>
              <div className="text-xs font-medium text-gray-400">{format(date, 'MMM d')}</div>
            </div>
          ))}
        </div>

        <div className="relative">
          <div className="grid grid-cols-8 divide-x divide-blue-50 text-sm">
            <div className="relative">
              {hours.map((hour) => {
                const timeLabel = new Date()
                timeLabel.setHours(hour, 0, 0, 0)
                return (
                  <div key={hour} className="border-b border-blue-50 px-4" style={{ height: HOUR_HEIGHT }}>
                    <span className="text-xs text-gray-500">{format(timeLabel, 'h a')}</span>
                  </div>
                )
              })}
            </div>

            {dayDates.map((date, dayIndex) => (
              <div key={date.toISOString()} className="relative h-full">
                {hours.map((hour) => (
                  <div key={`${dayIndex}-${hour}`} className="border-b border-blue-50" style={{ height: HOUR_HEIGHT }} />
                ))}

                <div className="absolute inset-0 pb-4">
                  {visitsByDay[dayIndex]?.map((visit) => {
                    const startMinutes = visit.start.getHours() * 60 + visit.start.getMinutes()
                    const endMinutes = startMinutes + visit.durationMinutes

                    const visibleStart = Math.max(calendarStartMinutes, startMinutes)
                    const visibleEnd = Math.min(calendarEndMinutes, endMinutes)

                    if (visibleEnd <= visibleStart) {
                      return null
                    }

                    const topOffset = (visibleStart - calendarStartMinutes) * PIXELS_PER_MINUTE
                    const heightMinutes = Math.max(MINUTES_PER_STEP, visibleEnd - visibleStart)
                    const height = Math.max(MIN_EVENT_HEIGHT, heightMinutes * PIXELS_PER_MINUTE)

                    return (
                      <button
                        key={visit.id}
                        type="button"
                        onClick={() => setSelectedId(visit.id)}
                        className={cn(
                          'absolute left-3 right-3 flex flex-col gap-2 rounded-3xl border border-white/30 px-4 py-3 text-left shadow-xl transition duration-150 focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-blue-200',
                          'backdrop-blur-sm text-white hover:-translate-y-1 hover:shadow-2xl'
                        )}
                        style={{
                          top: `${topOffset}px`,
                          height: `${height}px`,
                          background: `linear-gradient(135deg, ${visit.color} 0%, rgba(255,255,255,0.25) 100%)`,
                        }}
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-white/80">
                          <span>{format(visit.start, 'h:mm a')}</span>
                          <span>{visit.isCompleted ? format(visit.end, 'h:mm a') : 'Now'}</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold leading-tight text-white drop-shadow-md">{visit.siteName}</p>
                          <p className="text-xs text-white/80">{visit.cleanerName}</p>
                        </div>
                        <Badge
                          className={cn(
                            'w-fit rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition',
                            visit.isCompleted ? 'bg-white/95 text-emerald-600' : 'bg-white/80 text-amber-600 hover:bg-white'
                          )}
                        >
                          {visit.isCompleted ? 'Clocked out' : 'In progress'}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {isLoadingData ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="mt-3 text-sm font-medium text-[#00339B]">Loading attendance...</p>
          </div>
        ) : null}
      </Card>

      <Dialog
        open={Boolean(selectedVisit) && !isLoadingData}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedId(null)
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl">
          {selectedVisit && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl font-semibold text-[#00339B]">{selectedVisit.siteName}</DialogTitle>
                <DialogDescription>
                  {format(selectedVisit.start, 'EEEE • MMM d, yyyy')} · {format(selectedVisit.start, 'h:mm a')} –{' '}
                  {selectedVisit.isCompleted ? format(selectedVisit.end, 'h:mm a') : 'Now'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-3 rounded-2xl bg-blue-50/70 p-4">
                  <div className="text-sm text-blue-900">
                    <span className="font-semibold">Cleaner:</span> {selectedVisit.cleanerName}
                  </div>
                  <div className="text-sm text-blue-900">
                    <span className="font-semibold">Duration:</span> {formatDuration(selectedVisit.durationMinutes)}
                  </div>
                  <div className="text-sm text-blue-900">
                    <span className="font-semibold">Status:</span>{' '}
                    <Badge
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
                        selectedVisit.isCompleted ? 'bg-emerald-600 text-white' : 'bg-amber-500/20 text-amber-700'
                      )}
                    >
                      {selectedVisit.isCompleted ? 'Clocked out' : 'Still clocked in'}
                    </Badge>
                  </div>
                </div>

                <ScrollArea className="max-h-48 rounded-2xl border border-blue-100">
                  <div className="space-y-3 p-4 text-sm text-gray-600">
                    <p>
                      {selectedVisit.clockIn
                        ? `Clock-in recorded at ${format(new Date(selectedVisit.clockIn), 'PPpp')}`
                        : 'Clock-in time missing.'}
                    </p>
                    <p>
                      {selectedVisit.clockOut
                        ? `Clock-out recorded at ${format(new Date(selectedVisit.clockOut), 'PPpp')}`
                        : 'Cleaner has not clocked out yet. Their card will continue to extend until they clock out.'}
                    </p>
                  </div>
                </ScrollArea>

                <div className="flex justify-end">
                  <Button onClick={() => setSelectedId(null)} className="rounded-full">
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WeeklyCalendarView
