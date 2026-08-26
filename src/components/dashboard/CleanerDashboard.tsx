import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  QrCode,
  Sparkles,
} from 'lucide-react'
import { fetchCleanerToday, type CleanerToday } from '../../services/cleanerHomeService'
import { useOpenAssistCount } from '../../hooks/useOpenAssistCount'
import { Button } from '../ui/button'

interface CleanerDashboardProps {
  cleanerId: string
  cleanerName: string
}

const BRAND = '#00339B'

const formatElapsed = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

const greeting = (): string => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const firstNameOf = (fullName: string): string => fullName.trim().split(/\s+/)[0] || fullName

export const CleanerDashboard: React.FC<CleanerDashboardProps> = ({ cleanerId, cleanerName }) => {
  const navigate = useNavigate()
  const [today, setToday] = useState<CleanerToday | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const openAssistCount = useOpenAssistCount(true)

  const load = useCallback(async () => {
    try {
      setError(null)
      setToday(await fetchCleanerToday(cleanerId))
    } catch (err) {
      console.error('Could not load the cleaner home screen', err)
      setError("We couldn't load your shift just now. Pull down to try again.")
    } finally {
      setIsLoading(false)
    }
  }, [cleanerId])

  useEffect(() => {
    load()
    // The elapsed timer is the only thing that moves; a minute is frequent enough.
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  if (isLoading && !today) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-[#00339B]" />
      </div>
    )
  }

  const active = today?.activeShift ?? null
  const shift = today?.todayShift ?? null

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <header className="px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
          {format(new Date(), 'EEEE d MMMM')}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">
          {greeting()}, {firstNameOf(cleanerName)}
        </h1>
      </header>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          {error}
        </div>
      ) : null}

      {/* ---------- the one thing that matters right now ---------- */}
      {active ? (
        <section className="rounded-3xl bg-[#00339B] p-6 text-white shadow-[0_8px_30px_-12px_rgba(0,51,155,0.5)]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            On the clock
          </div>

          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums">
              {formatElapsed(active.minutesElapsed)}
            </span>
            <span className="text-[13px] text-white/70">
              since {format(new Date(active.clockInAt), 'h:mm a')}
            </span>
          </div>

          {active.siteName || active.customerName ? (
            <div className="mt-3 flex items-center gap-2 text-[13.5px] text-white/85">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {[active.customerName, active.siteName].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => navigate('/clock-in')}
              className="h-12 flex-1 rounded-full bg-white text-[15px] font-semibold text-[#00339B] shadow-none hover:bg-white/90"
            >
              <QrCode className="mr-2 h-4 w-4" />
              Carry on working
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.15)] ring-1 ring-black/[0.04]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            {shift ? 'Today’s shift' : 'Not clocked in'}
          </div>

          {shift ? (
            <>
              <div className="mt-2 text-[26px] font-semibold tracking-tight text-gray-900">
                {format(new Date(shift.startAt), 'h:mm')} – {format(new Date(shift.endAt), 'h:mm a')}
              </div>
              {shift.siteName || shift.customerName ? (
                <div className="mt-1.5 flex items-center gap-2 text-[13.5px] text-gray-500">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {[shift.customerName, shift.siteName].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ) : null}
              {shift.notes ? (
                <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-gray-50 p-3 text-[12.5px] leading-snug text-gray-600">
                  {shift.notes}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[14px] leading-snug text-gray-500">
              {today?.nextShift
                ? `Nothing rostered today. You’re next in on ${format(
                    new Date(today.nextShift.startAt),
                    'EEEE d MMM',
                  )} at ${format(new Date(today.nextShift.startAt), 'h:mm a')}.`
                : 'Nothing rostered today. You can still clock in if you’ve been asked to cover.'}
            </p>
          )}

          <Button
            onClick={() => navigate('/clock-in')}
            className="mt-5 h-12 w-full rounded-full text-[15px] font-semibold text-white shadow-none"
            style={{ backgroundColor: BRAND }}
          >
            <Clock className="mr-2 h-4 w-4" />
            Clock in
          </Button>
        </section>
      )}

      {/* ---------- what they've done today ---------- */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-2 text-gray-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-[0.08em]">Areas done</span>
          </div>
          <div className="mt-1.5 text-[28px] font-semibold leading-none tabular-nums text-gray-900">
            {today?.areasCompletedToday ?? 0}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-2 text-gray-400">
            <Sparkles className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-[0.08em]">Tasks done</span>
          </div>
          <div className="mt-1.5 text-[28px] font-semibold leading-none tabular-nums text-gray-900">
            {today?.tasksCompletedToday ?? 0}
          </div>
        </div>
      </section>

      {/* ---------- things wanting their attention ---------- */}
      {openAssistCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate('/cleaner-assistance')}
          className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-black/[0.04] transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[14.5px] font-semibold text-gray-900">
                {openAssistCount} bathroom {openAssistCount === 1 ? 'request' : 'requests'} waiting
              </div>
              <div className="text-[12.5px] text-gray-500">Tap to accept one</div>
            </div>
          </div>
          <span className="text-gray-300">›</span>
        </button>
      ) : null}

      {today && today.flaggedShiftCount > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-[14px] font-semibold text-amber-900">
            {today.flaggedShiftCount} of your recent {today.flaggedShiftCount === 1 ? 'shift needs' : 'shifts need'} checking
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-amber-800">
            They were recorded without a clock-out, so the hours may be wrong. Your manager has been
            sent these to confirm — speak to them if the times don’t look right to you.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => navigate('/my-schedule')}
        className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-black/[0.04] transition-shadow hover:shadow-md"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00339B]/10 text-[#00339B]">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[14.5px] font-semibold text-gray-900">My schedule</div>
            <div className="text-[12.5px] text-gray-500">This week and next</div>
          </div>
        </div>
        <span className="text-gray-300">›</span>
      </button>
    </div>
  )
}
