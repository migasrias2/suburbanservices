import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CheckCircle2, Flag, MapPin } from 'lucide-react'
import {
  fetchShiftSummary,
  findLatestClosedShiftId,
  flagOwnShift,
  type ShiftSummary,
} from '../../services/shiftSummaryService'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

interface ShiftSummaryCardProps {
  cleanerId: string
  cleanerName: string
  onDone: () => void
}

const formatWorked = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/**
 * Shown once the cleaner has clocked out. Two jobs: give them a record of their
 * own shift, and let them dispute the hours immediately rather than finding out
 * weeks later on a payslip.
 */
export const ShiftSummaryCard: React.FC<ShiftSummaryCardProps> = ({
  cleanerId,
  cleanerName,
  onDone,
}) => {
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [attendanceId, setAttendanceId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isFlagging, setIsFlagging] = useState(false)
  const [reason, setReason] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const id = await findLatestClosedShiftId(cleanerId)
      if (cancelled) return
      setAttendanceId(id)
      if (id != null) {
        const data = await fetchShiftSummary(id)
        if (!cancelled) setSummary(data)
      }
      if (!cancelled) setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [cleanerId])

  const submitFlag = async () => {
    if (!attendanceId || !reason.trim()) return
    try {
      setError(null)
      await flagOwnShift(attendanceId, reason)
      setFlagged(true)
      setIsFlagging(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-5">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h1 className="mt-4 text-title1 font-semibold tracking-tight text-foreground">
          Clocked out
        </h1>
        <p className="mt-1 text-subheadline text-muted-foreground">Thanks {cleanerName.split(' ')[0]} — here's your shift.</p>
      </div>

      {isLoading ? (
        <div className="rounded-3xl bg-card p-6 text-center text-footnote text-muted-foreground ring-1 ring-border/[0.04]">
          Loading your shift…
        </div>
      ) : !summary ? (
        <div className="rounded-3xl bg-card p-6 text-center text-footnote text-muted-foreground ring-1 ring-border/[0.04]">
          You're clocked out. We couldn't pull up the summary just now, but your shift has been saved.
        </div>
      ) : (
        <div className="rounded-3xl bg-card p-6 ring-1 ring-border/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.15)]">
          <div className="text-caption2 font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Hours worked
          </div>
          <div className="mt-1 text-[38px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {formatWorked(summary.minutesWorked)}
          </div>
          <div className="mt-1.5 text-footnote text-muted-foreground">
            {format(new Date(summary.clockIn), 'h:mm a')} –{' '}
            {summary.clockOut ? format(new Date(summary.clockOut), 'h:mm a') : 'now'}
          </div>

          {summary.siteName || summary.customerName ? (
            <div className="mt-3 flex items-center gap-2 text-footnote text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {[summary.customerName, summary.siteName].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-5">
            {[
              { label: 'Areas', value: summary.areasCompleted },
              { label: 'Tasks', value: summary.tasksCompleted },
              { label: 'Photos', value: summary.photosTaken },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-[24px] font-semibold leading-none tabular-nums text-foreground">
                  {stat.value}
                </div>
                <div className="mt-1 text-caption2 font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {flagged ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-footnote text-warning">
          Sent to your manager. They'll check the hours and come back to you.
        </div>
      ) : isFlagging ? (
        <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border/[0.04]">
          <label htmlFor="flag-reason" className="block text-footnote font-semibold text-foreground">
            What doesn't look right?
          </label>
          <Textarea
            id="flag-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. I started at 6am but it says 7am"
            className="min-h-[88px] rounded-2xl text-subheadline"
          />
          {error ? <p className="text-caption text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              onClick={submitFlag}
              disabled={!reason.trim()}
              className="h-11 flex-1 rounded-full bg-primary text-subheadline font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Send to my manager
            </Button>
            <Button
              variant="ghost"
              onClick={() => setIsFlagging(false)}
              className="h-11 rounded-full text-subheadline text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setIsFlagging(true)}
          disabled={attendanceId == null}
          className="h-11 w-full rounded-full border-border text-footnote font-medium text-muted-foreground"
        >
          <Flag className="mr-2 h-4 w-4" />
          These hours don't look right
        </Button>
      )}

      <Button
        onClick={onDone}
        className="h-12 w-full rounded-full bg-foreground text-subheadline font-semibold text-background hover:bg-foreground"
      >
        Done
      </Button>
    </div>
  )
}
