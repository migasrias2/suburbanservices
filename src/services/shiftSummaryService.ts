import { supabase } from './supabase'

export interface ShiftSummary {
  clockIn: string
  clockOut: string | null
  minutesWorked: number
  siteName: string | null
  customerName: string | null
  areasCompleted: number
  tasksCompleted: number
  photosTaken: number
  needsReview: boolean
}

export async function fetchShiftSummary(attendanceId: number): Promise<ShiftSummary | null> {
  const { data, error } = await supabase.rpc('shift_summary', { p_attendance_id: attendanceId })

  if (error) {
    console.error('Could not load the shift summary', error)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null

  return {
    clockIn: row.clock_in,
    clockOut: row.clock_out ?? null,
    minutesWorked: row.minutes_worked ?? 0,
    siteName: row.site_name ?? null,
    customerName: row.customer_name ?? null,
    areasCompleted: row.areas_completed ?? 0,
    tasksCompleted: row.tasks_completed ?? 0,
    photosTaken: row.photos_taken ?? 0,
    needsReview: row.needs_review === true,
  }
}

/**
 * Let the cleaner say the recorded hours look wrong, while they still remember
 * the shift. Flags it for the same payroll review queue the auto-close feeds.
 */
export async function flagOwnShift(attendanceId: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('flag_own_shift', {
    p_attendance_id: attendanceId,
    p_reason: reason,
  })

  if (error) {
    console.error('Could not flag the shift', error)
    throw new Error('We could not send that to your manager. Please try again.')
  }
}
