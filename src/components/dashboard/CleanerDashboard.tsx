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
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  const active = today?.activeShift ?? null
  const shift = today?.todayShift ?? null

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <header className="px-1">
        <p className="text-caption2 font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {format(new Date(), 'EEEE d MMMM')}
        </p>
        <h1 className="mt-1 text-title1 font-semibold tracking-tight text-foreground">
          {greeting()}, {firstNameOf(cleanerName)}
        </h1>
      </header>

      {error ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-footnote text-warning">
          {error}
        </div>
      ) : null}

      {/* ---------- the one thing that matters right now ---------- */}
      {active ? (
        <section className="rounded-3xl bg-primary p-6 text-primary-foreground shadow-[0_8px_30px_-12px_rgba(0,51,155,0.5)]">
          <div className="flex items-center gap-2 text-caption2 font-semibold uppercase tracking-[0.1em] text-primary-foreground/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            On the clock
          </div>

          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums">
              {formatElapsed(active.minutesElapsed)}
            </span>
            <span className="text-footnote text-primary-foreground/70">
              since {format(new Date(active.clockInAt), 'h:mm a')}
            </span>
          </div>

          {active.siteName || active.customerName ? (
            <div className="mt-3 flex items-center gap-2 text-footnote text-primary-foreground/85">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {[active.customerName, active.siteName].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => navigate('/clock-in')}
              className="h-12 flex-1 rounded-full bg-card text-subheadline font-semibold text-primary shadow-none hover:bg-card/90"
            >
              <QrCode className="mr-2 h-4 w-4" />
              Carry on working
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.15)] ring-1 ring-border/[0.04]">
          <div className="text-caption2 font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {shift ? 'Today’s shift' : 'Not clocked in'}
          </div>

          {shift ? (
            <>
              <div className="mt-2 text-title1 font-semibold tracking-tight text-foreground">
                {format(new Date(shift.startAt), 'h:mm')} – {format(new Date(shift.endAt), 'h:mm a')}
              </div>
              {shift.siteName || shift.customerName ? (
                <div className="mt-1.5 flex items-center gap-2 text-footnote text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {[shift.customerName, shift.siteName].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ) : null}
              {shift.notes ? (
                <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-muted p-3 text-caption leading-snug text-muted-foreground">
                  {shift.notes}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-subheadline leading-snug text-muted-foreground">
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
            className="mt-5 h-12 w-full rounded-full bg-primary text-subheadline font-semibold text-primary-foreground shadow-none"
          >
            <Clock className="mr-2 h-4 w-4" />
            Clock in
          </Button>
        </section>
      )}

      {/* ---------- what they've done today ---------- */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border/[0.04]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-caption2 font-medium uppercase tracking-[0.08em]">Areas done</span>
          </div>
          <div className="mt-1.5 text-title1 font-semibold leading-none tabular-nums text-foreground">
            {today?.areasCompletedToday ?? 0}
          </div>
        </div>
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border/[0.04]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span className="text-caption2 font-medium uppercase tracking-[0.08em]">Tasks done</span>
          </div>
          <div className="mt-1.5 text-title1 font-semibold leading-none tabular-nums text-foreground">
            {today?.tasksCompletedToday ?? 0}
          </div>
        </div>
      </section>

      {/* ---------- things wanting their attention ---------- */}
      {openAssistCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate('/cleaner-assistance')}
          className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border/[0.04] transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <div className="text-subheadline font-semibold text-foreground">
                {openAssistCount} bathroom {openAssistCount === 1 ? 'request' : 'requests'} waiting
              </div>
              <div className="text-caption text-muted-foreground">Tap to accept one</div>
            </div>
          </div>
          <span className="text-muted-foreground">›</span>
        </button>
      ) : null}

      {today && today.flaggedShiftCount > 0 ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <div className="text-subheadline font-semibold text-warning">
            {today.flaggedShiftCount} of your recent {today.flaggedShiftCount === 1 ? 'shift needs' : 'shifts need'} checking
          </div>
          <p className="mt-1 text-caption leading-snug text-warning">
            They were recorded without a clock-out, so the hours may be wrong. Your manager has been
            sent these to confirm — speak to them if the times don’t look right to you.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => navigate('/my-schedule')}
        className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border/[0.04] transition-shadow hover:shadow-md"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <div className="text-subheadline font-semibold text-foreground">My schedule</div>
            <div className="text-caption text-muted-foreground">This week and next</div>
          </div>
        </div>
        <span className="text-muted-foreground">›</span>
      </button>
    </div>
  )
}
