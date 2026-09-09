import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, addWeeks, endOfWeek, format, isSameDay, startOfWeek } from 'date-fns'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { useToast } from '@/hooks/use-toast'
import { getStoredCleanerName } from '@/lib/identity'
import { fetchShiftsInRange, type CleanerShift } from '@/services/shiftsService'
import { cn } from '@/lib/utils'

const getWeekRange = (anchor: Date) => {
  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  start.setHours(0, 0, 0, 0)
  const end = endOfWeek(anchor, { weekStartsOn: 1 })
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

const groupByDay = (
  shifts: CleanerShift[],
  weekStart: Date,
): { day: Date; items: CleanerShift[] }[] => {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  return days.map((day) => ({
    day,
    items: shifts
      .filter((s) => isSameDay(new Date(s.startAt), day))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
  }))
}

const formatDuration = (start: Date, end: Date): string => {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours && mins) return `${hours}h ${mins}m`
  if (hours) return `${hours}h`
  return `${mins}m`
}

const CleanerSchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [userName, setUserName] = useState<string>('')
  const [cleanerId, setCleanerId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'this' | 'next'>('this')
  const [thisWeekShifts, setThisWeekShifts] = useState<CleanerShift[]>([])
  const [nextWeekShifts, setNextWeekShifts] = useState<CleanerShift[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    const role = localStorage.getItem('userType')
    const id = localStorage.getItem('userId') ?? ''
    const name = getStoredCleanerName()
    if (role !== 'cleaner' || !id || !name) {
      navigate('/login')
      return
    }
    setUserName(name)
    setCleanerId(id)
  }, [navigate])

  const today = useMemo(() => new Date(), [])
  const thisWeek = useMemo(() => getWeekRange(today), [today])
  const nextWeek = useMemo(() => getWeekRange(addWeeks(today, 1)), [today])

  const loadShifts = useCallback(async () => {
    if (!cleanerId) return
    setIsLoading(true)
    try {
      const [thisRows, nextRows] = await Promise.all([
        fetchShiftsInRange(thisWeek.start, addDays(thisWeek.end, 1), { cleanerId, publishedOnly: true }),
        fetchShiftsInRange(nextWeek.start, addDays(nextWeek.end, 1), { cleanerId, publishedOnly: true }),
      ])
      setThisWeekShifts(thisRows)
      setNextWeekShifts(nextRows)
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not load schedule', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [cleanerId, thisWeek.start, thisWeek.end, nextWeek.start, nextWeek.end, toast])

  useEffect(() => {
    loadShifts()
  }, [loadShifts])

  const renderDay = (day: Date, items: CleanerShift[]) => {
    const isToday = isSameDay(day, today)
    return (
      <div key={day.toISOString()} className="space-y-2.5">
        <div className="flex items-baseline justify-between px-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-title2 font-semibold tracking-tight',
                isToday ? 'text-primary' : 'text-foreground',
              )}
            >
              {format(day, 'd')}
            </span>
            <span className="text-caption font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {format(day, 'EEEE')}
            </span>
            {isToday ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption2 font-semibold uppercase tracking-wider text-primary">
                Today
              </span>
            ) : null}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl bg-card/60 px-4 py-3 text-footnote text-muted-foreground ring-1 ring-border/[0.03]">
            No shifts
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((shift) => {
              const start = new Date(shift.startAt)
              const end = new Date(shift.endAt)
              const location = shift.siteName ?? shift.customerName
              return (
                <div
                  key={shift.id}
                  className="rounded-2xl bg-card p-4 ring-1 ring-border/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.1)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-body font-semibold tracking-tight text-foreground">
                        {format(start, 'h:mm')} – {format(end, 'h:mm a')}
                      </div>
                      {location ? (
                        <div className="mt-0.5 truncate text-footnote text-muted-foreground">{location}</div>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption2 font-medium text-muted-foreground">
                      {formatDuration(start, end)}
                    </span>
                  </div>
                  {shift.notes ? (
                    <p className="mt-3 whitespace-pre-wrap text-caption leading-snug text-muted-foreground">
                      {shift.notes}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-card">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  const thisGroups = groupByDay(thisWeekShifts, thisWeek.start)
  const nextGroups = groupByDay(nextWeekShifts, nextWeek.start)
  const activeGroups = activeTab === 'this' ? thisGroups : nextGroups
  const activeRange = activeTab === 'this' ? thisWeek : nextWeek

  return (
    <Sidebar07Layout userType="cleaner" userName={userName}>
      <div className="min-h-screen bg-muted">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-5 py-8">
          <header>
            <p className="text-caption2 font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Schedule
            </p>
            <h1 className="mt-1 text-title1 font-semibold tracking-tight text-foreground">
              My Schedule
            </h1>
            <p className="mt-0.5 text-footnote text-muted-foreground">
              {format(activeRange.start, 'MMM d')} – {format(activeRange.end, 'MMM d')}
            </p>
          </header>

          <div className="inline-flex w-full max-w-[280px] rounded-full bg-muted/80 p-1">
            {[
              { key: 'this', label: 'This week', count: thisWeekShifts.length },
              { key: 'next', label: 'Next week', count: nextWeekShifts.length },
            ].map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as 'this' | 'next')}
                  className={cn(
                    'flex-1 rounded-full px-3 py-1.5 text-caption font-semibold transition-all',
                    active
                      ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(0,0,0,0.06)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                  <span className={cn('ml-1.5 text-caption2', active ? 'text-muted-foreground' : 'text-muted-foreground')}>
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="space-y-6">
            {isLoading ? (
              <div className="rounded-2xl bg-card/60 px-4 py-6 text-center text-footnote text-muted-foreground ring-1 ring-border/[0.03]">
                Loading…
              </div>
            ) : (
              activeGroups.map(({ day, items }) => renderDay(day, items))
            )}
          </div>
        </div>
      </div>
    </Sidebar07Layout>
  )
}

export default CleanerSchedulePage
