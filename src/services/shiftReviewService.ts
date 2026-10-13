import { supabase } from './supabase'

export type ClockFailureEntry = {
  id: number
  cleanerName: string | null
  eventType: 'clock_in' | 'clock_out'
  reason: string
  customerName: string | null
  hasLocation: boolean | null
  createdAt: string
}

type ClockFailureRow = {
  id: number
  cleaner_name: string | null
  event_type: 'clock_in' | 'clock_out'
  reason: string
  customer_name: string | null
  has_location: boolean | null
  created_at: string
}

const MAX_SHIFT_HOURS = 16

/**
 * Checks a manager's finish time before it is sent. The database enforces the
 * same rules; checking here gives a readable message without a round trip.
 */
export function validateFinishTime(clockIn: string, finish: Date, now: Date = new Date()): string | null {
  const start = new Date(clockIn)
  if (Number.isNaN(finish.getTime())) return 'Enter a valid finish time.'
  if (finish.getTime() <= start.getTime()) return 'The finish time must be after the clock-in.'
  if (finish.getTime() - start.getTime() > MAX_SHIFT_HOURS * 3600_000) {
    return `The finish time is more than ${MAX_SHIFT_HOURS} hours after the clock-in.`
  }
  if (finish.getTime() > now.getTime()) return 'The finish time cannot be in the future.'
  return null
}

/** Sets the real finish time of a shift the cleaner never clocked out of. */
export async function setShiftClockOut(attendanceId: string, finish: Date): Promise<void> {
  const id = Number(attendanceId)
  if (!Number.isInteger(id)) throw new Error('This shift has an invalid id.')
  const { error } = await supabase.rpc('set_shift_clock_out', {
    p_attendance_id: id,
    p_clock_out: finish.toISOString(),
  })
  if (error) {
    console.error('Could not set the finish time', error)
    throw new Error(error.message || 'Could not save the finish time. Please try again.')
  }
}

/** Failed clock-ins/outs from the last few days, newest first. Empty if the log can't be read. */
export async function loadClockFailures(days = 7, limit = 30): Promise<ClockFailureEntry[]> {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('clock_event_failures')
    .select('id, cleaner_name, event_type, reason, customer_name, has_location, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('Could not load clock failures', error)
    return []
  }
  return ((data ?? []) as ClockFailureRow[]).map((row) => ({
    id: row.id,
    cleanerName: row.cleaner_name ?? null,
    eventType: row.event_type,
    reason: row.reason,
    customerName: row.customer_name ?? null,
    hasLocation: row.has_location ?? null,
    createdAt: row.created_at,
  }))
}
