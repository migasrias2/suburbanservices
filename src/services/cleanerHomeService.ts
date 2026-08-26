import { supabase } from './supabase'
import { fetchShiftsInRange, type CleanerShift } from './shiftsService'

/**
 * Everything the cleaner home screen needs, in one call.
 *
 * Cleaners used to land straight on a camera with no idea what the app thought
 * they were meant to be doing. This is the answer to "where am I, what have I
 * done, and what happens next".
 */
export interface CleanerToday {
  /** Open attendance row, if they are on the clock right now. */
  activeShift: {
    attendanceId: number
    siteName: string | null
    customerName: string | null
    clockInAt: string
    minutesElapsed: number
  } | null
  /** Shift rostered for today, whether or not they have clocked in for it. */
  todayShift: CleanerShift | null
  /** The next rostered shift after today, for the "nothing on today" case. */
  nextShift: CleanerShift | null
  areasCompletedToday: number
  tasksCompletedToday: number
  /** Shifts in the last 30 days flagged for payroll review. */
  flaggedShiftCount: number
}

const startOfToday = (): Date => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const parseTaskList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value as string[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function fetchCleanerToday(cleanerId: string): Promise<CleanerToday> {
  if (!cleanerId) throw new Error('A cleaner id is required')

  const dayStart = startOfToday()
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const horizon = new Date(dayStart)
  horizon.setDate(horizon.getDate() + 14)

  const thirtyDaysAgo = new Date(dayStart)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [attendanceRes, selectionsRes, flaggedRes, shifts] = await Promise.all([
    supabase
      .from('time_attendance')
      .select('id, site_name, customer_name, clock_in')
      .eq('cleaner_uuid', cleanerId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1),
    supabase
      .from('uk_cleaner_task_selections')
      .select('id, completed_tasks')
      .eq('cleaner_id', cleanerId)
      .gte('timestamp', dayStart.toISOString())
      .lt('timestamp', dayEnd.toISOString()),
    supabase
      .from('time_attendance')
      .select('id', { count: 'exact', head: true })
      .eq('cleaner_uuid', cleanerId)
      .eq('needs_review', true)
      .gte('clock_in', thirtyDaysAgo.toISOString()),
    // Today plus a fortnight, so "nothing today" can still say when they're next in.
    fetchShiftsInRange(dayStart, horizon, { cleanerId, publishedOnly: true }).catch((err) => {
      console.error('Could not load rostered shifts', err)
      return [] as CleanerShift[]
    }),
  ])

  if (attendanceRes.error) throw attendanceRes.error
  if (selectionsRes.error) throw selectionsRes.error

  const openRow = attendanceRes.data?.[0] ?? null
  const activeShift = openRow
    ? {
        attendanceId: openRow.id as number,
        siteName: (openRow.site_name as string | null) ?? null,
        customerName: (openRow.customer_name as string | null) ?? null,
        clockInAt: openRow.clock_in as string,
        minutesElapsed: Math.max(
          0,
          Math.round((Date.now() - new Date(openRow.clock_in as string).getTime()) / 60000),
        ),
      }
    : null

  const selections = (selectionsRes.data ?? []) as { id: number; completed_tasks: unknown }[]
  const tasksCompletedToday = selections.reduce(
    (sum, row) => sum + parseTaskList(row.completed_tasks).length,
    0,
  )

  const dayEndMs = dayEnd.getTime()
  const todayShift = shifts.find((s) => new Date(s.startAt).getTime() < dayEndMs) ?? null
  const nextShift = shifts.find((s) => new Date(s.startAt).getTime() >= dayEndMs) ?? null

  return {
    activeShift,
    todayShift,
    nextShift,
    areasCompletedToday: selections.length,
    tasksCompletedToday,
    flaggedShiftCount: flaggedRes.count ?? 0,
  }
}
