import React, { useMemo } from 'react'
import { addDays, format, isSameDay, startOfWeek } from 'date-fns'
import { cn } from '@/lib/utils'

export interface WeeklyScheduleBlock {
  id: string
  startAt: string
  endAt: string
  title: string
  subtitle?: string | null
  tone?: 'primary' | 'accent' | 'muted'
}

interface WeeklyScheduleGridProps {
  weekStart: Date
  blocks: WeeklyScheduleBlock[]
  startHour?: number
  endHour?: number
  onCreate?: (day: Date, hour: number) => void
  onSelect?: (blockId: string) => void
  isLoading?: boolean
}

const TONE_CLASS: Record<NonNullable<WeeklyScheduleBlock['tone']>, string> = {
  primary: 'bg-[#EAF2FF] text-[#0A3C8C] ring-1 ring-inset ring-[#D5E4FF] hover:bg-[#DDE9FF]',
  accent: 'bg-[#E6F7EE] text-[#0F5132] ring-1 ring-inset ring-[#CDEAD9] hover:bg-[#D6F1E2]',
  muted: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-150',
}

const ROW_HEIGHT_PX = 56

export const WeeklyScheduleGrid: React.FC<WeeklyScheduleGridProps> = ({
  weekStart,
  blocks,
  startHour = 6,
  endHour = 22,
  onCreate,
  onSelect,
  isLoading = false,
}) => {
  const days = useMemo(() => {
    const monday = startOfWeek(weekStart, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  }, [weekStart])

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour],
  )

  const blocksByDay = useMemo(() => {
    const map = new Map<string, WeeklyScheduleBlock[]>()
    days.forEach((day) => map.set(format(day, 'yyyy-MM-dd'), []))
    blocks.forEach((block) => {
      const start = new Date(block.startAt)
      if (Number.isNaN(start.getTime())) return
      const key = format(start, 'yyyy-MM-dd')
      const list = map.get(key)
      if (list) list.push(block)
    })
    return map
  }, [blocks, days])

  const today = new Date()
  const visibleMinutes = (endHour - startHour + 1) * 60
  const totalHeightPx = (endHour - startHour + 1) * ROW_HEIGHT_PX

  const positionForBlock = (block: WeeklyScheduleBlock) => {
    const start = new Date(block.startAt)
    const end = new Date(block.endAt)
    const startMinute = start.getHours() * 60 + start.getMinutes() - startHour * 60
    const endMinute = end.getHours() * 60 + end.getMinutes() - startHour * 60
    const clampedStart = Math.max(0, startMinute)
    const clampedEnd = Math.min(visibleMinutes, endMinute)
    const top = (clampedStart / visibleMinutes) * totalHeightPx
    const height = Math.max(32, ((clampedEnd - clampedStart) / visibleMinutes) * totalHeightPx)
    return { top, height }
  }

  return (
    <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
      <div className="grid min-w-[860px] grid-cols-[64px_repeat(7,minmax(140px,1fr))]">
        <div className="px-3 py-4 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
          Time
        </div>
        {days.map((day) => {
          const isToday = isSameDay(day, today)
          return (
            <div key={day.toISOString()} className="px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                {format(day, 'EEE')}
                {isToday ? <span className="h-1.5 w-1.5 rounded-full bg-[#007AFF]" /> : null}
              </div>
              <div
                className={cn(
                  'mt-0.5 text-[22px] font-semibold tracking-tight',
                  isToday ? 'text-[#007AFF]' : 'text-gray-900',
                )}
              >
                {format(day, 'd')}
              </div>
            </div>
          )
        })}

        <div className="col-span-8 h-px bg-gray-100" />

        <div className="relative" style={{ height: totalHeightPx }}>
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex items-start justify-end pr-3 pt-1 text-[10px] font-medium tracking-tight text-gray-400"
              style={{ height: ROW_HEIGHT_PX }}
            >
              {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayBlocks = blocksByDay.get(dayKey) ?? []
          const isToday = isSameDay(day, today)
          return (
            <div
              key={dayKey}
              className={cn(
                'relative border-l border-gray-100',
                isToday && 'bg-[#F5F9FF]/50',
              )}
              style={{ height: totalHeightPx }}
            >
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className="flex w-full items-start border-b border-gray-100/70 bg-transparent text-left transition-colors hover:bg-gray-50/70 focus:bg-gray-50/70 focus:outline-none"
                  style={{ height: ROW_HEIGHT_PX }}
                  onClick={() => onCreate?.(day, hour)}
                  aria-label={`Add shift on ${format(day, 'PPP')} at ${hour}:00`}
                />
              ))}

              {dayBlocks.map((block) => {
                const { top, height } = positionForBlock(block)
                const tone = block.tone ?? 'primary'
                const start = new Date(block.startAt)
                const end = new Date(block.endAt)
                const timeLabel = `${format(start, 'h:mm')} – ${format(end, 'h:mm a')}`
                return (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onSelect?.(block.id)}
                    className={cn(
                      'absolute left-1.5 right-1.5 rounded-xl px-2.5 py-1.5 text-left text-[11px] transition-all focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30',
                      'shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
                      TONE_CLASS[tone],
                    )}
                    style={{ top, height }}
                  >
                    <div className="truncate text-[12px] font-semibold leading-tight">{block.title}</div>
                    {block.subtitle ? (
                      <div className="truncate text-[10.5px] opacity-70">{block.subtitle}</div>
                    ) : null}
                    <div className="truncate text-[10.5px] font-medium opacity-60">{timeLabel}</div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {isLoading ? (
        <div className="border-t border-gray-100 px-4 py-2 text-center text-[11px] font-medium text-gray-400">
          Loading…
        </div>
      ) : null}
    </div>
  )
}
