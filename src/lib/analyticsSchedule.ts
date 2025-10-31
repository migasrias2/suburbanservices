import { normalizeCleanerName } from './identity'

export type ScheduleEntry = {
  cleaner: string
  normalizedCleaner: string
  site: string
  days: number[]
  startTime: string
  endTime: string
}

const DAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const parseDayTokens = (value: string): number[] => {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z]/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (!tokens.length) return [0, 1, 2, 3, 4, 5, 6]

  const resolvedDays = new Set<number>()

  tokens.forEach((token) => {
    if (token.includes('every')) {
      resolvedDays.add(0)
      resolvedDays.add(1)
      resolvedDays.add(2)
      resolvedDays.add(3)
      resolvedDays.add(4)
      resolvedDays.add(5)
      resolvedDays.add(6)
      return
    }
    if (token === 'mwf') {
      resolvedDays.add(DAY_MAP.mon)
      resolvedDays.add(DAY_MAP.wed)
      resolvedDays.add(DAY_MAP.fri)
      return
    }
    const shortened = token.slice(0, 3)
    const day = DAY_MAP[shortened as keyof typeof DAY_MAP]
    if (typeof day === 'number') {
      resolvedDays.add(day)
    }
  })

  return resolvedDays.size ? Array.from(resolvedDays).sort() : [0, 1, 2, 3, 4, 5, 6]
}

const buildSchedule = () => {
  const entries: ScheduleEntry[] = []

  const addEntry = (cleaner: string, site: string, daysToken: string, start: string, end: string) => {
    const normalizedCleaner = normalizeCleanerName(cleaner)
    entries.push({
      cleaner,
      normalizedCleaner,
      site,
      days: parseDayTokens(daysToken),
      startTime: start,
      endTime: end,
    })
  }

  addEntry('Danica', 'General', 'Mon Tue Wed Thu Fri', '09:00', '13:00')
  addEntry('Mosleen', 'Avtrade', 'Mon Tue Thu Fri', '08:30', '16:00')
  addEntry('Mosleen', 'Avtrade', 'Wed', '08:30', '15:30')
  addEntry('Mosleen', 'PSM Marine', 'Mon Wed Fri', '18:00', '21:00')
  addEntry('Harry Newton', 'General', 'Mon Tue Wed Thu Fri', '08:30', '17:00')
  addEntry('Jackie Palmer', 'General', 'Mon Tue Wed Thu Fri', '18:00', '20:00')
  addEntry('Edyta', 'General', 'Mon Tue Wed Thu Fri', '18:00', '20:00')
  addEntry('Gill', "Adam's", 'Daily', '10:30', '19:30')
  addEntry('Sienna', 'RDP', 'Fri', '15:00', '19:00')

  return entries
}

export const CLEANER_SCHEDULES: ScheduleEntry[] = buildSchedule()

const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10))
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0
  }
  return hours * 60 + minutes
}

export const getSchedulesForCleaner = (cleanerName: string): ScheduleEntry[] => {
  const normalized = normalizeCleanerName(cleanerName)
  const normalizedLower = normalized.toLowerCase()

  const directMatches = CLEANER_SCHEDULES.filter(
    (entry) => entry.normalizedCleaner.toLowerCase() === normalizedLower,
  )

  if (directMatches.length) {
    return directMatches
  }

  const firstToken = normalizedLower.split(' ')[0] ?? ''
  if (!firstToken) {
    return []
  }

  return CLEANER_SCHEDULES.filter((entry) => entry.normalizedCleaner.toLowerCase().startsWith(firstToken))
}

export const getScheduleForCleaner = (cleanerName: string): ScheduleEntry | null => {
  const schedules = getSchedulesForCleaner(cleanerName)
  return schedules.length ? schedules[0] : null
}

export const isClockInOnTime = (clockInIso: string | null, cleanerName: string): boolean | null => {
  if (!clockInIso) return null
  const clockDate = new Date(clockInIso)
  if (Number.isNaN(clockDate.getTime())) return null

  const schedules = getSchedulesForCleaner(cleanerName)
  if (!schedules.length) return null

  const day = clockDate.getDay()
  const dayMatches = schedules.filter((entry) => entry.days.includes(day))
  if (!dayMatches.length) {
    return null
  }

  const minutes = clockDate.getHours() * 60 + clockDate.getMinutes()
  const closest = dayMatches.reduce<{ schedule: ScheduleEntry | null; diff: number }>(
    (acc, entry) => {
      const start = parseTimeToMinutes(entry.startTime)
      const diff = Math.abs(minutes - start)
      if (!acc.schedule || diff < acc.diff) {
        return { schedule: entry, diff }
      }
      return acc
    },
    { schedule: null, diff: Number.POSITIVE_INFINITY },
  ).schedule

  if (!closest) {
    return null
  }

  const scheduledStart = parseTimeToMinutes(closest.startTime)
  return minutes <= scheduledStart + 5
}

export const buildScheduleLabel = (entry: ScheduleEntry): string => {
  const daysLabel = entry.days
    .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
    .join(', ')
  return `${entry.cleaner} • ${daysLabel} • ${entry.startTime} - ${entry.endTime}`
}







