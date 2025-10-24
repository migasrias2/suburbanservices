import { supabase } from './supabase'
import { normalizeCleanerName } from '@/lib/identity'
import { getMockVisitsForWeek, type MockVisit } from '@/lib/mockSchedules'

export type WeeklyVisit = MockVisit & {
  clockIn?: string | null
  clockOut?: string | null
  attendanceId?: number
}

type AttendanceRow = {
  id: number
  cleaner_name: string | null
  site_name: string | null
  customer_name: string | null
  clock_in: string | null
  clock_out: string | null
}

const startOfWeek = (date: Date): Date => {
  const copy = new Date(date)
  const day = copy.getDay()
  const diff = copy.getDate() - day + 1
  copy.setDate(diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

const endOfWeek = (date: Date): Date => {
  const start = startOfWeek(date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

export const mapAttendanceToVisits = (
  visits: MockVisit[],
  attendance: AttendanceRow[],
): WeeklyVisit[] => {
  return visits.map((visit) => {
    const matchingAttendance = attendance.find((entry) => {
      const normalizedCleaner = normalizeCleanerName(entry.cleaner_name || '')
      const sameCleaner = normalizedCleaner.toLowerCase() === visit.cleanerName.toLowerCase()
      const sameSite = (entry.site_name || entry.customer_name || '').toLowerCase().includes(visit.siteName.toLowerCase())
      if (!sameCleaner || !sameSite) {
        return false
      }
      if (!entry.clock_in) {
        return false
      }
      const clockDate = new Date(entry.clock_in)
      return clockDate.getDay() === visit.dayOfWeek
    })

    if (matchingAttendance) {
      return {
        ...visit,
        clockIn: matchingAttendance.clock_in,
        clockOut: matchingAttendance.clock_out,
        attendanceId: matchingAttendance.id,
      }
    }

    return visit
  })
}

export async function fetchWeeklyVisits(): Promise<WeeklyVisit[]> {
  const visits = getMockVisitsForWeek()
  const today = new Date()
  const rangeStart = startOfWeek(today)
  const rangeEnd = endOfWeek(today)

  const { data, error } = await supabase
    .from('time_attendance')
    .select('id, cleaner_name, site_name, customer_name, clock_in, clock_out')
    .gte('clock_in', rangeStart.toISOString())
    .lte('clock_in', rangeEnd.toISOString())

  if (error) {
    console.warn('Failed to load attendance for weekly visits. Using mock data only.', error)
    return visits
  }

  const attendanceRows = (data ?? []) as AttendanceRow[]
  return mapAttendanceToVisits(visits, attendanceRows)
}

