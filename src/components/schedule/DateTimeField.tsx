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
            'flex h-11 w-full items-center justify-between rounded-xl bg-gray-100/80 px-3.5 text-left text-[14px] text-gray-900 transition-colors',
            'focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/30',
            !safeValue && 'text-gray-400',
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.2)]"
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
            caption_label: 'text-[14px] font-semibold tracking-tight text-gray-900',
            nav: 'flex items-center gap-1',
            nav_button:
              'inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900',
            nav_button_previous: '',
            nav_button_next: '',
            table: 'w-full border-collapse',
            head_row: 'flex',
            head_cell:
              'flex h-7 w-9 items-center justify-center text-[10px] font-medium uppercase tracking-[0.06em] text-gray-400',
            row: 'flex w-full mt-1',
            cell: 'h-9 w-9 p-0 text-center',
            day: 'inline-flex h-9 w-9 items-center justify-center rounded-full text-[13px] text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none',
            day_selected:
              '!bg-[#007AFF] !text-white hover:!bg-[#0064D2] focus:!bg-[#0064D2]',
            day_today: 'font-semibold text-[#007AFF]',
            day_outside: 'text-gray-300',
            day_disabled: 'text-gray-300 opacity-50',
            day_hidden: 'invisible',
          }}
          components={{
            IconLeft: () => <ChevronLeft className="h-4 w-4" />,
            IconRight: () => <ChevronRight className="h-4 w-4" />,
          }}
        />

        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-400">
            Time
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Select value={String(hour12)} onValueChange={handleHourChange}>
              <SelectTrigger className="h-9 w-[68px] rounded-lg border-0 bg-gray-100/80 px-2.5 text-[13px] font-medium text-gray-900 shadow-none focus:ring-2 focus:ring-[#007AFF]/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-gray-100 bg-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[14px] font-semibold text-gray-400">:</span>
            <Select value={String(minute)} onValueChange={handleMinuteChange}>
              <SelectTrigger className="h-9 w-[68px] rounded-lg border-0 bg-gray-100/80 px-2.5 text-[13px] font-medium text-gray-900 shadow-none focus:ring-2 focus:ring-[#007AFF]/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-gray-100 bg-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {pad(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-1 inline-flex rounded-full bg-gray-100/80 p-0.5">
              {(['AM', 'PM'] as const).map((p) => {
                const active = p === period
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePeriodChange(p)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      active
                        ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                        : 'text-gray-500 hover:text-gray-700',
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
            className="h-8 rounded-full bg-[#007AFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0064D2]"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
