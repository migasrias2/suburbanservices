import { supabase } from './supabase'
import {
  fetchManagerCleanerIds,
  fetchCleanersByIds,
  fetchAllCleaners,
  type CleanerSummary,
} from './managerService'
import {
  getScheduleForCleaner,
  isClockInOnTime,
} from '../lib/analyticsSchedule'
import { normalizeCleanerName, normalizeCleanerNumericId } from '../lib/identity'

export type AnalyticsRole = 'manager' | 'ops_manager' | 'admin'

export type AnalyticsRange = {
  start: string
  end: string
}

export type AttendanceRecord = {
  id: number
  cleaner_id: string | number | null
  cleaner_uuid: string | null
  cleaner_name: string
  customer_name: string | null
  site_name: string | null
  clock_in: string | null
  clock_out: string | null
}

export type TaskSelectionRecord = {
  id: number
  cleaner_id: string
  cleaner_name: string | null
  qr_code_id: string | null
  area_type: string | null
  selected_tasks: string | null
  completed_tasks: string | null
  timestamp: string | null
}

export type TaskPhotoRecord = {
  id: number
  cleaner_id: string
  cleaner_name: string | null
  qr_code_id: string | null
  task_id: string | null
  area_type: string | null
  photo_timestamp: string | null
}

type ComplianceTrendPoint = {
  date: string
  compliance: number
  total: number
  completed: number
}

type CleanerRate = {
  cleanerId: string
  cleanerName: string
  rate: number
  total: number
  value: number
}

type AreaDuration = {
  label: string
  avgMinutes: number
  samples: number
}

type DailyHoursPoint = {
  date: string
  hours: number
}

export type AnalyticsSummary = {
  roster: CleanerSummary[]
  totals: {
    complianceRate: number | null
    onTimeRate: number | null
    photoComplianceRate: number | null
    totalHoursWorked: number
  }
  trend: ComplianceTrendPoint[]
  onTimeByCleaner: CleanerRate[]
  taskCompletionByArea: AreaDuration[]
  photoComplianceBreakdown: {
    withPhoto: number
    withoutPhoto: number
  }
  hoursByDate: DailyHoursPoint[]
}

export type DashboardSnapshot = {
  date: string
  isCurrentDay: boolean
  cleanersOnline: number | null
  areasCleaned: number
  photosTaken: number
  hoursWorked: number
  attendanceCount: number
  hoursBreakdown?: {
    cleanerName: string
    siteName: string
    hours: number
  }[]
}

export type DashboardSnapshotParams = {
  managerId?: string | null
  role: AnalyticsRole
  dayIso: string
}

export type FetchAnalyticsParams = {
  managerId?: string | null
  role: AnalyticsRole
  range: AnalyticsRange
}

const toDateKey = (iso?: string | null) => {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return d.toISOString().slice(0, 10)
}

type HoursBetweenOptions = {
  fallbackEnd?: string | Date | null
  clampEnd?: string | Date | null
}

const toValidDate = (value?: string | Date | null): Date | null => {
  if (!value) return null
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? null : value
  }
  const date = new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : date
}

const minutesBetween = (start?: string | null, end?: string | null, options?: HoursBetweenOptions): number | null => {
  const startDate = toValidDate(start)
  if (!startDate) return null

  let endDate = toValidDate(end)
  if (!endDate && options?.fallbackEnd) {
    endDate = toValidDate(options.fallbackEnd)
  }

  if (!endDate) return null

  const clampEndDate = toValidDate(options?.clampEnd ?? null)
  if (clampEndDate) {
    const clampTime = clampEndDate.getTime()
    if (clampTime <= startDate.getTime()) {
      return null
    }
    if (endDate.getTime() > clampTime) {
      endDate = new Date(clampTime)
    }
  }

  const diff = endDate.getTime() - startDate.getTime()
  if (!Number.isFinite(diff) || diff <= 0) return null
  return diff / (1000 * 60)
}

const hoursBetween = (start?: string | null, end?: string | null, options?: HoursBetweenOptions): number | null => {
  const minutes = minutesBetween(start, end, options)
  return minutes === null ? null : minutes / 60
}

const parseTasks = (value?: string | null): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch (error) {
    console.warn('Failed to parse task list', error)
  }
  return []
}

const ensureUniqueCleanerSummaries = (records: CleanerSummary[]): CleanerSummary[] => {
  const map = new Map<string, CleanerSummary>()
  records.forEach((record) => {
    map.set(record.id, record)
  })
  return Array.from(map.values())
}

const parseLocalDayIso = (dayIso: string): Date => {
  const [year, month, day] = dayIso.split('-').map((value) => Number.parseInt(value, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid dayIso provided: ${dayIso}`)
  }
  const localDate = new Date(year, month - 1, day)
  if (Number.isNaN(localDate.getTime())) {
    throw new Error(`Invalid dayIso provided: ${dayIso}`)
  }
  return localDate
}

const toDayBounds = (dayIso: string): { start: string; end: string } => {
  const base = parseLocalDayIso(dayIso)
  const start = new Date(base)
  start.setHours(0, 0, 0, 0)
  const end = new Date(base)
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

const isSameCalendarDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

const buildCleanerScope = async (managerId: string | undefined | null, role: AnalyticsRole) => {
  const isGlobalRole = role === 'admin' || role === 'ops_manager'
  let roster: CleanerSummary[]
  let scopedCleanerIds: string[] = []

  if (isGlobalRole) {
    roster = await fetchAllCleaners()
  } else {
    scopedCleanerIds = await fetchManagerCleanerIds(managerId ?? '')
    if (scopedCleanerIds.length) {
      roster = await fetchCleanersByIds(scopedCleanerIds)
    } else {
      roster = await fetchAllCleaners()
    }
  }

  roster = ensureUniqueCleanerSummaries(roster)

  const restrictToManaged = !isGlobalRole && scopedCleanerIds.length > 0
  const cleanerIdSet = new Set(scopedCleanerIds.filter(Boolean))
  const numericCleanerIdSet = new Set(
    scopedCleanerIds
      .map((id) => normalizeCleanerNumericId(id))
      .filter((value): value is number => value !== null),
  )

  const rosterNameSet = new Set<string>()

  roster.forEach((cleaner) => {
    const name = normalizeCleanerName(`${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`)
    rosterNameSet.add(name)
  })

  const matchesCleanerScope = (row: { cleaner_id?: string | number | null; cleaner_name?: string | null }) => {
    if (!restrictToManaged) return true

    if (row.cleaner_id !== null && row.cleaner_id !== undefined) {
      const stringId = String(row.cleaner_id)
      if (cleanerIdSet.has(stringId)) {
        return true
      }
      const numericId = normalizeCleanerNumericId(stringId)
      if (numericId !== null && numericCleanerIdSet.has(numericId)) {
        return true
      }
    }

    if (row.cleaner_name) {
      const normalizedName = normalizeCleanerName(row.cleaner_name)
      if (rosterNameSet.has(normalizedName)) {
        return true
      }
    }

    return false
  }

  return {
    roster,
    matchesCleanerScope,
    restrictToManaged,
  }
}

export async function fetchDashboardSnapshot({ managerId, role, dayIso }: DashboardSnapshotParams): Promise<DashboardSnapshot> {
  const day = parseLocalDayIso(dayIso)

  const today = new Date()
  const isCurrentDay = isSameCalendarDay(day, today)
  const { start, end } = toDayBounds(dayIso)

  const scope = await buildCleanerScope(managerId ?? undefined, role)

  const attendanceQuery = supabase
    .from('time_attendance')
    .select('id, cleaner_id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out')
    .gte('clock_in', start)
    .lte('clock_in', end)

  const selectionsQuery = supabase
    .from('uk_cleaner_task_selections')
    .select('id, cleaner_id, cleaner_name, completed_tasks, timestamp')
    .gte('timestamp', start)
    .lte('timestamp', end)

  const photosQuery = supabase
    .from('uk_cleaner_task_photos')
    .select('id, cleaner_id, cleaner_name, photo_timestamp')
    .gte('photo_timestamp', start)
    .lte('photo_timestamp', end)

  const [attendanceRes, selectionsRes, photosRes] = await Promise.all([attendanceQuery, selectionsQuery, photosQuery])

  if (attendanceRes.error) {
    throw attendanceRes.error
  }
  if (selectionsRes.error) {
    throw selectionsRes.error
  }
  if (photosRes.error) {
    throw photosRes.error
  }

  const attendanceRows = (attendanceRes.data ?? []).filter((row) =>
    scope.matchesCleanerScope({ cleaner_id: row.cleaner_uuid ?? row.cleaner_id, cleaner_name: row.cleaner_name }),
  )
  const selectionRows = (selectionsRes.data ?? []).filter((row) =>
    scope.matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name }),
  )
  const photoRows = (photosRes.data ?? []).filter((row) =>
    scope.matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name }),
  )

  let cleanersOnline: number | null = null
  if (isCurrentDay) {
    const activeAttendanceKeys = new Set<string>()

    attendanceRows.forEach((row) => {
      if (!row.clock_in) return
      if (row.clock_out) return
      const key = row.cleaner_uuid ?? row.cleaner_id ?? row.cleaner_name
      if (!key) return
      activeAttendanceKeys.add(String(key))
    })

    cleanersOnline = activeAttendanceKeys.size
  }

  const areasCleaned = selectionRows.reduce((count, row) => {
    const completed = parseTasks(row.completed_tasks)
    return completed.length > 0 ? count + 1 : count
  }, 0)

  const photosTaken = photoRows.length

  const parsedDayEnd = new Date(end)
  const hasValidDayEnd = !Number.isNaN(parsedDayEnd.getTime())
  const fallbackNowForOpenShifts = isCurrentDay
    ? new Date(hasValidDayEnd ? Math.min(Date.now(), parsedDayEnd.getTime()) : Date.now())
    : null

  const hoursBreakdown: { cleanerName: string; siteName: string; hours: number }[] = []

  const hoursWorked = attendanceRows.reduce((total, row) => {
    const hours = hoursBetween(row.clock_in, row.clock_out, {
      fallbackEnd: !row.clock_out ? fallbackNowForOpenShifts : undefined,
      clampEnd: hasValidDayEnd ? parsedDayEnd : undefined,
    })
    if (hours) {
      hoursBreakdown.push({
        cleanerName: row.cleaner_name || 'Unknown Cleaner',
        siteName: row.site_name || 'Unknown Site',
        hours: hours,
      })
      return total + hours
    }
    return total
  }, 0)

  return {
    date: day.toISOString(),
    isCurrentDay,
    cleanersOnline,
    areasCleaned,
    photosTaken,
    hoursWorked: Number(hoursWorked.toFixed(2)),
    attendanceCount: attendanceRows.length,
    hoursBreakdown,
  }
}

export async function fetchAnalyticsSummary({ managerId, role, range }: FetchAnalyticsParams): Promise<AnalyticsSummary> {
  const isGlobalRole = role === 'admin' || role === 'ops_manager'

  let roster: CleanerSummary[]
  let cleanerIds: string[] = []
  let managerScopedCleanerIds: string[] = []

  if (isGlobalRole) {
    roster = await fetchAllCleaners()
    cleanerIds = roster.map((cleaner) => cleaner.id)
  } else {
    managerScopedCleanerIds = await fetchManagerCleanerIds(managerId ?? '')
    if (managerScopedCleanerIds.length) {
      roster = await fetchCleanersByIds(managerScopedCleanerIds)
      cleanerIds = managerScopedCleanerIds
    } else {
      roster = await fetchAllCleaners()
      cleanerIds = roster.map((cleaner) => cleaner.id)
    }
  }

  roster = ensureUniqueCleanerSummaries(roster)

  const restrictToManagedCleaners = !isGlobalRole && managerScopedCleanerIds.length > 0
  const filterCleanerIds = restrictToManagedCleaners ? managerScopedCleanerIds : []
  const cleanerIdSet = new Set(filterCleanerIds.filter(Boolean))
  const numericCleanerIds = filterCleanerIds
    .map((id) => normalizeCleanerNumericId(id))
    .filter((value): value is number => value !== null)
  const numericCleanerIdSet = new Set(numericCleanerIds)

  const attendanceQuery = supabase
    .from('time_attendance')
    .select('id, cleaner_id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out')
    .gte('clock_in', range.start)
    .lte('clock_in', range.end)

  let selectionsQuery = supabase
    .from('uk_cleaner_task_selections')
    .select('id, cleaner_id, cleaner_name, qr_code_id, area_type, selected_tasks, completed_tasks, timestamp')
    .gte('timestamp', range.start)
    .lte('timestamp', range.end)

  if (!isGlobalRole && cleanerIds.length) {
    selectionsQuery = selectionsQuery.in('cleaner_id', cleanerIds)
  }

  let photosQuery = supabase
    .from('uk_cleaner_task_photos')
    .select('id, cleaner_id, cleaner_name, qr_code_id, task_id, area_type, photo_timestamp')
    .gte('photo_timestamp', range.start)
    .lte('photo_timestamp', range.end)

  if (!isGlobalRole && cleanerIds.length) {
    photosQuery = photosQuery.in('cleaner_id', cleanerIds)
  }

  const [attendanceRes, selectionsRes, photosRes] = await Promise.all([
    attendanceQuery,
    selectionsQuery,
    photosQuery,
  ])

  if (attendanceRes.error) {
    throw attendanceRes.error
  }
  if (selectionsRes.error) {
    throw selectionsRes.error
  }
  if (photosRes.error) {
    throw photosRes.error
  }

  const rawAttendance = (attendanceRes.data ?? []) as AttendanceRecord[]
  const rawSelections = (selectionsRes.data ?? []) as TaskSelectionRecord[]
  const rawPhotos = (photosRes.data ?? []) as TaskPhotoRecord[]

  const rosterNames = new Map<string, string>()
  const rosterNameSet = new Set<string>()
  roster.forEach((cleaner) => {
    const normalizedName = normalizeCleanerName(`${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`)
    rosterNames.set(cleaner.id, normalizedName)
    rosterNameSet.add(normalizedName)
  })

  type ScopedCleanerRow = {
    cleaner_uuid?: string | null
    cleaner_id?: string | number | null
    cleaner_name?: string | null
  }

  const matchesCleanerScope = (row: ScopedCleanerRow): boolean => {
    if (!restrictToManagedCleaners) {
      return true
    }

    const candidateUuid = row.cleaner_uuid ?? null
    if (candidateUuid && cleanerIdSet.has(candidateUuid)) {
      return true
    }

    const rawCleanerId = row.cleaner_id
    if (rawCleanerId !== null && rawCleanerId !== undefined) {
      const cleanerIdString = String(rawCleanerId)
      if (cleanerIdSet.has(cleanerIdString)) {
        return true
      }
      const numericCandidate = normalizeCleanerNumericId(cleanerIdString)
      if (numericCandidate !== null && numericCleanerIdSet.has(numericCandidate)) {
        return true
      }
    }

    if (candidateUuid) {
      const numericFromUuid = normalizeCleanerNumericId(candidateUuid)
      if (numericFromUuid !== null && numericCleanerIdSet.has(numericFromUuid)) {
        return true
      }
    }

    if (row.cleaner_name) {
      const normalizedRowName = normalizeCleanerName(row.cleaner_name)
      if (rosterNameSet.has(normalizedRowName)) {
        return true
      }
    }

    return false
  }

  const attendance = restrictToManagedCleaners ? rawAttendance.filter((row) => matchesCleanerScope(row)) : rawAttendance
  const selections = restrictToManagedCleaners
    ? rawSelections.filter((row) =>
        matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name ?? null })
      )
    : rawSelections
  const photos = restrictToManagedCleaners
    ? rawPhotos.filter((row) => matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name ?? null }))
    : rawPhotos

  const complianceByDate = new Map<string, { total: number; completed: number }>()
  let totalAttendance = 0
  let totalCompleted = 0
  let totalOnTime = 0
  let totalOnTimeEligible = 0
  let totalHoursWorked = 0

  const onTimeByCleaner = new Map<string, { onTime: number; total: number }>()
  const hoursByDate = new Map<string, number>()
  const now = new Date()

  attendance.forEach((row) => {
    const dateKey = toDateKey(row.clock_in ?? row.clock_out)
    if (!complianceByDate.has(dateKey)) {
      complianceByDate.set(dateKey, { total: 0, completed: 0 })
    }
    const dateAggregate = complianceByDate.get(dateKey)!
    dateAggregate.total += 1
    totalAttendance += 1

    const isCompleted = Boolean(row.clock_in && row.clock_out)
    if (isCompleted) {
      dateAggregate.completed += 1
      totalCompleted += 1
    }

    const cleanerIdFromRow = row.cleaner_uuid ?? (row.cleaner_id !== null && row.cleaner_id !== undefined ? String(row.cleaner_id) : '')
    const cleanerName = cleanerIdFromRow
      ? rosterNames.get(cleanerIdFromRow) ?? normalizeCleanerName(row.cleaner_name)
      : normalizeCleanerName(row.cleaner_name)

    const referenceIso = row.clock_in ?? row.clock_out
    const referenceDate = referenceIso ? new Date(referenceIso) : null
    const isRowCurrentDay = referenceDate ? isSameCalendarDay(referenceDate, now) : false

    const hours = hoursBetween(row.clock_in, row.clock_out, {
      fallbackEnd: !row.clock_out && isRowCurrentDay ? now : undefined,
      clampEnd: range.end,
    })
    if (hours) {
      totalHoursWorked += hours
      const dateTotal = hoursByDate.get(dateKey) ?? 0
      hoursByDate.set(dateKey, dateTotal + hours)
    }

    const schedule = getScheduleForCleaner(cleanerName)
    if (schedule) {
      totalOnTimeEligible += 1
      const onTime = isClockInOnTime(row.clock_in, cleanerName)
      if (onTime) {
        totalOnTime += 1
      }
      const cleanerKey = cleanerIdFromRow || cleanerName
      const cleanerAggregate = onTimeByCleaner.get(cleanerKey) ?? { onTime: 0, total: 0 }
      cleanerAggregate.total += 1
      if (onTime) {
        cleanerAggregate.onTime += 1
      }
      onTimeByCleaner.set(cleanerKey, cleanerAggregate)
    }
  })

  const trend: ComplianceTrendPoint[] = Array.from(complianceByDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({
      date,
      compliance: value.total ? Math.round((value.completed / value.total) * 100) : 0,
      total: value.total,
      completed: value.completed,
    }))

  const onTimeRates: CleanerRate[] = Array.from(onTimeByCleaner.entries()).map(([cleanerKey, value]) => {
    const cleanerName = rosterNames.get(cleanerKey) ?? cleanerKey
    return {
      cleanerId: cleanerKey,
      cleanerName,
      rate: value.total ? Math.round((value.onTime / value.total) * 100) : 0,
      total: value.total,
      value: value.onTime,
    }
  })

  roster.forEach((cleaner) => {
    const rosterId = cleaner.id
    const rosterName = normalizeCleanerName(`${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`)
    const hasById = onTimeByCleaner.has(rosterId)
    const hasByName = onTimeByCleaner.has(rosterName)

    if (!hasById && !hasByName) {
      onTimeRates.push({
        cleanerId: rosterId,
        cleanerName: rosterName,
        rate: 0,
        total: 0,
        value: 0,
      })
    }
  })

  const hoursByDateSeries: DailyHoursPoint[] = Array.from(hoursByDate.entries())
    .map(([date, value]) => ({
      date,
      hours: Number(value.toFixed(2)),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const photosByCleaner = new Map<string, TaskPhotoRecord[]>()
  photos.forEach((photo) => {
    const key = photo.cleaner_id || photo.cleaner_name || 'unknown'
    if (!photosByCleaner.has(key)) {
      photosByCleaner.set(key, [])
    }
    photosByCleaner.get(key)!.push(photo)
  })

  let totalTasksWithPhotos = 0
  let totalTasksWithoutPhotos = 0

  const areaDurations = new Map<string, { totalMinutes: number; samples: number }>()

  selections.forEach((selection) => {
    const selectedTasks = parseTasks(selection.selected_tasks)
    const completedTasks = parseTasks(selection.completed_tasks)
    if (!selectedTasks.length) {
      return
    }

    const cleanerKey = selection.cleaner_id || selection.cleaner_name || 'unknown'
    const relatedPhotos = photosByCleaner.get(cleanerKey) ?? []

    selectedTasks.forEach((taskId) => {
      const hasPhoto = relatedPhotos.some((photo) => {
        if (taskId && photo.task_id) {
          return photo.task_id === taskId
        }
        if (selection.qr_code_id && photo.qr_code_id) {
          return selection.qr_code_id === photo.qr_code_id
        }
        return false
      })

      if (hasPhoto) {
        totalTasksWithPhotos += 1
      } else {
        totalTasksWithoutPhotos += 1
      }
    })

    completedTasks.forEach((taskId) => {
      const matchingPhoto = relatedPhotos
        .filter((photo) => photo.task_id === taskId || (selection.qr_code_id && selection.qr_code_id === photo.qr_code_id))
        .sort((a, b) => {
          const timeA = new Date(a.photo_timestamp ?? 0).getTime()
          const timeB = new Date(b.photo_timestamp ?? 0).getTime()
          return timeA - timeB
        })[0]

      const minutes = minutesBetween(selection.timestamp, matchingPhoto?.photo_timestamp)
      if (minutes !== null) {
        const areaKey = selection.area_type || 'Unknown Area'
        if (!areaDurations.has(areaKey)) {
          areaDurations.set(areaKey, { totalMinutes: 0, samples: 0 })
        }
        const aggregate = areaDurations.get(areaKey)!
        aggregate.totalMinutes += minutes
        aggregate.samples += 1
      }
    })
  })

  const taskCompletionByArea: AreaDuration[] = Array.from(areaDurations.entries()).map(([label, value]) => ({
    label,
    avgMinutes: value.samples ? Number((value.totalMinutes / value.samples).toFixed(1)) : 0,
    samples: value.samples,
  }))

  const complianceRate = totalAttendance
    ? Number(((totalCompleted / totalAttendance) * 100).toFixed(1))
    : null

  const onTimeRate = totalOnTimeEligible
    ? Number(((totalOnTime / totalOnTimeEligible) * 100).toFixed(1))
    : null

  const photoComplianceRate = totalTasksWithPhotos + totalTasksWithoutPhotos
    ? Number((totalTasksWithPhotos / (totalTasksWithPhotos + totalTasksWithoutPhotos) * 100).toFixed(1))
    : null

  return {
    roster,
    totals: {
      complianceRate,
      onTimeRate,
      photoComplianceRate,
      totalHoursWorked: Number(totalHoursWorked.toFixed(2)),
    },
    trend,
    onTimeByCleaner: onTimeRates.sort((a, b) => b.rate - a.rate),
    taskCompletionByArea: taskCompletionByArea.sort((a, b) => b.avgMinutes - a.avgMinutes),
    photoComplianceBreakdown: {
      withPhoto: totalTasksWithPhotos,
      withoutPhoto: totalTasksWithoutPhotos,
    },
    hoursByDate: hoursByDateSeries,
  }
}
