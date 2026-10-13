import type { ReviewShift } from '@/services/adminDashboardService'

/** A sweep-closed shift with no activity has nothing to estimate from: say so instead of "0h". */
export function hoursLabel(shift: Pick<ReviewShift, 'clockOutMissing' | 'durationHours'>): string {
  if (shift.durationHours == null) return '—'
  if (shift.clockOutMissing) return shift.durationHours >= 0.1 ? `~${shift.durationHours}h` : 'End missing'
  return `${shift.durationHours}h`
}
