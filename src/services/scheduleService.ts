import { supabase } from './supabase'
import { normalizeCleanerName } from '@/lib/identity'
import { endOfWeek, startOfWeek } from 'date-fns'

export type WeeklyVisit = {
  id: string
  attendanceId: number
  cleanerName: string
  siteName: string
  customerName?: string | null
  clockIn: string
  clockOut: string | null
}

type AttendanceRow = {
  id: number
  cleaner_name: string | null
  site_name: string | null
  customer_name: string | null
  clock_in: string | null
  clock_out: string | null
}

const getWeekBounds = (date: Date) => {
  const start = startOfWeek(new Date(date), { weekStartsOn: 1 })
  start.setHours(0, 0, 0, 0)

  const end = endOfWeek(new Date(date), { weekStartsOn: 1 })
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

export async function fetchWeeklyVisits(targetDate: Date = new Date()): Promise<WeeklyVisit[]> {
  const { start, end } = getWeekBounds(targetDate)

  const { data, error } = await supabase
    .from('time_attendance')
    .select('id, cleaner_name, site_name, customer_name, clock_in, clock_out')
    .gte('clock_in', start.toISOString())
    .lte('clock_in', end.toISOString())
    .order('clock_in', { ascending: true })

  if (error) {
    console.error('Failed to load attendance for weekly visits', error)
    return []
  }

  const attendanceRows = (data ?? []) as AttendanceRow[]

  return attendanceRows
    .filter((row) => Boolean(row.clock_in))
    .map((row) => {
      const normalizedCleaner = normalizeCleanerName(row.cleaner_name || 'Unknown Cleaner')
      const siteName = row.site_name?.trim() || row.customer_name?.trim() || 'Unassigned Site'

      return {
        id: String(row.id),
        attendanceId: row.id,
        cleanerName: normalizedCleaner,
        siteName,
        customerName: row.customer_name,
        clockIn: row.clock_in as string,
        clockOut: row.clock_out,
      }
    })
}






