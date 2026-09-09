import React, { useEffect, useMemo, useState } from 'react'
import { addDays, format, isSameDay, startOfWeek } from 'date-fns'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeeklyScheduleBlock } from './WeeklyScheduleGrid'

interface MobileDayScheduleProps {
  weekStart: Date
  blocks: WeeklyScheduleBlock[]
  onCreate?: (day: Date, hour: number) => void
  onSelect?: (blockId: string) => void
  isLoading?: boolean
}

const TONE_CLASS: Record<NonNullable<WeeklyScheduleBlock['tone']>, string> = {
  primary: 'border-l-primary bg-primary/10',
  accent: 'border-l-success bg-success/10',
  muted: 'border-l-gray-300 bg-muted',
}

const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd')

/** Where a new shift starts when it is added from the day view. */
const DEFAULT_NEW_SHIFT_HOUR = 9

/**
 * The week, one day at a time.
 *
 * The desktop grid is 860px of absolutely-positioned time columns; on a phone
 * it becomes a sideways-scrolling smear where each day is 40px wide. A day
 * picker plus an agenda list carries the same information at a size a thumb
 * can actually work with.
 */
export const MobileDaySchedule: React.FC<MobileDayScheduleProps> = ({
  weekStart,
  blocks,
  onCreate,
  onSelect,
  isLoading = false,
}) => {
  const days = useMemo(() => {
    const monday = startOfWeek(weekStart, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  }, [weekStart])

  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(days[0]))

  // Follow the week the parent is showing: land on today when it is in range,
  // otherwise on the Monday. Without this, paging to another week leaves the
  // view stuck on a date that is no longer on screen.
  useEffect(() => {
    const today = days.find((day) => isSameDay(day, new Date()))
    setSelectedKey(dayKeyOf(today ?? days[0]))
  }, [days])

  const blocksByDay = useMemo(() => {
    const map = new Map<string, WeeklyScheduleBlock[]>()
    days.forEach((day) => map.set(dayKeyOf(day), []))
    blocks.forEach((block) => {
      const start = new Date(block.startAt)
      if (Number.isNaN(start.getTime())) return
      map.get(format(start, 'yyyy-MM-dd'))?.push(block)
    })
    map.forEach((list) =>
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    )
    return map
  }, [blocks, days])

  const selectedDay = days.find((day) => dayKeyOf(day) === selectedKey) ?? days[0]
  const dayBlocks = blocksByDay.get(selectedKey) ?? []

  return (
    <div className="md:hidden">
      {/* A fixed seven-column grid, not a scroll strip: the whole week has to
          be visible at once for the dots to tell you where the work is. */}
      <div className="grid grid-cols-7 gap-1 pb-3">
        {days.map((day) => {
          const key = dayKeyOf(day)
          const active = key === selectedKey
          const isToday = isSameDay(day, new Date())
          const count = blocksByDay.get(key)?.length ?? 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-2xl px-0.5 py-2.5 transition',
                active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground ring-1 ring-border/[0.04]',
              )}
            >
              <span className="text-caption2 font-medium uppercase tracking-[0.06em] opacity-70">
                {format(day, 'EEE')}
              </span>
              <span
                className={cn(
                  'text-[19px] font-semibold leading-none',
                  !active && isToday && 'text-primary',
                  !active && !isToday && 'text-foreground',
                )}
              >
                {format(day, 'd')}
              </span>
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  count > 0 ? (active ? 'bg-card' : 'bg-primary') : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>

      <div className="rounded-3xl bg-card p-3 ring-1 ring-border/[0.04]">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-footnote font-semibold text-foreground">
            {format(selectedDay, 'EEEE d MMM')}
          </span>
          <span className="text-caption2 font-medium text-muted-foreground">
            {isLoading ? 'Loading…' : `${dayBlocks.length} shift${dayBlocks.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {dayBlocks.length === 0 ? (
          <p className="px-1 py-8 text-center text-footnote text-muted-foreground">
            {isLoading ? '' : 'Nothing scheduled.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {dayBlocks.map((block) => {
              const start = new Date(block.startAt)
              const end = new Date(block.endAt)
              return (
                <li key={block.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(block.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border-l-[3px] px-3 py-3 text-left transition active:brightness-95',
                      TONE_CLASS[block.tone ?? 'primary'],
                    )}
                  >
                    <div className="w-[58px] shrink-0">
                      <div className="text-footnote font-semibold tabular-nums text-foreground">
                        {format(start, 'HH:mm')}
                      </div>
                      <div className="text-caption2 tabular-nums text-muted-foreground">
                        {format(end, 'HH:mm')}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-subheadline font-medium text-foreground">
                        {block.title}
                      </div>
                      {block.subtitle ? (
                        <div className="truncate text-caption text-muted-foreground">{block.subtitle}</div>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {onCreate ? (
          <button
            type="button"
            onClick={() => onCreate(selectedDay, DEFAULT_NEW_SHIFT_HOUR)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-footnote font-medium text-muted-foreground transition active:bg-muted"
          >
            <Plus className="h-4 w-4" />
            Add shift on {format(selectedDay, 'EEE d')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
