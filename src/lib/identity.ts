export const normalizeCleanerName = (value?: string | null): string => {
  if (!value) return 'Unknown Cleaner'
  const trimmed = value.trim()
  if (!trimmed) return 'Unknown Cleaner'
  return trimmed.replace(/\s+/g, ' ')
}

export const setStoredCleanerName = (value?: string | null): string => {
  const normalized = normalizeCleanerName(value)
  try {
    localStorage.setItem('userName', normalized)
  } catch {
    // no-op: storage may be unavailable in some contexts
  }
  return normalized
}

export const getStoredCleanerName = (): string => {
  try {
    return normalizeCleanerName(localStorage.getItem('userName'))
  } catch {
    return 'Unknown Cleaner'
  }
}

export const normalizeCleanerNumericId = (value?: string | null): number | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('-')) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}


export type AttendanceWorkerRole = 'cleaner' | 'ops_manager'

/**
 * Which kind of shift an attendance row records.
 *
 * Ops managers visit sites through the same clock-in flow as cleaners, but
 * their hours are not cleaning hours. Without this the two are indistinguishable
 * in analytics, hours worked and "who is on site now" -- a site visit would
 * read as a cleaner on shift.
 *
 * Anything that is not an ops manager is a cleaner: the column is NOT NULL and
 * the database refuses a claim of 'ops_manager' from an account that is not one,
 * so guessing wrong here fails closed rather than inflating cleaning hours.
 */
export const getStoredWorkerRole = (): AttendanceWorkerRole => {
  try {
    return localStorage.getItem('userType') === 'ops_manager' ? 'ops_manager' : 'cleaner'
  } catch {
    return 'cleaner'
  }
}
