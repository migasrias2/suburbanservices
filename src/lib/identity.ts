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

