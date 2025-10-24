import React, { useEffect, useMemo, useState } from 'react'
import { format, addDays, differenceInMinutes, setHours, setMinutes, startOfWeek } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { WeeklyVisit } from '@/services/scheduleService'

const DAY_START_HOUR = 6
const DAY_END_HOUR = 22
const MINUTES_PER_STEP = 15
const HOUR_HEIGHT = 64
const MIN_EVENT_HEIGHT = 72
const PIXELS_PER_MINUTE = HOUR_HEIGHT / 60

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, index) => DAY_START_HOUR + index)

const mapDayToColumn = (dayOfWeek: number): number => (dayOfWeek + 6) % 7

const toDateFromTime = (dayIndex: number, time: string) => {
  const base = startOfWeek(new Date(), { weekStartsOn: 1 })
  const [hours, minutes] = time.split(':').map((value) => Number.parseInt(value, 10))
  const dayOffset = mapDayToColumn(dayIndex)
  return setMinutes(setHours(addDays(base, dayOffset), hours), minutes)
}

type WeeklyCalendarProps = {
  visits: WeeklyVisit[]
}

type CalendarCellVisit = WeeklyVisit & {
  start: Date
  end: Date
  durationMinutes: number
  isCompleted: boolean
}

const enhanceVisits = (visits: WeeklyVisit[]): CalendarCellVisit[] => {
  return visits.map((visit) => {
    const start = toDateFromTime(visit.dayOfWeek, visit.startTime)
    const end = toDateFromTime(visit.dayOfWeek, visit.endTime)
    const durationMinutes = Math.max(MINUTES_PER_STEP, differenceInMinutes(end, start))
    const isCompleted = Boolean(visit.clockIn && visit.clockOut)
    return {
      ...visit,
      start,
      end,
      durationMinutes,
      isCompleted,
    }
  })
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const hexToRgba = (hex?: string, alpha = 0.65) => {
  if (!hex) return `rgba(0, 51, 155, ${alpha})`
  let sanitized = hex.trim().replace('#', '')
  if (sanitized.length === 3) {
    sanitized = sanitized
      .split('')
      .map((char) => char + char)
      .join('')
  }
  const parsed = Number.parseInt(sanitized, 16)
  if (Number.isNaN(parsed)) {
    return `rgba(0, 51, 155, ${alpha})`
  }
  const r = (parsed >> 16) & 255
  const g = (parsed >> 8) & 255
  const b = parsed & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const createGradient = (color?: string) => {
  const primary = color || '#00339B'
  const secondary = hexToRgba(color, 0.75)
  return `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`
}

export const WeeklyCalendarView: React.FC<WeeklyCalendarProps> = ({ visits }) => {
  const [events, setEvents] = useState<CalendarCellVisit[]>(() => enhanceVisits(visits))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeInteraction, setActiveInteraction] = useState<{ id: string; mode: 'move' | 'resize' } | null>(null)

  useEffect(() => {
    setEvents(enhanceVisits(visits))
  }, [visits])

  const selectedVisit = useMemo(
    () => (selectedId ? events.find((event) => event.id === selectedId) ?? null : null),
    [events, selectedId],
  )

  useEffect(() => {
    if (selectedVisit) {
      // ensure dialog reflects updated event when times change
      setSelectedId(selectedVisit.id)
    }
  }, [selectedVisit?.start?.getTime(), selectedVisit?.end?.getTime()])

  const visitsByDay = useMemo(() => {
    const entries: Record<number, CalendarCellVisit[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    events.forEach((visit) => {
      const column = mapDayToColumn(visit.dayOfWeek)
      if (!entries[column]) {
        entries[column] = []
      }
      entries[column].push(visit)
    })
    Object.values(entries).forEach((dayEvents) => {
      dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime())
    })
    return entries
  }, [events])

  const beginInteraction = (
    visitId: string,
    mode: 'move' | 'resize',
    pointerEvent: React.PointerEvent<HTMLElement>,
  ) => {
    pointerEvent.preventDefault()
    pointerEvent.stopPropagation()

    const initialEvent = events.find((event) => event.id === visitId)
    if (!initialEvent) return

    setActiveInteraction({ id: visitId, mode })

    const startMinutes = initialEvent.start.getHours() * 60 + initialEvent.start.getMinutes()
    const endMinutes = initialEvent.end.getHours() * 60 + initialEvent.end.getMinutes()
    const duration = initialEvent.durationMinutes
    const pointerStartY = pointerEvent.clientY

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - pointerStartY
      const deltaMinutes = Math.round(deltaY / PIXELS_PER_MINUTE / MINUTES_PER_STEP) * MINUTES_PER_STEP

      setEvents((prev) =>
        prev.map((event) => {
          if (event.id !== visitId) return event

          if (mode === 'move') {
            const minStart = DAY_START_HOUR * 60
            const maxStart = DAY_END_HOUR * 60 - duration
            const nextStartMinutes = clamp(startMinutes + deltaMinutes, minStart, maxStart)
            const nextEndMinutes = nextStartMinutes + duration

            const nextStart = setMinutes(setHours(new Date(event.start), Math.floor(nextStartMinutes / 60)), nextStartMinutes % 60)
            const nextEnd = setMinutes(setHours(new Date(event.end), Math.floor(nextEndMinutes / 60)), nextEndMinutes % 60)

            return {
              ...event,
              start: nextStart,
              end: nextEnd,
              startTime: format(nextStart, 'HH:mm'),
              endTime: format(nextEnd, 'HH:mm'),
            }
          }

          const minEnd = Math.max(startMinutes + MINUTES_PER_STEP, DAY_START_HOUR * 60 + MINUTES_PER_STEP)
          const maxEnd = DAY_END_HOUR * 60
          const nextEndMinutes = clamp(endMinutes + deltaMinutes, minEnd, maxEnd)

          const nextEnd = setMinutes(setHours(new Date(event.end), Math.floor(nextEndMinutes / 60)), nextEndMinutes % 60)
          const nextDuration = Math.max(MINUTES_PER_STEP, nextEndMinutes - startMinutes)

          return {
            ...event,
            end: nextEnd,
            endTime: format(nextEnd, 'HH:mm'),
            durationMinutes: nextDuration,
          }
        }),
      )
    }

    const endInteraction = () => {
      setActiveInteraction(null)
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', endInteraction)
      document.removeEventListener('pointercancel', endInteraction)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', endInteraction)
    document.addEventListener('pointercancel', endInteraction)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-[#00339B]">Weekly Schedule</h1>
        <p className="text-sm text-gray-500">Drag visits to fine-tune timing or pull the handle to stretch their duration.</p>
      </div>

      <Card className="rounded-3xl border-blue-100 bg-white shadow-lg shadow-blue-100/60">
        <div className="grid grid-cols-8 border-b border-blue-50 text-sm font-medium text-[#00339B]">
          <div className="border-r border-blue-50 px-4 py-3">Time</div>
          {DAY_LABELS.map((label) => (
            <div key={label} className="border-r border-blue-50 px-4 py-3 text-center">
              {label}
            </div>
          ))}
        </div>

        <div className="relative">
          <div className="grid grid-cols-8 divide-x divide-blue-50 text-sm">
            <div className="relative">
              {HOURS.map((hour) => (
                <div key={hour} className="border-b border-blue-50 px-4" style={{ height: HOUR_HEIGHT }}>
                  <span className="text-xs text-gray-500">{format(setHours(new Date(), hour), 'h a')}</span>
                </div>
              ))}
            </div>

            {DAY_LABELS.map((_, dayIndex) => (
              <div key={dayIndex} className="relative h-full">
                {HOURS.map((hour) => (
                  <div key={`${dayIndex}-${hour}`} className="border-b border-blue-50" style={{ height: HOUR_HEIGHT }} />
                ))}

                <div className="absolute inset-0 pb-4">
                  {visitsByDay[dayIndex]?.map((visit) => {
                    const minutesFromStart = visit.start.getHours() * 60 + visit.start.getMinutes() - DAY_START_HOUR * 60
                    const topOffset = Math.max(0, minutesFromStart * PIXELS_PER_MINUTE)
                    const height = Math.max(MIN_EVENT_HEIGHT, visit.durationMinutes * PIXELS_PER_MINUTE)
                    const isActive = activeInteraction?.id === visit.id

                    return (
                      <button
                        key={visit.id}
                        onPointerDown={(event) => beginInteraction(visit.id, 'move', event)}
                        onClick={() => setSelectedId(visit.id)}
                        className={cn(
                          'group absolute left-3 right-3 flex flex-col gap-2 rounded-3xl border border-white/30 px-4 py-3 text-left shadow-xl transition duration-150 focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-blue-200',
                          'backdrop-blur-sm text-white hover:-translate-y-1 hover:shadow-2xl',
                          isActive ? 'cursor-grabbing ring-2 ring-white/70' : 'cursor-grab'
                        )}
                        style={{
                          top: `${topOffset}px`,
                          height: `${height}px`,
                          backgroundImage: createGradient(visit.color),
                        }}
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-white/80">
                          <span>{format(visit.start, 'h:mm a')}</span>
                          <span>{format(visit.end, 'h:mm a')}</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold leading-tight text-white drop-shadow-md">
                            {visit.siteName}
                          </p>
                          <p className="text-xs text-white/80">{visit.cleanerName}</p>
                        </div>
                        <Badge
                          className={cn(
                            'w-fit rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition',
                            visit.isCompleted
                              ? 'bg-white/95 text-emerald-600'
                              : 'bg-white/80 text-amber-600 group-hover:bg-white'
                          )}
                        >
                          {visit.isCompleted ? 'Completed' : 'Pending'}
                        </Badge>

                        <div
                          className="absolute bottom-2 left-1/2 h-2 w-12 -translate-x-1/2 rounded-full bg-white/60 opacity-0 transition group-hover:opacity-100"
                          onPointerDown={(event) => beginInteraction(visit.id, 'resize', event)}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Dialog
        open={Boolean(selectedVisit)}
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
                <DialogTitle className="text-2xl font-semibold text-[#00339B]">
                  {selectedVisit.siteName}
                </DialogTitle>
                <DialogDescription>
                  {format(selectedVisit.start, 'EEEE · h:mm a')} – {format(selectedVisit.end, 'h:mm a')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-3 rounded-2xl bg-blue-50/70 p-4">
                  <div className="text-sm text-blue-800">
                    <span className="font-semibold">Cleaner:</span> {selectedVisit.cleanerName}
                  </div>
                  <div className="text-sm text-blue-800">
                    <span className="font-semibold">Status:</span>{' '}
                    <Badge
                      variant={selectedVisit.isCompleted ? 'default' : 'secondary'}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
                        selectedVisit.isCompleted
                          ? 'bg-emerald-600 text-white'
                          : 'bg-amber-500/20 text-amber-700'
                      )}
                    >
                      {selectedVisit.isCompleted ? 'Completed' : 'Awaiting clock-out'}
                    </Badge>
                  </div>
                </div>

                <ScrollArea className="max-h-48 rounded-2xl border border-blue-100">
                  <div className="space-y-3 p-4 text-sm text-gray-600">
                    <p>
                      {selectedVisit.clockIn
                        ? `Clock-in recorded at ${format(new Date(selectedVisit.clockIn), 'PPpp')}`
                        : 'No clock-in recorded yet.'}
                    </p>
                    <p>
                      {selectedVisit.clockOut
                        ? `Clock-out recorded at ${format(new Date(selectedVisit.clockOut), 'PPpp')}`
                        : 'Awaiting clock-out to mark completion.'}
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
