import { endOfDay, startOfDay } from 'date-fns'

import { supabase } from './supabase'
import { normalizeCleanerName } from '@/lib/identity'

export type AttendanceShift = {
  id: number
  cleanerName: string
  siteName: string
  customerName?: string | null
  clockIn: string
  clockOut: string | null
}

export type CleanerLogCalendarEntry = {
  id: number
  cleanerName?: string | null
  action?: string | null
  timestamp: string
  siteArea?: string | null
  customerName?: string | null
  comments?: string | null
}

const clampRange = (start: Date, end: Date) => {
  const safeStart = startOfDay(new Date(start))
  const safeEnd = endOfDay(new Date(end))

  if (safeStart > safeEnd) {
    return { start: safeEnd, end: endOfDay(safeEnd) }
  }

  return { start: safeStart, end: safeEnd }
}

export async function fetchAttendanceShiftsInRange(rangeStart: Date, rangeEnd: Date): Promise<AttendanceShift[]> {
  const { start, end } = clampRange(rangeStart, rangeEnd)

  const { data, error } = await supabase
    .from('time_attendance')
    .select('id, cleaner_name, site_name, customer_name, clock_in, clock_out')
    .gte('clock_in', start.toISOString())
    .lte('clock_in', end.toISOString())
    .order('clock_in', { ascending: true })

  if (error) {
    console.error('Failed to load attendance shifts for calendar', error)
    return []
  }

  return (data ?? [])
    .filter((row) => Boolean(row.clock_in))
    .map((row) => {
      const normalizedCleaner = normalizeCleanerName(row.cleaner_name || 'Unknown Cleaner')
      const siteName = row.site_name?.trim() || row.customer_name?.trim() || 'Unassigned Site'

      return {
        id: Number(row.id),
        cleanerName: normalizedCleaner,
        siteName,
        customerName: row.customer_name,
        clockIn: row.clock_in as string,
        clockOut: row.clock_out,
      }
    })
}

export async function fetchCleanerLogsInRange(rangeStart: Date, rangeEnd: Date): Promise<CleanerLogCalendarEntry[]> {
  const { start, end } = clampRange(rangeStart, rangeEnd)

  const { data, error } = await supabase
    .from('uk_cleaner_logs')
    .select('id, cleaner_name, action, comments, timestamp, customer_name, site_area')
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString())
    .order('timestamp', { ascending: true })
    .limit(2500)

  if (error) {
    console.error('Failed to load cleaner logs for calendar', error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: Number(row.id),
    cleanerName: row.cleaner_name ? normalizeCleanerName(row.cleaner_name) : null,
    action: row.action,
    timestamp: row.timestamp,
    siteArea: row.site_area,
    customerName: row.customer_name,
    comments: row.comments,
  }))
}


