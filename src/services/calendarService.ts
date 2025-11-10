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

export type OpsManagerShift = {
  id: number
  attendanceId: number
  opsManagerId: string | null
  opsManagerName: string
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

type OpsManagerDirectoryRow = {
  id?: string | null
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  employee_id?: string | null
  mobile_number?: string | null
  role?: string | null
  manager_type?: string | null
  user_type?: string | null
  is_active?: boolean | null
}

const normalizeAliasValue = (value?: string | number | null) => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return trimmed.toLowerCase()
}

export async function fetchOpsManagerShiftsInRange(rangeStart: Date, rangeEnd: Date): Promise<OpsManagerShift[]> {
  const { start, end } = clampRange(rangeStart, rangeEnd)

  const opsManagersQuery = supabase
    .from('managers')
    .select('id, first_name, last_name, username, employee_id, mobile_number, role, manager_type, user_type, is_active')
    .or('role.eq.ops_manager,manager_type.eq.ops_manager,user_type.eq.ops_manager')

  const attendanceQuery = supabase
    .from('time_attendance')
    .select('id, cleaner_id, cleaner_uuid, cleaner_name, cleaner_mobile, customer_name, site_name, clock_in, clock_out')
    .gte('clock_in', start.toISOString())
    .lte('clock_in', end.toISOString())
    .order('clock_in', { ascending: true })

  const [opsManagersRes, attendanceRes] = await Promise.all([opsManagersQuery, attendanceQuery])

  if (attendanceRes.error) {
    console.error('Failed to load attendance shifts for ops managers', attendanceRes.error)
    return []
  }

  if (opsManagersRes.error) {
    console.warn('Unable to load ops manager directory; falling back to empty result set', opsManagersRes.error)
    return []
  }

  const opsManagerRows = Array.isArray(opsManagersRes.data)
    ? ((opsManagersRes.data ?? []) as OpsManagerDirectoryRow[])
    : []

  if (!opsManagerRows.length) {
    return []
  }

  const opsManagers = opsManagerRows
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const id = row.id?.toString().trim() || null
      const first = row.first_name?.trim() || ''
      const last = row.last_name?.trim() || ''
      const displayNameCandidate = `${first} ${last}`.trim()
      const fallbackDisplay =
        row.username?.trim() || row.employee_id?.trim() || row.mobile_number?.trim() || 'Ops Manager'
      const displayName = normalizeCleanerName(displayNameCandidate || fallbackDisplay)
      const aliases = new Set<string>()

      ;[id, row.username, row.employee_id, row.mobile_number, displayNameCandidate, displayName]
        .map((value) => normalizeAliasValue(value))
        .forEach((alias) => {
          if (alias) {
            aliases.add(alias)
          }
        })

      return {
        id,
        displayName,
        aliases,
      }
    })

  const aliasDirectory = new Map<string, { id: string | null; displayName: string }>()
  opsManagers.forEach((manager) => {
    manager.aliases.forEach((alias) => {
      if (!aliasDirectory.has(alias)) {
        aliasDirectory.set(alias, { id: manager.id, displayName: manager.displayName })
      }
    })
  })

  if (!aliasDirectory.size) {
    return []
  }

  const attendanceRows = (attendanceRes.data ?? []) as Array<{
    id: number | string
    cleaner_id?: string | number | null
    cleaner_uuid?: string | null
    cleaner_name?: string | null
    cleaner_mobile?: string | null
    customer_name?: string | null
    site_name?: string | null
    clock_in?: string | null
    clock_out?: string | null
  }>

  return attendanceRows
    .filter((row) => Boolean(row.clock_in))
    .map((row) => {
      const candidateAliases = new Set<string>()
      ;[
        row.cleaner_uuid,
        row.cleaner_id,
        row.cleaner_name,
        row.cleaner_mobile,
        normalizeCleanerName(row.cleaner_name || undefined),
      ]
        .map((value) => normalizeAliasValue(value))
        .forEach((alias) => {
          if (alias) {
            candidateAliases.add(alias)
          }
        })

      let matched: { id: string | null; displayName: string } | null = null

      candidateAliases.forEach((alias) => {
        if (matched) return
        if (aliasDirectory.has(alias)) {
          matched = aliasDirectory.get(alias) ?? null
        }
      })

      if (!matched) {
        return null
      }

      const siteName = row.site_name?.trim() || row.customer_name?.trim() || 'Unassigned Site'

      return {
        id: Number(row.id),
        attendanceId: Number(row.id),
        opsManagerId: matched.id,
        opsManagerName: matched.displayName,
        siteName,
        customerName: row.customer_name,
        clockIn: row.clock_in as string,
        clockOut: row.clock_out ?? null,
      } as OpsManagerShift
    })
    .filter((shift): shift is OpsManagerShift => Boolean(shift))
}


