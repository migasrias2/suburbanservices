"use client"

import * as React from 'react'
import {
  add,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isEqual,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfDay,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface CalendarEvent {
  id: number | string
  name: string
  time: string
  datetime: string
  metadata?: Record<string, unknown>
}

export interface CalendarLogEntry {
  id: number | string
  cleanerName?: string | null
  action?: string | null
  timestamp: string
  siteArea?: string | null
  customerName?: string | null
  comments?: string | null
}

export interface CalendarData {
  day: Date
  events: CalendarEvent[]
  logs?: CalendarLogEntry[]
}

export interface FullScreenCalendarProps {
  data: CalendarData[]
  isLoading?: boolean
  onMonthChange?: (range: { start: Date; end: Date }) => void
  headerActionSlot?: React.ReactNode
  emptyState?: React.ReactNode
  onDaySelect?: (day: Date) => void
  renderDetails?: (day: Date, data: CalendarData | null) => React.ReactNode
}

const colStartClasses = ['', 'col-start-2', 'col-start-3', 'col-start-4', 'col-start-5', 'col-start-6', 'col-start-7']

const getDayKey = (date: Date) => format(startOfDay(date), 'yyyy-MM-dd')

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 1)}…`
}

export function FullScreenCalendar({
  data,
  isLoading,
  onMonthChange,
  headerActionSlot,
  emptyState,
  onDaySelect,
  renderDetails,
}: FullScreenCalendarProps) {
  const today = startOfToday()
  const [selectedDay, setSelectedDay] = React.useState<Date>(today)
  const [currentMonth, setCurrentMonth] = React.useState<string>(format(today, 'MMM-yyyy'))
  const firstDayCurrentMonth = parse(currentMonth, 'MMM-yyyy', new Date())

  const days = React.useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(firstDayCurrentMonth),
        end: endOfWeek(endOfMonth(firstDayCurrentMonth)),
      }),
    [firstDayCurrentMonth],
  )

  const groupedData = React.useMemo(() => {
    const map = new Map<string, CalendarData>()

    data.forEach((entry) => {
      const key = getDayKey(entry.day)
      const existing = map.get(key)

      if (existing) {
        existing.events.push(...entry.events)
        if (entry.logs?.length) {
          existing.logs = [...(existing.logs ?? []), ...entry.logs]
        }
      } else {
        map.set(key, {
          day: startOfDay(entry.day),
          events: [...entry.events],
          logs: entry.logs ? [...entry.logs] : [],
        })
      }
    })

    return map
  }, [data])

  const selectedDayData = React.useMemo(() => groupedData.get(getDayKey(selectedDay)) ?? null, [groupedData, selectedDay])

  const monthRange = React.useMemo(() => {
    const start = startOfMonth(firstDayCurrentMonth)
    const end = endOfMonth(firstDayCurrentMonth)
    return { start, end }
  }, [firstDayCurrentMonth])

  React.useEffect(() => {
    if (!onMonthChange) return
    onMonthChange(monthRange)
  }, [monthRange, onMonthChange])

  const handleSelectDay = (day: Date) => {
    setSelectedDay(day)
    onDaySelect?.(day)
  }

  const previousMonth = () => {
    const firstDayNextMonth = add(firstDayCurrentMonth, { months: -1 })
    setCurrentMonth(format(firstDayNextMonth, 'MMM-yyyy'))
  }

  const nextMonth = () => {
    const firstDayNextMonth = add(firstDayCurrentMonth, { months: 1 })
    setCurrentMonth(format(firstDayNextMonth, 'MMM-yyyy'))
  }

  const renderHoverCardContent = (day: Date) => {
    const entry = groupedData.get(getDayKey(day))
    if (!entry || (!entry.events.length && !(entry.logs?.length))) {
      return (
        <div className="space-y-2 text-[#00339B]">
          <p className="text-sm font-semibold">{format(day, 'PPP')}</p>
          <p className="text-xs font-medium text-[#00339B]/70">No attendance or cleaner logs recorded.</p>
        </div>
      )
    }

    const logs = entry.logs ?? []

    return (
      <div className="space-y-4 text-[#00339B]">
        <div>
          <p className="text-base font-semibold">{format(day, 'PPP')}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-[#00339B]/70">
            {entry.events.length} shift{entry.events.length === 1 ? '' : 's'} · {logs.length}{' '}
            log{logs.length === 1 ? '' : 's'}
          </p>
        </div>

        {entry.events.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00339B]/60">Shifts</p>
            <div className="space-y-1.5">
              {entry.events.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs shadow-sm shadow-blue-100/60"
                >
                  <p className="font-semibold text-[#00339B]">{event.name}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#00339B]/70">{event.time}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {logs.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00339B]/60">Logs</p>
            <ScrollArea className="max-h-48 rounded-xl border border-blue-100 bg-white/80">
              <div className="space-y-1.5 p-2">
                {logs.slice(0, 12).map((log) => (
                  <div key={log.id} className="rounded-lg border border-blue-100 bg-blue-50/40 p-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2 font-semibold text-[#00339B]">
                      <span>{truncateText(log.action ?? 'Log entry', 32)}</span>
                      <span className="text-[#00339B]/70">{format(new Date(log.timestamp), 'p')}</span>
                    </div>
                    <div className="mt-0.5 space-y-0.5 text-[#00339B]/70">
                      {log.cleanerName ? <p>{truncateText(log.cleanerName, 40)}</p> : null}
                      {log.siteArea || log.customerName ? (
                        <p>{truncateText(log.siteArea ?? log.customerName ?? '', 40)}</p>
                      ) : null}
                      {log.comments ? <p className="italic">{truncateText(log.comments, 60)}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </div>
    )
  }

  const renderDayButtonContent = (day: Date) => {
    const entry = groupedData.get(getDayKey(day))
    const events = entry?.events ?? []

    return (
      <>
        <time
          dateTime={format(day, 'yyyy-MM-dd')}
          className={cn(
            'ml-auto flex size-6 items-center justify-center rounded-full',
            isEqual(day, selectedDay) && isToday(day) && 'bg-primary text-primary-foreground',
            isEqual(day, selectedDay) && !isToday(day) && 'bg-primary text-primary-foreground',
          )}
        >
          {format(day, 'd')}
        </time>
        {events.length ? (
          <div>
            <div className="-mx-0.5 mt-auto flex flex-wrap-reverse">
              {events.map((event) => (
                <span key={event.id} className="mx-0.5 mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              ))}
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="rounded-3xl border border-blue-100 bg-gradient-to-r from-white via-blue-50/70 to-white p-6 shadow-lg shadow-blue-100/60">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-auto">
            <div className="flex items-center gap-4">
              <div className="hidden w-20 flex-col items-center justify-center rounded-2xl border border-blue-100 bg-white/90 p-1 text-[#00339B] md:flex">
                <h1 className="p-1 text-xs font-semibold uppercase text-[#00339B]/70">{format(today, 'MMM')}</h1>
                <div className="flex w-full items-center justify-center rounded-xl border border-blue-100 bg-white p-1 text-lg font-bold">
                  <span>{format(today, 'd')}</span>
                </div>
              </div>
              <div className="flex flex-col">
                <h2 className="text-2xl font-semibold text-[#00339B]">{format(firstDayCurrentMonth, 'MMMM, yyyy')}</h2>
                <p className="text-sm font-medium text-[#00339B]/70">
                  {format(monthRange.start, 'MMM d, yyyy')} – {format(monthRange.end, 'MMM d, yyyy')}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
            <div className="flex w-full items-center justify-end md:w-auto">
              <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-white p-1 shadow-sm shadow-blue-100/60">
                <Button
                  onClick={previousMonth}
                  className="h-10 w-10 rounded-full border-none text-[#00339B] shadow-none hover:bg-blue-50"
                  variant="outline"
                  size="icon"
                  aria-label="Navigate to previous month"
                >
                  <ChevronLeftIcon size={16} strokeWidth={2} aria-hidden="true" />
                </Button>
                <Button
                  onClick={nextMonth}
                  className="h-10 w-10 rounded-full border-none text-[#00339B] shadow-none hover:bg-blue-50"
                  variant="outline"
                  size="icon"
                  aria-label="Navigate to next month"
                >
                  <ChevronRightIcon size={16} strokeWidth={2} aria-hidden="true" />
                </Button>
              </div>
            </div>

            {headerActionSlot}
          </div>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-lg shadow-blue-100/60">
        <div className="lg:flex lg:flex-auto lg:flex-col">
          <div className="grid grid-cols-7 border-b border-blue-100 bg-gradient-to-r from-blue-50/60 to-white text-center text-xs font-semibold uppercase tracking-wide text-[#00339B] lg:flex-none">
            <div className="border-r py-2.5">Sun</div>
            <div className="border-r py-2.5">Mon</div>
            <div className="border-r py-2.5">Tue</div>
            <div className="border-r py-2.5">Wed</div>
            <div className="border-r py-2.5">Thu</div>
            <div className="border-r py-2.5">Fri</div>
            <div className="py-2.5">Sat</div>
          </div>

          <div className="flex text-xs leading-6 lg:flex-auto">
            <div className="hidden w-full border-x border-blue-50 lg:grid lg:grid-cols-7 lg:grid-rows-5">
              {days.map((day, dayIdx) => {
                const entry = groupedData.get(getDayKey(day))
                const logs = entry?.logs ?? []
                const events = entry?.events ?? []

                return (
                  <HoverCard key={dayIdx} openDelay={150} closeDelay={150}>
                    <HoverCardTrigger asChild>
                      <div
                        onClick={() => handleSelectDay(day)}
                        className={cn(
                          dayIdx === 0 && colStartClasses[getDay(day)],
                          !isEqual(day, selectedDay) &&
                            !isToday(day) &&
                            !isSameMonth(day, firstDayCurrentMonth) &&
                            'bg-blue-50/50 text-[#00339B]/50',
                          'relative flex flex-col border-b border-r border-blue-50 focus:z-10 transition-colors',
                          !isEqual(day, selectedDay) && 'hover:bg-blue-50/70',
                        )}
                      >
                        <header className="flex items-center justify-between p-2.5">
                          <button
                            type="button"
                            className={cn(
                              isEqual(day, selectedDay) && 'text-primary-foreground',
                              !isEqual(day, selectedDay) &&
                                !isToday(day) &&
                                isSameMonth(day, firstDayCurrentMonth) &&
                                'text-[#00339B]',
                              !isEqual(day, selectedDay) &&
                                !isToday(day) &&
                                !isSameMonth(day, firstDayCurrentMonth) &&
                                'text-[#00339B]/50',
                              isEqual(day, selectedDay) && isToday(day) && 'border-none bg-primary',
                              isEqual(day, selectedDay) && !isToday(day) && 'bg-[#00339B] text-white',
                              (isEqual(day, selectedDay) || isToday(day)) && 'font-semibold',
                              'flex h-7 w-7 items-center justify-center rounded-full text-xs hover:border hover:border-blue-200',
                            )}
                          >
                            <time dateTime={format(day, 'yyyy-MM-dd')}>{format(day, 'd')}</time>
                          </button>
                          {events.length ? (
                            <span className="text-[10px] font-semibold text-[#00339B]/70">
                              {events.length} shift{events.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </header>
                        <div className="flex-1 space-y-1.5 p-2.5">
                          {events.slice(0, 2).map((event) => (
                            <div
                              key={event.id}
                              className="flex flex-col items-start gap-1 rounded-xl border border-blue-100 bg-blue-50/60 p-2 text-xs leading-tight text-[#00339B]"
                            >
                              <p className="font-medium leading-none">{truncateText(event.name, 40)}</p>
                              <p className="leading-none text-[#00339B]/70">{event.time}</p>
                            </div>
                          ))}
                          {events.length > 2 ? (
                            <div className="text-xs font-medium text-[#00339B]/70">+ {events.length - 2} more</div>
                          ) : null}
                          {!events.length && logs.length ? (
                            <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-2 text-[11px] font-medium text-[#00339B]/70">
                              {logs.length} log{logs.length === 1 ? '' : 's'} recorded
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent
                      className="w-80 rounded-2xl border border-blue-100 bg-white shadow-xl shadow-blue-100/60"
                      sideOffset={12}
                      align="center"
                    >
                      {renderHoverCardContent(day)}
                    </HoverCardContent>
                  </HoverCard>
                )
              })}
            </div>

            <div className="isolate grid w-full grid-cols-7 grid-rows-5 border-x border-blue-50 lg:hidden">
              {days.map((day, dayIdx) => (
                <HoverCard key={dayIdx} openDelay={150} closeDelay={150}>
                  <HoverCardTrigger asChild>
                    <button
                      onClick={() => handleSelectDay(day)}
                      type="button"
                      className={cn(
                        isEqual(day, selectedDay) && 'text-primary-foreground',
                        !isEqual(day, selectedDay) &&
                          !isToday(day) &&
                          isSameMonth(day, firstDayCurrentMonth) &&
                          'text-[#00339B]',
                        !isEqual(day, selectedDay) &&
                          !isToday(day) &&
                          !isSameMonth(day, firstDayCurrentMonth) &&
                          'text-[#00339B]/50',
                        (isEqual(day, selectedDay) || isToday(day)) && 'font-semibold',
                        'flex h-14 flex-col border-b border-r border-blue-50 px-3 py-2 hover:bg-blue-50 focus:z-10',
                      )}
                    >
                      {renderDayButtonContent(day)}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-72 rounded-2xl border border-blue-100 bg-white shadow-xl shadow-blue-100/60" sideOffset={8}>
                    {renderHoverCardContent(day)}
                  </HoverCardContent>
                </HoverCard>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#00339B] border-t-transparent" />
            <p className="mt-3 text-sm font-semibold text-[#00339B]">Loading calendar…</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-lg shadow-blue-100/60">
        {renderDetails ? (
          renderDetails(selectedDay, selectedDayData)
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-[#00339B]">{format(selectedDay, 'PPP')}</h3>
                <p className="text-xs font-medium uppercase tracking-wide text-[#00339B]/60">Summary of cleaner attendance and logs</p>
              </div>

              {selectedDayData?.events?.length ? (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 shadow-sm shadow-blue-100/50">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#00339B]/80">Shifts</h4>
                  <div className="mt-2 space-y-2">
                    {selectedDayData.events.map((event) => (
                      <div key={event.id} className="rounded-xl border border-blue-100 bg-white/90 p-3 shadow-sm shadow-blue-100/40">
                        <p className="text-sm font-semibold text-[#00339B]">{event.name}</p>
                        <p className="text-xs text-[#00339B]/70">{event.time}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedDayData?.logs?.length ? (
                <div className="rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm shadow-blue-100/50">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#00339B]/80">Cleaner Logs</h4>
                  <div className="mt-2 space-y-2">
                    {selectedDayData.logs.map((log) => (
                      <div key={log.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[#00339B]">
                          <span>{log.action ?? 'Log entry'}</span>
                          <span className="text-[#00339B]/70">{format(new Date(log.timestamp), 'p')}</span>
                        </div>
                        {log.cleanerName ? (
                          <p className="mt-1 text-xs text-[#00339B]/70">{log.cleanerName}</p>
                        ) : null}
                        {log.siteArea || log.customerName ? (
                          <p className="mt-0.5 text-xs text-[#00339B]/70">
                            {log.siteArea ?? log.customerName}
                          </p>
                        ) : null}
                        {log.comments ? (
                          <p className="mt-1 text-xs italic text-[#00339B]/70">{log.comments}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!selectedDayData?.events?.length && !selectedDayData?.logs?.length ? (
                <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-6 text-center text-sm font-medium text-[#00339B]/70">
                  {emptyState ?? 'No attendance or cleaner logs for this day.'}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


