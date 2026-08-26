import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock, X } from 'lucide-react'
import { useClockOutReminder } from '@/hooks/useClockOutReminder'

interface ClockOutReminderBannerProps {
  cleanerId: string
  enabled: boolean
}

const formatOverdue = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h >= 1 && m) return `${h}h ${m}m`
  if (h >= 1) return `${h}h`
  return `${m}m`
}

/**
 * Sits above every cleaner screen once their shift is past its expected end.
 * Deliberately not dismissible-forever: it comes back after half an hour,
 * because the cost of the nudge is far lower than the cost of a shift that
 * never closes.
 */
export const ClockOutReminderBanner: React.FC<ClockOutReminderBannerProps> = ({
  cleanerId,
  enabled,
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { isOverdue, minutesOverdue, basis, dismiss } = useClockOutReminder(cleanerId, enabled)

  if (!isOverdue) return null

  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-amber-900">
            You're still clocked in
          </p>
          <p className="text-[12.5px] leading-snug text-amber-800">
            {basis === 'rostered'
              ? `Your shift ended ${formatOverdue(minutesOverdue)} ago.`
              : `You've been on the clock for over ${formatOverdue(minutesOverdue)} past a normal shift.`}{' '}
            Scan the clock-out code so your hours are right.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        {location.pathname !== '/clock-in' ? (
          <button
            type="button"
            onClick={() => navigate('/clock-in')}
            className="rounded-full bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-amber-700"
          >
            Clock out
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Remind me later"
          className="rounded-full p-2 text-amber-700 transition-colors hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
