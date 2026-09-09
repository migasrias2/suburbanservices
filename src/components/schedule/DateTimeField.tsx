import React, { useMemo, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { format } from 'date-fns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface DateTimeFieldProps {
  value: Date | null
  onChange: (value: Date) => void
  id?: string
  placeholder?: string
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const pad = (n: number) => String(n).padStart(2, '0')

const splitTime = (date: Date | null) => {
  if (!date) {
    return { hour12: 9, minute: 0, period: 'AM' as 'AM' | 'PM' }
  }
  const h24 = date.getHours()
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM'
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12
  return { hour12, minute: date.getMinutes(), period }
}

const composeDate = (
  baseDay: Date,
  hour12: number,
  minute: number,
  period: 'AM' | 'PM',
): Date => {
  const result = new Date(baseDay)
  let h24 = hour12 % 12
  if (period === 'PM') h24 += 12
  result.setHours(h24, minute, 0, 0)
  return result
}

export const DateTimeField: React.FC<DateTimeFieldProps> = ({
  value,
  onChange,
  id,
  placeholder = 'Pick date & time',
}) => {
  const [open, setOpen] = useState(false)
  const safeValue = value ?? null
  const { hour12, minute, period } = useMemo(() => splitTime(safeValue), [safeValue])

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return
    onChange(composeDate(day, hour12, minute, period))
  }

  const handleHourChange = (next: string) => {
    const day = safeValue ?? new Date()
    onChange(composeDate(day, Number(next), minute, period))
  }
  const handleMinuteChange = (next: string) => {
    const day = safeValue ?? new Date()
    onChange(composeDate(day, hour12, Number(next), period))
  }
  const handlePeriodChange = (next: string) => {
    const day = safeValue ?? new Date()
    onChange(composeDate(day, hour12, minute, next as 'AM' | 'PM'))
  }

  const displayLabel = safeValue
    ? `${format(safeValue, 'EEE, MMM d')} · ${format(safeValue, 'h:mm a')}`
    : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'flex h-11 w-full items-center justify-between rounded-xl bg-muted/80 px-3.5 text-left text-subheadline text-foreground transition-colors',
            'focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
            !safeValue && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto rounded-2xl border border-border bg-card p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.2)]"
      >
        <DayPicker
          mode="single"
          selected={safeValue ?? undefined}
          onSelect={handleDaySelect}
          showOutsideDays
          classNames={{
            months: 'flex flex-col',
            month: 'space-y-3',
            caption: 'flex items-center justify-between px-1',
            caption_label: 'text-subheadline font-semibold tracking-tight text-foreground',
            nav: 'flex items-center gap-1',
            nav_button:
              'inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground',
            nav_button_previous: '',
            nav_button_next: '',
            table: 'w-full border-collapse',
            head_row: 'flex',
            head_cell:
              'flex h-7 w-9 items-center justify-center text-caption2 font-medium uppercase tracking-[0.06em] text-muted-foreground',
            row: 'flex w-full mt-1',
            cell: 'h-9 w-9 p-0 text-center',
            day: 'inline-flex h-9 w-9 items-center justify-center rounded-full text-footnote text-foreground transition-colors hover:bg-muted focus:outline-none',
            day_selected:
              '!bg-primary !text-primary-foreground hover:!bg-primary/90 focus:!bg-primary/90',
            day_today: 'font-semibold text-primary',
            day_outside: 'text-muted-foreground',
            day_disabled: 'text-muted-foreground opacity-50',
            day_hidden: 'invisible',
          }}
          components={{
            IconLeft: () => <ChevronLeft className="h-4 w-4" />,
            IconRight: () => <ChevronRight className="h-4 w-4" />,
          }}
        />

        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <span className="text-caption2 font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Time
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Select value={String(hour12)} onValueChange={handleHourChange}>
              <SelectTrigger className="h-9 w-[68px] rounded-lg border-0 bg-muted/80 px-2.5 text-footnote font-medium text-foreground shadow-none focus:ring-2 focus:ring-ring/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-border bg-card shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-subheadline font-semibold text-muted-foreground">:</span>
            <Select value={String(minute)} onValueChange={handleMinuteChange}>
              <SelectTrigger className="h-9 w-[68px] rounded-lg border-0 bg-muted/80 px-2.5 text-footnote font-medium text-foreground shadow-none focus:ring-2 focus:ring-ring/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-border bg-card shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {pad(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-1 inline-flex rounded-full bg-muted/80 p-0.5">
              {(['AM', 'PM'] as const).map((p) => {
                const active = p === period
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePeriodChange(p)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-caption2 font-semibold transition-colors',
                      active
                        ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-8 rounded-full bg-primary px-4 text-caption font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
