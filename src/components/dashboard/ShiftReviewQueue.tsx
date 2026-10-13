import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DateTimeField } from '@/components/schedule/DateTimeField'
import { useToast } from '@/components/ui/use-toast'
import type { ReviewShift } from '@/services/adminDashboardService'
import { setShiftClockOut, validateFinishTime } from '@/services/shiftReviewService'
import { hoursLabel } from '@/lib/shiftHours'

const VISIBLE_ROWS = 8

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Where the picker starts: two hours after the clock-in, never in the future. */
function defaultFinish(clockIn: string | null): Date {
  const start = clockIn ? new Date(clockIn).getTime() : Date.now()
  return new Date(Math.min(start + 2 * 3600_000, Date.now()))
}

interface ShiftReviewQueueProps {
  shifts: ReviewShift[]
  onChanged: () => Promise<void> | void
}

export function ShiftReviewQueue({ shifts, onChanged }: ShiftReviewQueueProps) {
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [finish, setFinish] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)

  if (!shifts.length) return null

  const startEditing = (shift: ReviewShift) => {
    setEditingId(shift.id)
    setFinish(defaultFinish(shift.clockIn))
  }

  const save = async (shift: ReviewShift) => {
    if (!finish || !shift.clockIn) return
    const problem = validateFinishTime(shift.clockIn, finish)
    if (problem) {
      toast({ title: 'Check the finish time', description: problem, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await setShiftClockOut(shift.id, finish)
      toast({ title: 'Finish time saved', description: `${shift.cleanerName ?? 'Shift'} now ends at ${formatDateTime(finish.toISOString())}.` })
      setEditingId(null)
      await onChanged()
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-warning">Shifts to check before payroll</h2>
        <span className="text-xs font-medium text-muted-foreground">{shifts.length}</span>
      </div>
      <div className="overflow-hidden rounded-3xl border border-warning/30 bg-warning/5">
        {shifts.slice(0, VISIBLE_ROWS).map((s, idx) => (
          <div key={s.id} className={`px-4 py-4 sm:px-5 ${idx > 0 ? 'border-t border-warning/30' : ''}`}>
            <div className="flex items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-medium text-foreground">{s.cleanerName ?? 'Unknown'}</span>
                  {s.clockOutMissing ? (
                    <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-caption2 font-semibold uppercase tracking-wider text-warning">
                      No clock-out
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[s.customerName, s.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                  {' · in '}
                  {formatDateTime(s.clockIn)}
                </div>
                {s.reviewReason ? <p className="mt-1 text-xs leading-snug text-warning">{s.reviewReason}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-semibold tabular-nums text-warning">{hoursLabel(s)}</div>
                <div className="text-caption2 uppercase tracking-wider text-muted-foreground">
                  {s.clockOutMissing ? 'estimated' : 'recorded'}
                </div>
              </div>
            </div>

            {editingId === s.id ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <DateTimeField id={`finish-${s.id}`} value={finish} onChange={setFinish} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-11 rounded-full sm:h-9" disabled={saving} onClick={() => save(s)}>
                    {saving ? 'Saving…' : 'Save finish time'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-11 rounded-full sm:h-9" disabled={saving} onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 rounded-full border-warning/40 text-warning hover:bg-warning/10 hover:text-warning sm:h-9"
                  onClick={() => startEditing(s)}
                >
                  {s.clockOutMissing ? 'Set finish time' : 'Correct finish time'}
                </Button>
              </div>
            )}
          </div>
        ))}
        {shifts.length > VISIBLE_ROWS ? (
          <div className="border-t border-warning/30 px-5 py-3 text-xs text-warning">
            + {shifts.length - VISIBLE_ROWS} more in the last 30 days
          </div>
        ) : null}
      </div>
    </section>
  )
}
